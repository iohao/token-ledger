import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  CircleAlert,
  CircleDollarSign,
  Layers,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { updatePricingProviders, updateUiPreferences } from "../api/electron";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type {
  ModelPricingRatesDTO,
  PricingProviderDTO,
  PricingTemplateDTO,
  ProviderModelPricingDTO,
  RelayPricingProviderDTO
} from "../dto/dashboard";
import type { PageSourceId } from "../types";
import { formatPriceDiffPercent } from "../utils/format";

export const RELAY_PRICING_PAGE_SOURCE_ID: PageSourceId = "src/views/RelayPricingView.tsx";

const DEFAULT_OPENAI_RATIO = "0.1400";
const MIGRATED_RELAY_PROVIDER_ID = "migrated-relay";
const RELAY_PRICING_SHOW_OFFICIAL_STORAGE_KEY = "tokenledger.relayPricing.showOfficial";
const RELAY_PRICING_VISIBLE_MODELS_STORAGE_KEY = "tokenledger.relayPricing.visibleModels";
const PRICE_FIELDS: Array<{ key: keyof ModelPricingRatesDTO; label: string }> = [
  { key: "inputUsdPerMillion", label: "relayPricingInput" },
  { key: "outputUsdPerMillion", label: "relayPricingOutput" },
  { key: "cacheReadUsdPerMillion", label: "relayPricingCacheRead" },
  { key: "cacheCreationUsdPerMillion", label: "relayPricingCacheCreation" }
];

export type ComparableProviderInput = {
  id: string;
  multiplier: string | number | null;
  rechargeRatioUsdPerRmb: string | number | null;
  modelPrices?: ProviderModelPricingDTO[];
};

export type ProviderModelPriceComparison = {
  isLowest: boolean;
  diffPercent: string | null;
};

export type DraftRelayProvider = {
  id: string;
  name: string;
  enabled: boolean;
  rechargeRatioUsdPerRmb: string;
  multiplier: string;
  templateId?: string | null;
  codexProviderId?: string;
  modelPrices: ProviderModelPricingDTO[];
};

export function resolveDraftProviderPrices(
  provider: { templateId?: string | null; modelPrices?: ProviderModelPricingDTO[] },
  templates: PricingTemplateDTO[],
  officialPrices: ProviderModelPricingDTO[]
): ProviderModelPricingDTO[] {
  const templateId = provider.templateId?.trim();
  if (templateId === "openai-official") {
    return officialPrices;
  }
  if (templateId && templateId !== "custom") {
    const matched = templates.find((t) => t.id === templateId);
    if (matched) {
      return matched.modelPrices;
    }
  }
  return provider.modelPrices ?? officialPrices;
}

export function formatPrice(value: number | null | undefined, fallback = "0.0000"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value.toFixed(4);
}

export function formatDisplayRate(value: number | null | undefined, fallback = "0.0000"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Number.isInteger(Math.round(value * 10000) / 10)
    ? value.toFixed(3)
    : value.toFixed(4);
}

export function isRateEqual(
  a: ModelPricingRatesDTO | null | undefined,
  b: ModelPricingRatesDTO | null | undefined
): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    Math.abs((a.inputUsdPerMillion ?? 0) - (b.inputUsdPerMillion ?? 0)) < 1e-6 &&
    Math.abs((a.outputUsdPerMillion ?? 0) - (b.outputUsdPerMillion ?? 0)) < 1e-6 &&
    Math.abs((a.cacheReadUsdPerMillion ?? 0) - (b.cacheReadUsdPerMillion ?? 0)) < 1e-6 &&
    Math.abs((a.cacheCreationUsdPerMillion ?? 0) - (b.cacheCreationUsdPerMillion ?? 0)) < 1e-6
  );
}

export function countCustomizedModels(
  providerPrices: ProviderModelPricingDTO[] | undefined,
  officialPrices: ProviderModelPricingDTO[]
): number {
  if (!providerPrices || providerPrices.length === 0) {
    return 0;
  }
  const officialMap = new Map((officialPrices ?? []).map((p) => [p.model, p.rates]));
  let count = 0;
  for (const price of providerPrices) {
    if (!price || !price.model) {
      continue;
    }
    const officialRate = officialMap.get(price.model);
    if (!officialRate || !price.rates || !isRateEqual(price.rates, officialRate)) {
      count++;
    }
  }
  return count;
}

export function mergeWithOfficialModelPrices(
  customPrices: ProviderModelPricingDTO[] | undefined,
  officialPrices: ProviderModelPricingDTO[]
): ProviderModelPricingDTO[] {
  const customMap = new Map((customPrices ?? []).map((p) => [p.model, p.rates]));
  return (officialPrices ?? []).map((official) => {
    const customRate = customMap.get(official.model);
    return {
      model: official.model,
      rates: {
        inputUsdPerMillion: customRate?.inputUsdPerMillion ?? official.rates?.inputUsdPerMillion ?? 0,
        outputUsdPerMillion: customRate?.outputUsdPerMillion ?? official.rates?.outputUsdPerMillion ?? 0,
        cacheReadUsdPerMillion: customRate?.cacheReadUsdPerMillion ?? official.rates?.cacheReadUsdPerMillion ?? 0,
        cacheCreationUsdPerMillion:
          customRate?.cacheCreationUsdPerMillion ?? official.rates?.cacheCreationUsdPerMillion ?? 0
      }
    };
  });
}

function toDraftProvider(
  provider: PricingProviderDTO,
  defaultOfficialPrices: ProviderModelPricingDTO[] = [],
  templates: PricingTemplateDTO[] = []
): DraftRelayProvider {
  const templateId = provider.templateId ?? null;
  let basePrices = provider.modelPrices;
  if (templateId === "openai-official") {
    basePrices = defaultOfficialPrices;
  } else if (templateId && templateId !== "custom") {
    const matched = templates.find((t) => t.id === templateId);
    if (matched) {
      basePrices = matched.modelPrices;
    }
  }
  return {
    id: provider.id,
    name: provider.name ?? "",
    enabled: Boolean(provider.enabled),
    rechargeRatioUsdPerRmb:
      provider.rechargeRatioUsdPerRmb === null || provider.rechargeRatioUsdPerRmb === undefined
        ? ""
        : formatPrice(provider.rechargeRatioUsdPerRmb, ""),
    multiplier:
      provider.multiplier === null || provider.multiplier === undefined
        ? "1.0000"
        : formatPrice(provider.multiplier, "1.0000"),
    templateId,
    codexProviderId: provider.codexProviderId ?? "",
    modelPrices: mergeWithOfficialModelPrices(basePrices, defaultOfficialPrices)
  };
}

function createProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `relay-${Date.now()}`;
}

export function parseNonNegative(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parsePositive(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getProviderEffectiveCost(provider: {
  multiplier?: string | number | null;
  rechargeRatioUsdPerRmb?: string | number | null;
}): number | null {
  const multiplier =
    provider.multiplier === undefined || provider.multiplier === null
      ? 1.0
      : typeof provider.multiplier === "number"
        ? provider.multiplier > 0 && Number.isFinite(provider.multiplier)
          ? provider.multiplier
          : null
        : parsePositive(String(provider.multiplier));

  const ratio =
    typeof provider.rechargeRatioUsdPerRmb === "number"
      ? provider.rechargeRatioUsdPerRmb > 0 && Number.isFinite(provider.rechargeRatioUsdPerRmb)
        ? provider.rechargeRatioUsdPerRmb
        : null
      : parsePositive(String(provider.rechargeRatioUsdPerRmb ?? ""));

  if (multiplier === null || ratio === null || ratio <= 0) {
    return null;
  }

  const cost = multiplier / ratio;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function compareRelayProvidersByPrice<
  T extends {
    name?: string;
    multiplier?: string | number | null;
    rechargeRatioUsdPerRmb?: string | number | null;
  }
>(a: T, b: T): number {
  const costA = getProviderEffectiveCost(a);
  const costB = getProviderEffectiveCost(b);

  if (costA !== null && costB !== null) {
    if (Math.abs(costA - costB) > 1e-9) {
      return costA - costB;
    }
    return (a.name ?? "").localeCompare(b.name ?? "");
  }

  if (costA !== null) {
    return -1;
  }
  if (costB !== null) {
    return 1;
  }

  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function computeLowestModelsByProvider(
  providers: ComparableProviderInput[],
  modelPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>
): Map<string, Map<string, ProviderModelPriceComparison>> {
  const result = new Map<string, Map<string, ProviderModelPriceComparison>>();
  for (const p of providers ?? []) {
    result.set(p.id, new Map());
  }

  const comparable: Array<{
    id: string;
    multiplier: number;
    rechargeRatio: number;
    modelPricesMap: Map<string, ModelPricingRatesDTO>;
  }> = [];

  for (const p of providers ?? []) {
    const multiplier =
      typeof p.multiplier === "number"
        ? p.multiplier > 0 && Number.isFinite(p.multiplier)
          ? p.multiplier
          : null
        : parsePositive(String(p.multiplier ?? ""));
    const ratio =
      typeof p.rechargeRatioUsdPerRmb === "number"
        ? p.rechargeRatioUsdPerRmb > 0 && Number.isFinite(p.rechargeRatioUsdPerRmb)
          ? p.rechargeRatioUsdPerRmb
          : null
        : parsePositive(String(p.rechargeRatioUsdPerRmb ?? ""));

    if (multiplier !== null && ratio !== null) {
      comparable.push({
        id: p.id,
        multiplier,
        rechargeRatio: ratio,
        modelPricesMap: new Map((p.modelPrices ?? []).map((m) => [m.model, m.rates]))
      });
    }
  }

  if (comparable.length < 2) {
    return result;
  }

  for (const price of modelPrices ?? []) {
    if (!price || !price.rates) {
      continue;
    }
    const defaultBaseRate = price.rates.inputUsdPerMillion ?? 0;

    let minCostRmb = Number.POSITIVE_INFINITY;
    const providerCosts: Array<{ id: string; costRmb: number }> = [];

    for (const p of comparable) {
      const providerRates = p.modelPricesMap.get(price.model);
      const baseRate = providerRates?.inputUsdPerMillion ?? defaultBaseRate;
      const rateToCompare = baseRate > 0 ? baseRate : (defaultBaseRate > 0 ? defaultBaseRate : 1);

      const costRmb = (rateToCompare * p.multiplier) / p.rechargeRatio;
      providerCosts.push({ id: p.id, costRmb });
      if (costRmb < minCostRmb) {
        minCostRmb = costRmb;
      }
    }

    if (!Number.isFinite(minCostRmb) || minCostRmb <= 0) {
      continue;
    }

    for (const { id, costRmb } of providerCosts) {
      const isLowest = Math.abs(costRmb - minCostRmb) < 1e-6;
      const diffPercent = isLowest ? null : formatPriceDiffPercent(costRmb, minCostRmb);

      result.get(id)?.set(price.model, {
        isLowest,
        diffPercent
      });
    }
  }

  return result;
}

export const RelayPricingView: React.FC = () => {
  const { t } = useTranslation();
  const { dashboard, isLoading, isSyncing, loadDashboard } = useApp();
  const providers = dashboard?.meta.pricingProviders ?? [];
  const officialProvider = providers.find((provider) => provider.kind === "official");
  const officialPrices = officialProvider?.modelPrices ?? [];
  const officialModels = officialPrices.map((price) => price.model);

  const [pricingTemplates, setPricingTemplates] = useState<PricingTemplateDTO[]>(() => {
    return dashboard?.meta.pricingTemplates ?? [];
  });
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PricingTemplateDTO | null>(null);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [templateInitialSource, setTemplateInitialSource] = useState<string>("openai-official");
  const [boundProviderForNewTemplate, setBoundProviderForNewTemplate] = useState<string | null>(null);

  const [relayProviders, setRelayProviders] = useState<DraftRelayProvider[]>(() => {
    const list = providers
      .filter((provider) => provider.kind === "relay")
      .map((provider) => toDraftProvider(provider, officialPrices, dashboard?.meta.pricingTemplates ?? []));
    list.sort(compareRelayProvidersByPrice);
    return list;
  });
  const [openaiRatio, setOpenaiRatio] = useState(DEFAULT_OPENAI_RATIO);
  const [showOfficial, setShowOfficial] = useState<boolean>(() => {
    if (typeof dashboard?.meta.relayPricingShowOfficial === "boolean") {
      return dashboard.meta.relayPricingShowOfficial;
    }
    try {
      return localStorage.getItem(RELAY_PRICING_SHOW_OFFICIAL_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [visibleModels, setVisibleModels] = useState<Set<string>>(() => {
    if (Array.isArray(dashboard?.meta.relayPricingVisibleModels)) {
      return new Set(dashboard.meta.relayPricingVisibleModels.map(String));
    }
    try {
      const raw = localStorage.getItem(RELAY_PRICING_VISIBLE_MODELS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.map(String));
        }
      }
    } catch {
      // ignore
    }
    return new Set<string>();
  });
  const [hasInitializedVisibleModels, setHasInitializedVisibleModels] = useState(() => {
    return Array.isArray(dashboard?.meta.relayPricingVisibleModels);
  });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [editingBenchmarkProvider, setEditingBenchmarkProvider] = useState<DraftRelayProvider | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const handleToggleOfficial = (enabled: boolean) => {
    setShowOfficial(enabled);
    try {
      localStorage.setItem(RELAY_PRICING_SHOW_OFFICIAL_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    void updateUiPreferences({ relayPricingShowOfficial: enabled }).catch(() => {});
  };

  useEffect(() => {
    if (typeof dashboard?.meta.relayPricingShowOfficial === "boolean") {
      setShowOfficial(dashboard.meta.relayPricingShowOfficial);
    }
  }, [dashboard?.meta.relayPricingShowOfficial]);

  useEffect(() => {
    if (hasInitializedVisibleModels) {
      return;
    }
    if (Array.isArray(dashboard?.meta.relayPricingVisibleModels)) {
      setVisibleModels(new Set(dashboard.meta.relayPricingVisibleModels.map(String)));
      setHasInitializedVisibleModels(true);
      return;
    }
    if (officialModels.length > 0) {
      try {
        const raw = localStorage.getItem(RELAY_PRICING_VISIBLE_MODELS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setVisibleModels(new Set(parsed.map(String)));
            setHasInitializedVisibleModels(true);
            return;
          }
        }
      } catch {
        // ignore
      }
      setVisibleModels(new Set(officialModels));
      setHasInitializedVisibleModels(true);
    }
  }, [dashboard?.meta.relayPricingVisibleModels, officialModels, hasInitializedVisibleModels]);

  const handleToggleModelVisibility = (model: string, visible: boolean) => {
    setVisibleModels((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(model);
      } else {
        next.delete(model);
      }
      const modelArray = Array.from(next);
      try {
        localStorage.setItem(
          RELAY_PRICING_VISIBLE_MODELS_STORAGE_KEY,
          JSON.stringify(modelArray)
        );
      } catch {
        // ignore
      }
      void updateUiPreferences({ relayPricingVisibleModels: modelArray }).catch(() => {});
      return next;
    });
  };

  const visibleOfficialPrices = (officialProvider?.modelPrices ?? []).filter((price) =>
    visibleModels.has(price.model)
  );

  const modelComparisonsByProvider = useMemo(() => {
    const allProviders: ComparableProviderInput[] = [];
    if (showOfficial && officialProvider) {
      allProviders.push({
        id: officialProvider.id,
        multiplier: "1.0000",
        rechargeRatioUsdPerRmb: openaiRatio,
        modelPrices: officialProvider.modelPrices
      });
    }
    for (const provider of relayProviders) {
      const effectivePrices = resolveDraftProviderPrices(provider, pricingTemplates, officialPrices);
      allProviders.push({
        id: provider.id,
        multiplier: provider.multiplier,
        rechargeRatioUsdPerRmb: provider.rechargeRatioUsdPerRmb,
        modelPrices: effectivePrices
      });
    }
    return computeLowestModelsByProvider(allProviders, officialProvider?.modelPrices ?? []);
  }, [showOfficial, officialProvider, openaiRatio, relayProviders, pricingTemplates, officialPrices]);

  useEffect(() => {
    if (isDirty || !officialProvider) {
      return;
    }
    setOpenaiRatio(
      officialProvider.rechargeRatioUsdPerRmb === null || officialProvider.rechargeRatioUsdPerRmb === undefined
        ? DEFAULT_OPENAI_RATIO
        : formatPrice(officialProvider.rechargeRatioUsdPerRmb, DEFAULT_OPENAI_RATIO)
    );
    const templates = dashboard?.meta.pricingTemplates ?? [];
    setPricingTemplates(templates);
    const relayList = providers
      .filter((provider) => provider.kind === "relay")
      .map((provider) => toDraftProvider(provider, officialProvider.modelPrices ?? [], templates));
    relayList.sort(compareRelayProvidersByPrice);
    setRelayProviders(relayList);
  }, [isDirty, officialProvider, providers, dashboard?.meta.pricingTemplates]);

  useEffect(() => {
    if (saveError) {
      errorSummaryRef.current?.focus();
    }
  }, [saveError]);

  const controlsDisabled = isLoading || isSyncing || isSaving;

  const markDirty = () => {
    setIsDirty(true);
    setSaveError(null);
    setSaveNotice(null);
  };

  const updateRelay = (id: string, update: (provider: DraftRelayProvider) => DraftRelayProvider) => {
    setRelayProviders((current) => current.map((provider) => (provider.id === id ? update(provider) : provider)));
    markDirty();
  };

  const addRelayProvider = () => {
    setRelayProviders((current) => [
      ...current,
      {
        id: createProviderId(),
        name: "",
        enabled: false,
        rechargeRatioUsdPerRmb: "",
        multiplier: "1.0000",
        templateId: "openai-official",
        codexProviderId: "",
        modelPrices: (officialProvider?.modelPrices ?? []).map((p) => ({
          model: p.model,
          rates: { ...p.rates }
        }))
      }
    ]);
    markDirty();
  };

  const handleApplyBenchmarkRates = (providerId: string, updatedPrices: ProviderModelPricingDTO[]) => {
    updateRelay(providerId, (provider) => ({
      ...provider,
      templateId: null,
      modelPrices: updatedPrices
    }));
    setEditingBenchmarkProvider(null);
  };

  const handleSaveTemplate = (template: PricingTemplateDTO) => {
    setPricingTemplates((current) => {
      const exists = current.some((t) => t.id === template.id);
      if (exists) {
        return current.map((t) => (t.id === template.id ? template : t));
      }
      return [...current, template];
    });

    if (boundProviderForNewTemplate) {
      setRelayProviders((current) =>
        current.map((provider) =>
          provider.id === boundProviderForNewTemplate
            ? { ...provider, templateId: template.id }
            : provider
        )
      );
      setBoundProviderForNewTemplate(null);
    }

    setEditingTemplate(null);
    setIsCreatingTemplate(false);
    markDirty();
  };

  const handleDeleteTemplate = (templateId: string) => {
    const tpl = pricingTemplates.find((t) => t.id === templateId);
    if (!tpl) return;

    const refCount = relayProviders.filter((p) => p.templateId === templateId).length;
    const confirmMsg = refCount > 0
      ? t("relayPricingTemplateDeleteConfirm", { name: tpl.name, count: refCount })
      : t("relayPricingTemplateDeleteConfirmNoRefs", { name: tpl.name });

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setRelayProviders((current) =>
      current.map((provider) => {
        if (provider.templateId === templateId) {
          return {
            ...provider,
            templateId: null,
            modelPrices: tpl.modelPrices.map((p) => ({
              model: p.model,
              rates: { ...p.rates }
            }))
          };
        }
        return provider;
      })
    );

    setPricingTemplates((current) => current.filter((t) => t.id !== templateId));
    if (editingTemplate?.id === templateId) {
      setEditingTemplate(null);
    }
    markDirty();
  };

  const handleProviderTemplateChange = (providerId: string, newTemplateId: string) => {
    updateRelay(providerId, (provider) => {
      if (newTemplateId === "custom") {
        const currentPrices = resolveDraftProviderPrices(provider, pricingTemplates, officialPrices);
        return {
          ...provider,
          templateId: null,
          modelPrices: currentPrices.map((p) => ({
            model: p.model,
            rates: { ...p.rates }
          }))
        };
      }
      if (newTemplateId === "openai-official") {
        return {
          ...provider,
          templateId: "openai-official"
        };
      }
      return {
        ...provider,
        templateId: newTemplateId
      };
    });
  };

  const handleOpenSaveAsTemplate = (name: string, prices: ProviderModelPricingDTO[]) => {
    setEditingTemplate({
      id: createProviderId(),
      name,
      modelPrices: prices.map((p) => ({
        model: p.model,
        rates: { ...p.rates }
      }))
    });
    setIsCreatingTemplate(true);
    setTemplateInitialSource("custom");
    if (editingBenchmarkProvider) {
      setBoundProviderForNewTemplate(editingBenchmarkProvider.id);
    }
    setEditingBenchmarkProvider(null);
  };

  const saveProviders = async () => {
    const parsedOpenaiRatio = parsePositive(openaiRatio);
    if (parsedOpenaiRatio === null) {
      setSaveError(t("relayPricingOpenaiRatioError"));
      return;
    }

    const payload: RelayPricingProviderDTO[] = [];
    for (const provider of relayProviders) {
      const name = provider.name.trim();
      if (!name) {
        setSaveError(t("relayPricingProviderNameError"));
        return;
      }
      const ratio = parsePositive(provider.rechargeRatioUsdPerRmb);
      if (ratio === null && (provider.enabled || provider.id !== MIGRATED_RELAY_PROVIDER_ID)) {
        setSaveError(t("relayPricingRatioError", { provider: name }));
        return;
      }
      const multiplier = parsePositive(provider.multiplier);
      if (multiplier === null) {
        setSaveError(t("relayPricingMultiplierError", { provider: name }));
        return;
      }

      payload.push({
        id: provider.id,
        name,
        enabled: provider.enabled,
        rechargeRatioUsdPerRmb: ratio,
        multiplier,
        templateId: provider.templateId ?? null,
        codexProviderId: provider.codexProviderId?.trim() || null,
        modelPrices: provider.modelPrices
      });
    }

    payload.sort(compareRelayProvidersByPrice);

    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await updatePricingProviders(payload, parsedOpenaiRatio, pricingTemplates);
      setIsDirty(false);
      setSaveNotice(t("relayPricingSaved"));
      await loadDashboard();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-stack relay-pricing-page">
      <PageHeader
        icon={<CircleDollarSign size={18} />}
        eyebrow={t("relayPricingEyebrow")}
        title={t("relayPricingTitle")}
        description={t("relayPricingDescription")}
        pageSourceId={RELAY_PRICING_PAGE_SOURCE_ID}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              className="action secondary relay-templates-btn"
              type="button"
              onClick={() => setIsTemplateManagerOpen(true)}
              disabled={controlsDisabled}
            >
              <Layers size={15} />
              <span>{t("relayPricingManageTemplates")}</span>
              {pricingTemplates.length > 0 && (
                <span className="relay-templates-count-badge">{pricingTemplates.length}</span>
              )}
            </button>
            <label className="settings-switch-label">
              <span className="settings-switch-text">{t("relayPricingShowOfficial")}</span>
              <span className="settings-switch">
                <input
                  className="settings-switch-input"
                  type="checkbox"
                  checked={showOfficial}
                  onChange={(event) => handleToggleOfficial(event.target.checked)}
                />
                <span className="settings-switch-track" aria-hidden="true" />
              </span>
            </label>
          </div>
        }
      />

      {saveError && <div className="relay-error-summary" ref={errorSummaryRef} tabIndex={-1} role="alert"><CircleAlert size={17} /> {saveError}</div>}
      {saveNotice && <p className="config-feedback good" role="status">{saveNotice}</p>}

      <section className="relay-provider-list" aria-label={t("relayPricingProvidersAria")}>
        {showOfficial && officialProvider && (
          <OfficialProviderCard
            provider={officialProvider}
            openaiRatio={openaiRatio}
            visibleModels={visibleModels}
            onToggleModelVisibility={handleToggleModelVisibility}
            modelComparisons={modelComparisonsByProvider.get(officialProvider.id)}
            controlsDisabled={controlsDisabled}
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void saveProviders()}
            onRatioChange={(value) => {
              setOpenaiRatio(value);
              markDirty();
            }}
          />
        )}
        {relayProviders.map((provider) => (
          <RelayProviderCard
            key={provider.id}
            provider={provider}
            pricingTemplates={pricingTemplates}
            officialPrices={visibleOfficialPrices}
            allOfficialPrices={officialPrices}
            modelComparisons={modelComparisonsByProvider.get(provider.id)}
            controlsDisabled={controlsDisabled}
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void saveProviders()}
            onUpdate={updateRelay}
            onRemove={() => {
              setRelayProviders((current) => current.filter((item) => item.id !== provider.id));
              markDirty();
            }}
            onTemplateChange={handleProviderTemplateChange}
            onOpenBenchmarkModal={setEditingBenchmarkProvider}
            onOpenTemplateEditor={(tpl) => {
              setEditingTemplate(tpl);
              setIsCreatingTemplate(false);
            }}
          />
        ))}
      </section>

      <button className="relay-add-provider" type="button" onClick={addRelayProvider} disabled={controlsDisabled}>
        <Plus size={18} />
        <span>{t("relayPricingAddProvider")}</span>
      </button>

      {isTemplateManagerOpen && (
        <PricingTemplatesModal
          templates={pricingTemplates}
          relayProviders={relayProviders}
          officialPrices={officialPrices}
          onClose={() => setIsTemplateManagerOpen(false)}
          onOpenCreate={() => {
            setEditingTemplate(null);
            setIsCreatingTemplate(true);
            setTemplateInitialSource("openai-official");
          }}
          onEditTemplate={(tpl) => {
            setEditingTemplate(tpl);
            setIsCreatingTemplate(false);
          }}
          onDeleteTemplate={handleDeleteTemplate}
        />
      )}

      {(editingTemplate !== null || isCreatingTemplate) && (
        <PricingTemplateEditorModal
          template={editingTemplate}
          initialSourceProviderId={templateInitialSource}
          officialPrices={officialPrices}
          relayProviders={relayProviders}
          referencingCount={
            editingTemplate
              ? relayProviders.filter((p) => p.templateId === editingTemplate.id).length
              : 0
          }
          existingTemplateNames={
            new Set(
              pricingTemplates
                .filter((t) => t.id !== editingTemplate?.id)
                .map((t) => t.name.toLowerCase().trim())
            )
          }
          onClose={() => {
            setEditingTemplate(null);
            setIsCreatingTemplate(false);
          }}
          onSave={handleSaveTemplate}
        />
      )}

      {editingBenchmarkProvider && (
        <RelayBenchmarkModal
          provider={editingBenchmarkProvider}
          officialPrices={officialPrices}
          onClose={() => setEditingBenchmarkProvider(null)}
          onApply={handleApplyBenchmarkRates}
          onSaveAsTemplate={handleOpenSaveAsTemplate}
        />
      )}
    </div>
  );
};

const OfficialProviderCard: React.FC<{
  provider: PricingProviderDTO;
  openaiRatio: string;
  visibleModels: Set<string>;
  onToggleModelVisibility: (model: string, visible: boolean) => void;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
  controlsDisabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onRatioChange: (value: string) => void;
}> = ({
  provider,
  openaiRatio,
  visibleModels,
  onToggleModelVisibility,
  modelComparisons,
  controlsDisabled,
  isDirty,
  isSaving,
  onSave,
  onRatioChange
}) => {
  const { t } = useTranslation();
  return (
    <article className="relay-provider-card panel is-official">
      <div className="relay-provider-head">
        <div>
          <span className="relay-provider-type">{t("relayPricingOfficial")}</span>
          <h2>{provider.name}</h2>
          <p>{t("relayPricingOfficialDescription")}</p>
        </div>
        <span className="relay-fixed-badge">{t("relayPricingFixed")}</span>
      </div>
      <div className="relay-provider-config-bar">
        <RatioField
          id="official-ratio"
          value={openaiRatio}
          disabled={controlsDisabled}
          onChange={onRatioChange}
        />
        <div className="relay-config-action">
          <button
            className="action primary relay-provider-save-btn"
            type="button"
            onClick={onSave}
            disabled={controlsDisabled || !isDirty}
          >
            <Save className="action-icon" size={16} />
            <span>{isSaving ? t("relayPricingSaving") : t("relayPricingSave")}</span>
          </button>
        </div>
      </div>
      <OfficialModelTable
        prices={provider.modelPrices ?? []}
        visibleModels={visibleModels}
        onToggleModelVisibility={onToggleModelVisibility}
        modelComparisons={modelComparisons}
      />
    </article>
  );
};

const RelayProviderCard: React.FC<{
  provider: DraftRelayProvider;
  pricingTemplates: PricingTemplateDTO[];
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  allOfficialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
  controlsDisabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onUpdate: (id: string, update: (provider: DraftRelayProvider) => DraftRelayProvider) => void;
  onRemove: () => void;
  onTemplateChange: (providerId: string, templateId: string) => void;
  onOpenBenchmarkModal: (provider: DraftRelayProvider) => void;
  onOpenTemplateEditor: (template: PricingTemplateDTO) => void;
}> = ({
  provider,
  pricingTemplates,
  officialPrices,
  allOfficialPrices,
  modelComparisons,
  controlsDisabled,
  isDirty,
  isSaving,
  onSave,
  onUpdate,
  onRemove,
  onTemplateChange,
  onOpenBenchmarkModal,
  onOpenTemplateEditor
}) => {
  const { t } = useTranslation();
  const effectivePrices = resolveDraftProviderPrices(provider, pricingTemplates, allOfficialPrices);
  const isTemplate = Boolean(
    provider.templateId &&
    provider.templateId !== "openai-official" &&
    provider.templateId !== "custom"
  );
  const boundTemplate = isTemplate
    ? pricingTemplates.find((t) => t.id === provider.templateId) ?? null
    : null;
  const customizedCount = countCustomizedModels(effectivePrices, allOfficialPrices);
  const selectedTemplateValue = provider.templateId ?? (customizedCount > 0 ? "custom" : "openai-official");

  return (
    <article className={`relay-provider-card panel ${provider.enabled ? "is-enabled" : "is-disabled"}`}>
      <div className="relay-provider-head">
        <div className="relay-provider-head-left">
          <span className="relay-provider-type">{t("relayPricingRelay")}</span>
          {boundTemplate ? (
            <span className="relay-benchmark-tag is-template">
              {t("relayPricingTemplateReferencedBadge", { name: boundTemplate.name })}
            </span>
          ) : (
            <span className={`relay-benchmark-tag ${customizedCount > 0 ? "is-customized" : "is-default"}`}>
              {customizedCount > 0
                ? t("relayPricingBenchmarkCustomCount", { count: customizedCount })
                : t("relayPricingBenchmarkDefault")}
            </span>
          )}
        </div>
        <div className="relay-provider-actions">
          <label className="settings-switch-label">
            <span className="settings-switch-text">{provider.enabled ? t("relayPricingEnabled") : t("relayPricingDisabled")}</span>
            <span className="settings-switch">
              <input
                className="settings-switch-input"
                type="checkbox"
                checked={provider.enabled}
                onChange={(event) => onUpdate(provider.id, (item) => ({ ...item, enabled: event.target.checked }))}
                disabled={controlsDisabled}
              />
              <span className="settings-switch-track" aria-hidden="true" />
            </span>
          </label>
          <button
            className="relay-icon-button"
            type="button"
            onClick={onRemove}
            disabled={controlsDisabled}
            aria-label={t("relayPricingDeleteProvider")}
            title={t("relayPricingDeleteProvider")}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <div className="relay-provider-config-bar">
        <div className="relay-config-field relay-name-field">
          <label className="relay-field-label" htmlFor={`relay-name-${provider.id}`}>
            {t("relayPricingProviderName")}
          </label>
          <div className="relay-field-control relay-name-control">
            <input
              id={`relay-name-${provider.id}`}
              className="relay-plain-input"
              value={provider.name}
              placeholder={t("relayPricingProviderNamePlaceholder")}
              onChange={(event) => onUpdate(provider.id, (item) => ({ ...item, name: event.target.value }))}
              disabled={controlsDisabled}
            />
          </div>
        </div>
        <RatioField
          id={`relay-ratio-${provider.id}`}
          value={provider.rechargeRatioUsdPerRmb}
          disabled={controlsDisabled}
          onChange={(value) => onUpdate(provider.id, (item) => ({ ...item, rechargeRatioUsdPerRmb: value }))}
        />
        <MultiplierField
          id={`relay-multiplier-${provider.id}`}
          value={provider.multiplier}
          disabled={controlsDisabled}
          onChange={(value) => onUpdate(provider.id, (item) => ({ ...item, multiplier: value }))}
        />
        <div className="relay-config-field relay-benchmark-field">
          <label className="relay-field-label" htmlFor={`relay-template-${provider.id}`}>
            {t("relayPricingBenchmarkSource")}
          </label>
          <div className="relay-benchmark-select-wrap">
            <select
              id={`relay-template-${provider.id}`}
              className="relay-plain-select"
              value={selectedTemplateValue}
              onChange={(e) => onTemplateChange(provider.id, e.target.value)}
              disabled={controlsDisabled}
            >
              <option value="openai-official">{t("relayPricingSourceOfficial")}</option>
              {pricingTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
              <option value="custom">{t("relayPricingCustomBenchmark")}</option>
            </select>
            {boundTemplate ? (
              <button
                className="action secondary relay-edit-benchmark-btn"
                type="button"
                onClick={() => onOpenTemplateEditor(boundTemplate)}
                disabled={controlsDisabled}
                title={t("relayPricingEditTemplate")}
              >
                <SlidersHorizontal size={14} />
                <span>{t("relayPricingEditTemplate")}</span>
              </button>
            ) : (
              <button
                className="action secondary relay-edit-benchmark-btn"
                type="button"
                onClick={() => onOpenBenchmarkModal(provider)}
                disabled={controlsDisabled}
                title={t("relayPricingEditBenchmark")}
              >
                <SlidersHorizontal size={14} />
                <span>{t("relayPricingEditBenchmark")}</span>
              </button>
            )}
          </div>
        </div>
        <div className="relay-config-action">
          <button
            className="action primary relay-provider-save-btn"
            type="button"
            onClick={onSave}
            disabled={controlsDisabled || !isDirty}
          >
            <Save className="action-icon" size={16} />
            <span>{isSaving ? t("relayPricingSaving") : t("relayPricingSave")}</span>
          </button>
        </div>
      </div>
      <RelayRatePreviewTable
        officialPrices={officialPrices}
        providerPrices={effectivePrices}
        multiplier={provider.multiplier}
        modelComparisons={modelComparisons}
      />
    </article>
  );
};

const RatioField: React.FC<{
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ id, value, disabled, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="relay-config-field relay-ratio-field">
      <label className="relay-field-label" htmlFor={id}>
        {t("relayPricingRechargeRatio")}
      </label>
      <div className="relay-field-control relay-compound-control">
        <span className="relay-affix-label">1 RMB =</span>
        <input
          id={id}
          className="relay-plain-input relay-num-input"
          type="number"
          min="0"
          step="0.0001"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <span className="relay-affix-label">$</span>
      </div>
    </div>
  );
};

const MultiplierField: React.FC<{
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ id, value, disabled, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="relay-config-field relay-multiplier-field">
      <label className="relay-field-label" htmlFor={id}>
        {t("relayPricingMultiplier")}
      </label>
      <div className="relay-field-control relay-compound-control">
        <span className="relay-affix-label">×</span>
        <input
          id={id}
          className="relay-plain-input relay-num-input"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

const OfficialModelTable: React.FC<{
  prices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  visibleModels: Set<string>;
  onToggleModelVisibility: (model: string, visible: boolean) => void;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
}> = ({ prices, visibleModels, onToggleModelVisibility, modelComparisons }) => {
  const { t } = useTranslation();
  if (prices.length === 0) {
    return <p className="relay-no-models">{t("relayPricingNoModels")}</p>;
  }

  return (
    <div className="relay-model-table-wrap">
      <table className="relay-model-table">
        <thead>
          <tr>
            <th>{t("relayPricingModel")}</th>
            {PRICE_FIELDS.map((field) => <th key={field.key}>{t(field.label)}</th>)}
            <th className="relay-col-checkbox">{t("relayPricingShowInRelay")}</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((price) => {
            const isVisible = visibleModels.has(price.model);
            const comparison = modelComparisons?.get(price.model);
            return (
              <tr key={price.model}>
                <td>
                  <div className="relay-model-name-cell">
                    {comparison?.isLowest && (
                      <span className="relay-model-lowest-badge">
                        {t("lowestTag")}
                      </span>
                    )}
                    {comparison && !comparison.isLowest && comparison.diffPercent !== null && (
                      <span className="relay-model-diff-badge">
                        <TrendingUp size={10} className="relay-model-diff-icon" aria-hidden="true" />
                        <span>{comparison.diffPercent}</span>
                      </span>
                    )}
                    <code>{price.model}</code>
                  </div>
                </td>
                {PRICE_FIELDS.map((field) => (
                  <td key={field.key}>
                    <div className="relay-readonly-rate">
                      <strong>${formatPrice(price.rates?.[field.key])} / 1M</strong>
                    </div>
                  </td>
                ))}
                <td className="relay-cell-checkbox">
                  <label className="relay-checkbox-wrap">
                    <input
                      className="relay-checkbox"
                      type="checkbox"
                      checked={isVisible}
                      onChange={(event) =>
                        onToggleModelVisibility(price.model, event.target.checked)
                      }
                      aria-label={t("relayPricingShowInRelayAria", { model: price.model })}
                    />
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const RelayRatePreviewTable: React.FC<{
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  providerPrices?: ProviderModelPricingDTO[];
  multiplier: string;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
}> = ({ officialPrices, providerPrices, multiplier, modelComparisons }) => {
  const { t } = useTranslation();
  const providerPriceMap = useMemo(
    () => new Map((providerPrices ?? []).map((p) => [p.model, p.rates])),
    [providerPrices]
  );

  if (officialPrices.length === 0) {
    return <p className="relay-no-models">{t("relayPricingNoVisibleModels")}</p>;
  }

  const numericMultiplier = parsePositive(multiplier);

  return (
    <div className="relay-model-table-wrap">
      <table className="relay-model-table">
        <thead>
          <tr>
            <th>{t("relayPricingModel")}</th>
            {PRICE_FIELDS.map((field) => <th key={field.key}>{t(field.label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {officialPrices.map((officialPrice) => {
            const comparison = modelComparisons?.get(officialPrice.model);
            const providerRates = providerPriceMap.get(officialPrice.model) ?? officialPrice.rates;

            return (
              <tr key={officialPrice.model}>
                <td>
                  <div className="relay-model-name-cell">
                    {comparison?.isLowest && (
                      <span className="relay-model-lowest-badge">
                        {t("lowestTag")}
                      </span>
                    )}
                    {comparison && !comparison.isLowest && comparison.diffPercent !== null && (
                      <span className="relay-model-diff-badge">
                        <TrendingUp size={10} className="relay-model-diff-icon" aria-hidden="true" />
                        <span>{comparison.diffPercent}</span>
                      </span>
                    )}
                    <code>{officialPrice.model}</code>
                  </div>
                </td>
                {PRICE_FIELDS.map((field) => {
                  const baseRate = providerRates?.[field.key] ?? officialPrice.rates?.[field.key] ?? 0;
                  const hasMultiplier =
                    numericMultiplier !== null && Math.abs(numericMultiplier - 1) > 0.00001;
                  const effectivePrice =
                    numericMultiplier !== null && typeof baseRate === "number" ? baseRate * numericMultiplier : null;

                  return (
                    <td key={field.key}>
                      <div className="relay-readonly-rate">
                        {effectivePrice !== null && Number.isFinite(effectivePrice) ? (
                          <>
                            <strong>${formatDisplayRate(effectivePrice)} / 1M</strong>
                            {hasMultiplier && (
                              <small className="relay-rate-subtext">
                                <span>
                                  {t("relayPricingRelayBase", {
                                    price: formatDisplayRate(baseRate)
                                  })}
                                </span>
                              </small>
                            )}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface RelayBenchmarkModalProps {
  provider: DraftRelayProvider;
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  onClose: () => void;
  onApply: (providerId: string, updatedPrices: ProviderModelPricingDTO[]) => void;
  onSaveAsTemplate?: (name: string, prices: ProviderModelPricingDTO[]) => void;
}

type DraftModelPriceRow = {
  model: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cacheReadUsdPerMillion: string;
  cacheCreationUsdPerMillion: string;
};

const RelayBenchmarkModal: React.FC<RelayBenchmarkModalProps> = ({
  provider,
  officialPrices,
  onClose,
  onApply,
  onSaveAsTemplate
}) => {
  const { t } = useTranslation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const officialPriceMap = useMemo(
    () => new Map(officialPrices.map((p) => [p.model, p.rates])),
    [officialPrices]
  );

  const [draftRows, setDraftRows] = useState<DraftModelPriceRow[]>(() => {
    const providerMap = new Map((provider.modelPrices ?? []).map((p) => [p.model, p.rates]));
    return (officialPrices ?? []).map((official) => {
      const currentRates = providerMap.get(official.model) ?? official.rates;
      return {
        model: official.model,
        inputUsdPerMillion: formatPrice(currentRates?.inputUsdPerMillion ?? official.rates?.inputUsdPerMillion),
        outputUsdPerMillion: formatPrice(currentRates?.outputUsdPerMillion ?? official.rates?.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPrice(currentRates?.cacheReadUsdPerMillion ?? official.rates?.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPrice(currentRates?.cacheCreationUsdPerMillion ?? official.rates?.cacheCreationUsdPerMillion)
      };
    });
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const updateField = (model: string, key: keyof ModelPricingRatesDTO, value: string) => {
    setDraftRows((current) =>
      current.map((row) => (row.model === model ? { ...row, [key]: value } : row))
    );
    setErrorMessage(null);
  };

  const resetRowToOfficial = (model: string) => {
    const officialRate = officialPriceMap.get(model);
    if (!officialRate) {
      return;
    }
    setDraftRows((current) =>
      current.map((row) =>
        row.model === model
          ? {
              model,
              inputUsdPerMillion: formatPrice(officialRate.inputUsdPerMillion),
              outputUsdPerMillion: formatPrice(officialRate.outputUsdPerMillion),
              cacheReadUsdPerMillion: formatPrice(officialRate.cacheReadUsdPerMillion),
              cacheCreationUsdPerMillion: formatPrice(officialRate.cacheCreationUsdPerMillion)
            }
          : row
      )
    );
    setErrorMessage(null);
  };

  const resetAllToOfficial = () => {
    setDraftRows(
      (officialPrices ?? []).map((official) => ({
        model: official.model,
        inputUsdPerMillion: formatPrice(official.rates?.inputUsdPerMillion),
        outputUsdPerMillion: formatPrice(official.rates?.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPrice(official.rates?.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPrice(official.rates?.cacheCreationUsdPerMillion)
      }))
    );
    setErrorMessage(null);
  };

  const handleApply = () => {
    const parsedPrices: ProviderModelPricingDTO[] = [];

    for (const row of draftRows) {
      const input = parseNonNegative(row.inputUsdPerMillion);
      const output = parseNonNegative(row.outputUsdPerMillion);
      const cacheRead = parseNonNegative(row.cacheReadUsdPerMillion);
      const cacheCreation = parseNonNegative(row.cacheCreationUsdPerMillion);

      if (input === null || output === null || cacheRead === null || cacheCreation === null) {
        setErrorMessage(t("relayPricingRateError", { model: row.model }));
        return;
      }

      parsedPrices.push({
        model: row.model,
        rates: {
          inputUsdPerMillion: input,
          outputUsdPerMillion: output,
          cacheReadUsdPerMillion: cacheRead,
          cacheCreationUsdPerMillion: cacheCreation
        }
      });
    }

    onApply(provider.id, parsedPrices);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmark-modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="benchmark-modal-title">
              {t("relayPricingBenchmarkModalTitle")} - {provider.name || t("relayPricingRelay")}
            </h2>
            <p>{t("relayPricingBenchmarkModalDesc")}</p>
          </div>
          <button
            className="modal-close-btn"
            type="button"
            onClick={onClose}
            aria-label={t("relayPricingModalCancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && <div className="relay-modal-error">{errorMessage}</div>}

          <div className="relay-model-table-wrap">
            <table className="relay-modal-table">
              <thead>
                <tr>
                  <th>{t("relayPricingModel")}</th>
                  {PRICE_FIELDS.map((field) => (
                    <th key={field.key}>{t(field.label)}</th>
                  ))}
                  <th style={{ width: 90, textAlign: "center" }}>{t("relayPricingActions")}</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((row) => {
                  const officialRate = officialPriceMap.get(row.model);
                  const isModified =
                    officialRate !== undefined &&
                    (Math.abs(Number(row.inputUsdPerMillion) - (officialRate.inputUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.outputUsdPerMillion) - (officialRate.outputUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.cacheReadUsdPerMillion) - (officialRate.cacheReadUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.cacheCreationUsdPerMillion) - (officialRate.cacheCreationUsdPerMillion ?? 0)) > 1e-4);

                  return (
                    <tr key={row.model} className={isModified ? "is-modified" : ""}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <code>{row.model}</code>
                          {isModified && (
                            <span className="relay-row-modified-badge">
                              {t("relayPricingBenchmarkModified")}
                            </span>
                          )}
                        </div>
                      </td>
                      {PRICE_FIELDS.map((field) => {
                        const val = row[field.key];
                        const officialFieldVal = officialRate ? officialRate[field.key] : null;
                        const isFieldChanged =
                          officialFieldVal !== null &&
                          Math.abs(Number(val) - officialFieldVal) > 1e-4;

                        return (
                          <td key={field.key}>
                            <div className="relay-modal-input-wrap">
                              <span className="relay-affix-label">$</span>
                              <input
                                className={`relay-modal-input ${isFieldChanged ? "is-changed" : ""}`}
                                type="number"
                                min="0"
                                step="0.0001"
                                inputMode="decimal"
                                value={val}
                                placeholder={t("relayPricingModalInputPlaceholder")}
                                onChange={(event) =>
                                  updateField(row.model, field.key, event.target.value)
                                }
                              />
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center" }}>
                        {isModified ? (
                          <button
                            className="relay-row-reset-btn"
                            type="button"
                            onClick={() => resetRowToOfficial(row.model)}
                            title={t("relayPricingResetRow")}
                          >
                            <RotateCcw size={12} />
                            <span>{t("relayPricingResetRow")}</span>
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button
              className="action secondary"
              type="button"
              onClick={resetAllToOfficial}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <RotateCcw size={14} />
              <span>{t("relayPricingResetAllToOfficial")}</span>
            </button>
            {onSaveAsTemplate && (
              <button
                className="action secondary"
                type="button"
                onClick={() => {
                  const parsedPrices: ProviderModelPricingDTO[] = [];
                  for (const row of draftRows) {
                    const input = parseNonNegative(row.inputUsdPerMillion);
                    const output = parseNonNegative(row.outputUsdPerMillion);
                    const cacheRead = parseNonNegative(row.cacheReadUsdPerMillion);
                    const cacheCreation = parseNonNegative(row.cacheCreationUsdPerMillion);

                    if (input === null || output === null || cacheRead === null || cacheCreation === null) {
                      setErrorMessage(t("relayPricingRateError", { model: row.model }));
                      return;
                    }

                    parsedPrices.push({
                      model: row.model,
                      rates: {
                        inputUsdPerMillion: input,
                        outputUsdPerMillion: output,
                        cacheReadUsdPerMillion: cacheRead,
                        cacheCreationUsdPerMillion: cacheCreation
                      }
                    });
                  }
                  onSaveAsTemplate(
                    provider.name ? `${provider.name} - ${t("relayPricingTemplates")}` : t("relayPricingCreateTemplate"),
                    parsedPrices
                  );
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Bookmark size={14} />
                <span>{t("relayPricingSaveAsTemplate")}</span>
              </button>
            )}
          </div>
          <div className="modal-footer-actions">
            <button className="action secondary" type="button" onClick={onClose}>
              {t("relayPricingModalCancel")}
            </button>
            <button className="action primary" type="button" onClick={handleApply}>
              {t("relayPricingModalApply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PricingTemplatesModalProps {
  templates: PricingTemplateDTO[];
  relayProviders: DraftRelayProvider[];
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  onClose: () => void;
  onOpenCreate: () => void;
  onEditTemplate: (template: PricingTemplateDTO) => void;
  onDeleteTemplate: (templateId: string) => void;
}

const PricingTemplatesModal: React.FC<PricingTemplatesModalProps> = ({
  templates,
  relayProviders,
  onClose,
  onOpenCreate,
  onEditTemplate,
  onDeleteTemplate
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="templates-modal-title">{t("relayPricingTemplatesTitle")}</h2>
            <p>{t("relayPricingTemplatesDesc")}</p>
          </div>
          <button
            className="modal-close-btn"
            type="button"
            onClick={onClose}
            aria-label={t("relayPricingModalCancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="action primary"
              type="button"
              onClick={onOpenCreate}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Plus size={16} />
              <span>{t("relayPricingCreateTemplate")}</span>
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="relay-templates-empty">
              {t("relayPricingNoTemplates")}
            </div>
          ) : (
            <div className="relay-templates-list">
              {templates.map((template) => {
                const referencing = relayProviders.filter((p) => p.templateId === template.id);
                const refCount = referencing.length;
                const refNames = referencing.map((p) => p.name || t("relayPricingRelay")).join(", ");

                return (
                  <div key={template.id} className="relay-template-item">
                    <div className="relay-template-item-info">
                      <div className="relay-template-item-title">
                        <span>{template.name}</span>
                        {refCount > 0 && (
                          <span className="relay-template-ref-badge">
                            {t("relayPricingTemplateReferencedCount", { count: refCount })}
                          </span>
                        )}
                      </div>
                      {refCount > 0 && (
                        <div className="relay-template-item-meta">
                          {refNames}
                        </div>
                      )}
                    </div>
                    <div className="relay-template-item-actions">
                      <button
                        className="action secondary"
                        type="button"
                        onClick={() => onEditTemplate(template)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        <SlidersHorizontal size={14} />
                        <span>{t("relayPricingEditTemplate")}</span>
                      </button>
                      <button
                        className="relay-icon-button"
                        type="button"
                        onClick={() => onDeleteTemplate(template.id)}
                        aria-label={t("relayPricingTemplateDelete")}
                        title={t("relayPricingTemplateDelete")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="action secondary" type="button" onClick={onClose}>
            {t("relayPricingModalCancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PricingTemplateEditorModalProps {
  template: PricingTemplateDTO | null;
  initialSourceProviderId: string;
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  relayProviders: DraftRelayProvider[];
  referencingCount: number;
  existingTemplateNames: Set<string>;
  onClose: () => void;
  onSave: (template: PricingTemplateDTO) => void;
}

const PricingTemplateEditorModal: React.FC<PricingTemplateEditorModalProps> = ({
  template,
  initialSourceProviderId,
  officialPrices,
  relayProviders,
  referencingCount,
  existingTemplateNames,
  onClose,
  onSave
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(template?.name ?? "");
  const [selectedSource, setSelectedSource] = useState(initialSourceProviderId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const officialPriceMap = useMemo(
    () => new Map(officialPrices.map((p) => [p.model, p.rates])),
    [officialPrices]
  );

  const getSourcePrices = (sourceId: string): Map<string, ModelPricingRatesDTO> => {
    if (sourceId === "openai-official") {
      return new Map(officialPrices.map((p) => [p.model, p.rates]));
    }
    const provider = relayProviders.find((p) => p.id === sourceId);
    if (provider && provider.modelPrices) {
      return new Map(provider.modelPrices.map((p) => [p.model, p.rates]));
    }
    return new Map(officialPrices.map((p) => [p.model, p.rates]));
  };

  const [draftRows, setDraftRows] = useState<DraftModelPriceRow[]>(() => {
    if (template) {
      const templateMap = new Map(template.modelPrices.map((p) => [p.model, p.rates]));
      return (officialPrices ?? []).map((official) => {
        const currentRates = templateMap.get(official.model) ?? official.rates;
        return {
          model: official.model,
          inputUsdPerMillion: formatPrice(currentRates?.inputUsdPerMillion ?? official.rates?.inputUsdPerMillion),
          outputUsdPerMillion: formatPrice(currentRates?.outputUsdPerMillion ?? official.rates?.outputUsdPerMillion),
          cacheReadUsdPerMillion: formatPrice(currentRates?.cacheReadUsdPerMillion ?? official.rates?.cacheReadUsdPerMillion),
          cacheCreationUsdPerMillion: formatPrice(currentRates?.cacheCreationUsdPerMillion ?? official.rates?.cacheCreationUsdPerMillion)
        };
      });
    }
    const sourceMap = getSourcePrices(initialSourceProviderId);
    return (officialPrices ?? []).map((official) => {
      const currentRates = sourceMap.get(official.model) ?? official.rates;
      return {
        model: official.model,
        inputUsdPerMillion: formatPrice(currentRates?.inputUsdPerMillion ?? official.rates?.inputUsdPerMillion),
        outputUsdPerMillion: formatPrice(currentRates?.outputUsdPerMillion ?? official.rates?.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPrice(currentRates?.cacheReadUsdPerMillion ?? official.rates?.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPrice(currentRates?.cacheCreationUsdPerMillion ?? official.rates?.cacheCreationUsdPerMillion)
      };
    });
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSourceChange = (newSourceId: string) => {
    setSelectedSource(newSourceId);
    const sourceMap = getSourcePrices(newSourceId);
    setDraftRows(
      (officialPrices ?? []).map((official) => {
        const rates = sourceMap.get(official.model) ?? official.rates;
        return {
          model: official.model,
          inputUsdPerMillion: formatPrice(rates?.inputUsdPerMillion ?? official.rates?.inputUsdPerMillion),
          outputUsdPerMillion: formatPrice(rates?.outputUsdPerMillion ?? official.rates?.outputUsdPerMillion),
          cacheReadUsdPerMillion: formatPrice(rates?.cacheReadUsdPerMillion ?? official.rates?.cacheReadUsdPerMillion),
          cacheCreationUsdPerMillion: formatPrice(rates?.cacheCreationUsdPerMillion ?? official.rates?.cacheCreationUsdPerMillion)
        };
      })
    );
    setErrorMessage(null);
  };

  const updateField = (model: string, key: keyof ModelPricingRatesDTO, value: string) => {
    setDraftRows((current) =>
      current.map((row) => (row.model === model ? { ...row, [key]: value } : row))
    );
    setErrorMessage(null);
  };

  const resetRowToOfficial = (model: string) => {
    const officialRate = officialPriceMap.get(model);
    if (!officialRate) {
      return;
    }
    setDraftRows((current) =>
      current.map((row) =>
        row.model === model
          ? {
              model,
              inputUsdPerMillion: formatPrice(officialRate.inputUsdPerMillion),
              outputUsdPerMillion: formatPrice(officialRate.outputUsdPerMillion),
              cacheReadUsdPerMillion: formatPrice(officialRate.cacheReadUsdPerMillion),
              cacheCreationUsdPerMillion: formatPrice(officialRate.cacheCreationUsdPerMillion)
            }
          : row
      )
    );
    setErrorMessage(null);
  };

  const resetAllToOfficial = () => {
    setDraftRows(
      (officialPrices ?? []).map((official) => ({
        model: official.model,
        inputUsdPerMillion: formatPrice(official.rates?.inputUsdPerMillion),
        outputUsdPerMillion: formatPrice(official.rates?.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPrice(official.rates?.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPrice(official.rates?.cacheCreationUsdPerMillion)
      }))
    );
    setErrorMessage(null);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMessage(t("relayPricingTemplateNameRequired"));
      return;
    }
    if (existingTemplateNames.has(trimmed.toLowerCase())) {
      setErrorMessage(t("relayPricingTemplateDuplicateName"));
      return;
    }

    const parsedPrices: ProviderModelPricingDTO[] = [];
    for (const row of draftRows) {
      const input = parseNonNegative(row.inputUsdPerMillion);
      const output = parseNonNegative(row.outputUsdPerMillion);
      const cacheRead = parseNonNegative(row.cacheReadUsdPerMillion);
      const cacheCreation = parseNonNegative(row.cacheCreationUsdPerMillion);

      if (input === null || output === null || cacheRead === null || cacheCreation === null) {
        setErrorMessage(t("relayPricingRateError", { model: row.model }));
        return;
      }

      parsedPrices.push({
        model: row.model,
        rates: {
          inputUsdPerMillion: input,
          outputUsdPerMillion: output,
          cacheReadUsdPerMillion: cacheRead,
          cacheCreationUsdPerMillion: cacheCreation
        }
      });
    }

    onSave({
      id: template?.id ?? createProviderId(),
      name: trimmed,
      modelPrices: parsedPrices
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-editor-modal-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="template-editor-modal-title">
              {template ? t("relayPricingEditTemplate") : t("relayPricingCreateTemplate")}
            </h2>
            <p>{t("relayPricingBenchmarkModalDesc")}</p>
          </div>
          <button
            className="modal-close-btn"
            type="button"
            onClick={onClose}
            aria-label={t("relayPricingModalCancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && <div className="relay-modal-error">{errorMessage}</div>}

          <div className="relay-template-form-row">
            <div className="relay-template-form-group">
              <label className="relay-field-label" htmlFor="template-name-input">
                {t("relayPricingTemplateName")}
              </label>
              <input
                id="template-name-input"
                className="relay-plain-input"
                value={name}
                placeholder={t("relayPricingTemplateNamePlaceholder")}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrorMessage(null);
                }}
                autoFocus
              />
            </div>
            {!template && (
              <div className="relay-template-form-group">
                <label className="relay-field-label" htmlFor="template-source-select">
                  {t("relayPricingInitialSource")}
                </label>
                <select
                  id="template-source-select"
                  className="relay-plain-select"
                  value={selectedSource}
                  onChange={(e) => handleSourceChange(e.target.value)}
                >
                  <option value="openai-official">{t("relayPricingSourceOfficial")}</option>
                  {relayProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {t("relayPricingSourceProvider", { name: provider.name || t("relayPricingRelay") })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {referencingCount > 0 && (
            <div className="relay-modal-notice">
              <CircleAlert size={15} />
              <span>{t("relayPricingTemplateInUseNotice", { count: referencingCount })}</span>
            </div>
          )}

          <div className="relay-model-table-wrap">
            <table className="relay-modal-table">
              <thead>
                <tr>
                  <th>{t("relayPricingModel")}</th>
                  {PRICE_FIELDS.map((field) => (
                    <th key={field.key}>{t(field.label)}</th>
                  ))}
                  <th style={{ width: 90, textAlign: "center" }}>{t("relayPricingActions")}</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((row) => {
                  const officialRate = officialPriceMap.get(row.model);
                  const isModified =
                    officialRate !== undefined &&
                    (Math.abs(Number(row.inputUsdPerMillion) - (officialRate.inputUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.outputUsdPerMillion) - (officialRate.outputUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.cacheReadUsdPerMillion) - (officialRate.cacheReadUsdPerMillion ?? 0)) > 1e-4 ||
                      Math.abs(Number(row.cacheCreationUsdPerMillion) - (officialRate.cacheCreationUsdPerMillion ?? 0)) > 1e-4);

                  return (
                    <tr key={row.model} className={isModified ? "is-modified" : ""}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <code>{row.model}</code>
                          {isModified && (
                            <span className="relay-row-modified-badge">
                              {t("relayPricingBenchmarkModified")}
                            </span>
                          )}
                        </div>
                      </td>
                      {PRICE_FIELDS.map((field) => {
                        const val = row[field.key];
                        const officialFieldVal = officialRate ? officialRate[field.key] : null;
                        const isFieldChanged =
                          officialFieldVal !== null &&
                          Math.abs(Number(val) - officialFieldVal) > 1e-4;

                        return (
                          <td key={field.key}>
                            <div className="relay-modal-input-wrap">
                              <span className="relay-affix-label">$</span>
                              <input
                                className={`relay-modal-input ${isFieldChanged ? "is-changed" : ""}`}
                                type="number"
                                min="0"
                                step="0.0001"
                                inputMode="decimal"
                                value={val}
                                placeholder={t("relayPricingModalInputPlaceholder")}
                                onChange={(event) =>
                                  updateField(row.model, field.key, event.target.value)
                                }
                              />
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center" }}>
                        {isModified ? (
                          <button
                            className="relay-row-reset-btn"
                            type="button"
                            onClick={() => resetRowToOfficial(row.model)}
                            title={t("relayPricingResetRow")}
                          >
                            <RotateCcw size={12} />
                            <span>{t("relayPricingResetRow")}</span>
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="action secondary"
            type="button"
            onClick={resetAllToOfficial}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RotateCcw size={14} />
            <span>{t("relayPricingResetAllToOfficial")}</span>
          </button>
          <div className="modal-footer-actions">
            <button className="action secondary" type="button" onClick={onClose}>
              {t("relayPricingModalCancel")}
            </button>
            <button className="action primary" type="button" onClick={handleSave}>
              {t("relayPricingSaveTemplate")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

