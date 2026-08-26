import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CircleDollarSign,
  Plus,
  Save,
  Trash2,
  TrendingUp
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { updatePricingProviders } from "../api/tauri";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type {
  ModelPricingRatesDTO,
  PricingProviderDTO,
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
};

export type ProviderModelPriceComparison = {
  isLowest: boolean;
  diffPercent: string | null;
};

type DraftRelayProvider = {
  id: string;
  name: string;
  enabled: boolean;
  rechargeRatioUsdPerRmb: string;
  multiplier: string;
};

function formatPrice(value: number): string {
  return value.toFixed(4);
}

function formatDisplayRate(value: number): string {
  return Number.isInteger(Math.round(value * 10000) / 10)
    ? value.toFixed(3)
    : value.toFixed(4);
}

function toDraftProvider(provider: PricingProviderDTO): DraftRelayProvider {
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    rechargeRatioUsdPerRmb:
      provider.rechargeRatioUsdPerRmb === null
        ? ""
        : formatPrice(provider.rechargeRatioUsdPerRmb),
    multiplier:
      provider.multiplier === null || provider.multiplier === undefined
        ? "1.0000"
        : formatPrice(provider.multiplier)
  };
}

function createProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `relay-${Date.now()}`;
}

export function parsePositive(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function computeLowestModelsByProvider(
  providers: ComparableProviderInput[],
  modelPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>
): Map<string, Map<string, ProviderModelPriceComparison>> {
  const comparable: Array<{
    id: string;
    multiplier: number;
    rechargeRatio: number;
  }> = [];

  for (const p of providers) {
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
        rechargeRatio: ratio
      });
    }
  }

  const result = new Map<string, Map<string, ProviderModelPriceComparison>>();
  for (const p of providers) {
    result.set(p.id, new Map());
  }

  if (comparable.length < 2) {
    return result;
  }

  for (const price of modelPrices) {
    const baseRate = price.rates.inputUsdPerMillion;
    const rateToCompare = baseRate > 0 ? baseRate : 1;

    let minCostRmb = Number.POSITIVE_INFINITY;
    const providerCosts: Array<{ id: string; costRmb: number }> = [];

    for (const p of comparable) {
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
  const [relayProviders, setRelayProviders] = useState<DraftRelayProvider[]>([]);
  const [openaiRatio, setOpenaiRatio] = useState(DEFAULT_OPENAI_RATIO);
  const [showOfficial, setShowOfficial] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RELAY_PRICING_SHOW_OFFICIAL_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [visibleModels, setVisibleModels] = useState<Set<string>>(() => {
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
  const [hasInitializedVisibleModels, setHasInitializedVisibleModels] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const handleToggleOfficial = (enabled: boolean) => {
    setShowOfficial(enabled);
    try {
      localStorage.setItem(RELAY_PRICING_SHOW_OFFICIAL_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
  };

  const providers = dashboard?.meta.pricingProviders ?? [];
  const officialProvider = providers.find((provider) => provider.kind === "official");
  const officialModels = officialProvider?.modelPrices?.map((price) => price.model) ?? [];

  useEffect(() => {
    if (officialModels.length > 0 && !hasInitializedVisibleModels) {
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
  }, [officialModels, hasInitializedVisibleModels]);

  const handleToggleModelVisibility = (model: string, visible: boolean) => {
    setVisibleModels((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(model);
      } else {
        next.delete(model);
      }
      try {
        localStorage.setItem(
          RELAY_PRICING_VISIBLE_MODELS_STORAGE_KEY,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // ignore
      }
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
        rechargeRatioUsdPerRmb: openaiRatio
      });
    }
    for (const provider of relayProviders) {
      allProviders.push({
        id: provider.id,
        multiplier: provider.multiplier,
        rechargeRatioUsdPerRmb: provider.rechargeRatioUsdPerRmb
      });
    }
    return computeLowestModelsByProvider(allProviders, officialProvider?.modelPrices ?? []);
  }, [showOfficial, officialProvider, openaiRatio, relayProviders]);

  useEffect(() => {
    if (isDirty || !officialProvider) {
      return;
    }
    setOpenaiRatio(
      officialProvider.rechargeRatioUsdPerRmb === null
        ? DEFAULT_OPENAI_RATIO
        : formatPrice(officialProvider.rechargeRatioUsdPerRmb)
    );
    setRelayProviders(
      providers.filter((provider) => provider.kind === "relay").map(toDraftProvider)
    );
  }, [isDirty, officialProvider, providers]);

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
        multiplier: "1.0000"
      }
    ]);
    markDirty();
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
        modelPrices: []
      });
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await updatePricingProviders(payload, parsedOpenaiRatio);
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
          <div className="relay-header-actions">
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
            <button className="action primary" type="button" onClick={() => void saveProviders()} disabled={controlsDisabled || !isDirty}>
              <Save className="action-icon" size={16} />
              <span>{isSaving ? t("relayPricingSaving") : t("relayPricingSave")}</span>
            </button>
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
            officialPrices={visibleOfficialPrices}
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
          />
        ))}
      </section>

      <button className="relay-add-provider" type="button" onClick={addRelayProvider} disabled={controlsDisabled}>
        <Plus size={18} />
        <span>{t("relayPricingAddProvider")}</span>
      </button>
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
      </div>
      <OfficialModelTable
        prices={provider.modelPrices ?? []}
        visibleModels={visibleModels}
        onToggleModelVisibility={onToggleModelVisibility}
        modelComparisons={modelComparisons}
      />
      <div className="relay-provider-footer relay-official-footer">
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
    </article>
  );
};

const RelayProviderCard: React.FC<{
  provider: DraftRelayProvider;
  officialPrices: Array<{ model: string; rates: ModelPricingRatesDTO }>;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
  controlsDisabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onUpdate: (id: string, update: (provider: DraftRelayProvider) => DraftRelayProvider) => void;
  onRemove: () => void;
}> = ({
  provider,
  officialPrices,
  modelComparisons,
  controlsDisabled,
  isDirty,
  isSaving,
  onSave,
  onUpdate,
  onRemove
}) => {
  const { t } = useTranslation();

  return (
    <article className={`relay-provider-card panel ${provider.enabled ? "is-enabled" : "is-disabled"}`}>
      <div className="relay-provider-head">
        <span className="relay-provider-type">{t("relayPricingRelay")}</span>
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
      </div>
      <RelayRatePreviewTable
        officialPrices={officialPrices}
        multiplier={provider.multiplier}
        modelComparisons={modelComparisons}
      />
      <div className="relay-provider-footer">
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
                      <strong>${formatPrice(price.rates[field.key])} / 1M</strong>
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
  multiplier: string;
  modelComparisons?: Map<string, ProviderModelPriceComparison>;
}> = ({ officialPrices, multiplier, modelComparisons }) => {
  const { t } = useTranslation();
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
          {officialPrices.map((price) => {
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
                {PRICE_FIELDS.map((field) => {
                  const baseRate = price.rates[field.key];
                  const hasMultiplier =
                    numericMultiplier !== null && Math.abs(numericMultiplier - 1) > 0.00001;
                  const effectivePrice =
                    numericMultiplier !== null ? baseRate * numericMultiplier : null;

                  return (
                    <td key={field.key}>
                      <div className="relay-readonly-rate">
                        {effectivePrice !== null ? (
                          <>
                            <strong>${formatDisplayRate(effectivePrice)} / 1M</strong>
                            {hasMultiplier && (
                              <small className="relay-rate-subtext">
                                <span>
                                  {t("relayPricingOfficialBase", {
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
