import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BadgeDollarSign,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  Plus,
  Save,
  Trash2
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { updatePricingProviders } from "../api/tauri";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type {
  ModelPricingRatesDTO,
  PricingProviderDTO,
  RelayPricingProviderDTO,
  UsagePeriod
} from "../dto/dashboard";
import type { PageSourceId } from "../types";
import { formatCurrency, periodLabel } from "../utils/format";

export const RELAY_PRICING_PAGE_SOURCE_ID: PageSourceId = "src/views/RelayPricingView.tsx";

const DEFAULT_OPENAI_RATIO = "0.1400";
const MIGRATED_RELAY_PROVIDER_ID = "migrated-relay";
const PRICE_FIELDS: Array<{ key: keyof ModelPricingRatesDTO; label: string }> = [
  { key: "inputUsdPerMillion", label: "relayPricingInput" },
  { key: "outputUsdPerMillion", label: "relayPricingOutput" },
  { key: "cacheReadUsdPerMillion", label: "relayPricingCacheRead" },
  { key: "cacheCreationUsdPerMillion", label: "relayPricingCacheCreation" }
];

type DraftModelPrice = {
  model: string;
  rates: Record<keyof ModelPricingRatesDTO, string>;
};

type DraftRelayProvider = {
  id: string;
  name: string;
  enabled: boolean;
  rechargeRatioUsdPerRmb: string;
  modelPrices: DraftModelPrice[];
};

function formatPrice(value: number): string {
  return value.toFixed(4);
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
    modelPrices: provider.modelPrices.map((price) => ({
      model: price.model,
      rates: {
        inputUsdPerMillion: formatPrice(price.rates.inputUsdPerMillion),
        outputUsdPerMillion: formatPrice(price.rates.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPrice(price.rates.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPrice(price.rates.cacheCreationUsdPerMillion)
      }
    }))
  };
}

function emptyRates(): DraftModelPrice["rates"] {
  return {
    inputUsdPerMillion: "0.0000",
    outputUsdPerMillion: "0.0000",
    cacheReadUsdPerMillion: "0.0000",
    cacheCreationUsdPerMillion: "0.0000"
  };
}

function createProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `relay-${Date.now()}`;
}

function parseNonNegative(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositive(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const RelayPricingView: React.FC = () => {
  const { t } = useTranslation();
  const { dashboard, locale, isLoading, isSyncing, loadDashboard } = useApp();
  const [relayProviders, setRelayProviders] = useState<DraftRelayProvider[]>([]);
  const [openaiRatio, setOpenaiRatio] = useState(DEFAULT_OPENAI_RATIO);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [period, setPeriod] = useState<UsagePeriod>("monthToDate");
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const providers = dashboard?.meta.pricingProviders ?? [];
  const officialProvider = providers.find((provider) => provider.kind === "official");

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

  const comparison = dashboard?.providerCostComparisons.find((item) => item.period === period);
  const comparisonRows = useMemo(() => {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    return (comparison?.providers ?? [])
      .map((row) => ({ ...row, provider: byId.get(row.providerId) }))
      .filter((row): row is typeof row & { provider: PricingProviderDTO } => Boolean(row.provider))
      .sort((left, right) => {
        if (left.isComplete !== right.isComplete) {
          return left.isComplete ? -1 : 1;
        }
        return (left.costCny ?? Number.POSITIVE_INFINITY) - (right.costCny ?? Number.POSITIVE_INFINITY);
      });
  }, [comparison?.providers, providers]);

  const comparisonUsable = comparisonRows.filter((row) => row.isComplete);
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
        modelPrices: []
      }
    ]);
    markDirty();
  };

  const addModelPrice = (providerId: string) => {
    updateRelay(providerId, (provider) => ({
      ...provider,
      modelPrices: [...provider.modelPrices, { model: "", rates: emptyRates() }]
    }));
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

      const modelNames = new Set<string>();
      const modelPrices = [];
      for (const modelPrice of provider.modelPrices) {
        const model = modelPrice.model.trim();
        if (!model) {
          setSaveError(t("relayPricingModelNameError", { provider: name }));
          return;
        }
        const identity = model.toLowerCase();
        if (modelNames.has(identity)) {
          setSaveError(t("relayPricingDuplicateModelError", { model }));
          return;
        }
        modelNames.add(identity);

        const rates = {} as ModelPricingRatesDTO;
        for (const field of PRICE_FIELDS) {
          const value = parseNonNegative(modelPrice.rates[field.key]);
          if (value === null) {
            setSaveError(t("relayPricingRateError", { model }));
            return;
          }
          rates[field.key] = value;
        }
        modelPrices.push({ model, rates });
      }

      payload.push({
        id: provider.id,
        name,
        enabled: provider.enabled,
        rechargeRatioUsdPerRmb: ratio,
        modelPrices
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

  const formatCny = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CNY",
      currencyDisplay: locale === "zh-CN" ? "narrowSymbol" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);

  const rmbEquivalent = (price: string, ratio: string) => {
    const numericPrice = parseNonNegative(price);
    const numericRatio = parsePositive(ratio);
    return numericPrice === null || numericRatio === null
      ? t("relayPricingRmbUnavailable")
      : `${formatCny(numericPrice / numericRatio)} / 1M`;
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
          <button className="action primary" type="button" onClick={() => void saveProviders()} disabled={controlsDisabled || !isDirty}>
            <Save className="action-icon" size={16} />
            <span>{isSaving ? t("relayPricingSaving") : t("relayPricingSave")}</span>
          </button>
        }
      />

      <section className="relay-comparison panel" aria-labelledby="relay-comparison-title">
        <div className="relay-section-head">
          <div>
            <span className="relay-section-kicker"><BadgeDollarSign size={15} /> {t("relayPricingCompareKicker")}</span>
            <h2 id="relay-comparison-title">{t("relayPricingCompareTitle")}</h2>
            <p>{t("relayPricingCompareDescription")}</p>
          </div>
          <label className="relay-period-select">
            <span>{t("relayPricingPeriod")}</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value as UsagePeriod)}>
              {(["today", "last7Days", "monthToDate"] as UsagePeriod[]).map((value) => (
                <option key={value} value={value}>{periodLabel(value, locale)}</option>
              ))}
            </select>
          </label>
        </div>

        {comparisonRows.length === 0 ? (
          <p className="relay-empty-comparison">{t("relayPricingNoUsage")}</p>
        ) : (
          <div className="relay-comparison-grid">
            {comparisonRows.map((row, index) => (
              <article key={row.providerId} className={`relay-cost-card ${index === 0 && row.isComplete ? "is-lowest" : ""} ${!row.isComplete ? "is-incomplete" : ""}`}>
                <div className="relay-cost-card-head">
                  <div>
                    <strong>{row.provider.name}</strong>
                    <span>{row.provider.kind === "official" ? t("relayPricingOfficial") : t("relayPricingRelay")}</span>
                  </div>
                  {index === 0 && row.isComplete && <span className="relay-lowest-badge"><CheckCircle2 size={14} /> {t("relayPricingLowest")}</span>}
                </div>
                {row.isComplete && row.costUsd !== null && row.costCny !== null ? (
                  <>
                    <strong className="relay-cost-cny">{formatCny(row.costCny)}</strong>
                    <span className="relay-cost-usd">{formatCurrency(row.costUsd, locale)} {t("relayPricingCreditCost")}</span>
                  </>
                ) : (
                  <div className="relay-incomplete-copy"><CircleAlert size={16} /> {t("relayPricingIncomplete")}</div>
                )}
                {row.fallbackModels.length > 0 && <p className="relay-cost-note">{t("relayPricingFallback", { models: row.fallbackModels.join(", ") })}</p>}
                {row.unpricedModels.length > 0 && <p className="relay-cost-note is-warning">{t("relayPricingUnpriced", { models: row.unpricedModels.join(", ") })}</p>}
              </article>
            ))}
          </div>
        )}
        {comparisonUsable.length > 0 && <p className="relay-comparison-footnote"><ArrowDownToLine size={14} /> {t("relayPricingCompareFootnote")}</p>}
      </section>

      {saveError && <div className="relay-error-summary" ref={errorSummaryRef} tabIndex={-1} role="alert"><CircleAlert size={17} /> {saveError}</div>}
      {saveNotice && <p className="config-feedback good" role="status">{saveNotice}</p>}

      <section className="relay-provider-list" aria-label={t("relayPricingProvidersAria")}>
        {officialProvider && (
          <OfficialProviderCard
            provider={officialProvider}
            openaiRatio={openaiRatio}
            controlsDisabled={controlsDisabled}
            onRatioChange={(value) => {
              setOpenaiRatio(value);
              markDirty();
            }}
            rmbEquivalent={rmbEquivalent}
          />
        )}

        {relayProviders.map((provider) => (
          <RelayProviderCard
            key={provider.id}
            provider={provider}
            controlsDisabled={controlsDisabled}
            onUpdate={updateRelay}
            onRemove={() => {
              setRelayProviders((current) => current.filter((item) => item.id !== provider.id));
              markDirty();
            }}
            onAddModel={() => addModelPrice(provider.id)}
            rmbEquivalent={rmbEquivalent}
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
  controlsDisabled: boolean;
  onRatioChange: (value: string) => void;
  rmbEquivalent: (price: string, ratio: string) => string;
}> = ({ provider, openaiRatio, controlsDisabled, onRatioChange, rmbEquivalent }) => {
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
      <RatioField value={openaiRatio} disabled={controlsDisabled} onChange={onRatioChange} />
      <ModelPriceTable prices={provider.modelPrices.map((price) => ({
        model: price.model,
        rates: Object.fromEntries(PRICE_FIELDS.map((field) => [field.key, formatPrice(price.rates[field.key])])) as DraftModelPrice["rates"]
      }))} ratio={openaiRatio} disabled readOnly rmbEquivalent={rmbEquivalent} />
    </article>
  );
};

const RelayProviderCard: React.FC<{
  provider: DraftRelayProvider;
  controlsDisabled: boolean;
  onUpdate: (id: string, update: (provider: DraftRelayProvider) => DraftRelayProvider) => void;
  onRemove: () => void;
  onAddModel: () => void;
  rmbEquivalent: (price: string, ratio: string) => string;
}> = ({ provider, controlsDisabled, onUpdate, onRemove, onAddModel, rmbEquivalent }) => {
  const { t } = useTranslation();
  return (
    <article className={`relay-provider-card panel ${provider.enabled ? "is-enabled" : "is-disabled"}`}>
      <div className="relay-provider-head">
        <div className="relay-provider-name-field">
          <span className="relay-provider-type">{t("relayPricingRelay")}</span>
          <label className="sr-only" htmlFor={`relay-name-${provider.id}`}>{t("relayPricingProviderName")}</label>
          <input
            id={`relay-name-${provider.id}`}
            value={provider.name}
            placeholder={t("relayPricingProviderNamePlaceholder")}
            onChange={(event) => onUpdate(provider.id, (item) => ({ ...item, name: event.target.value }))}
            disabled={controlsDisabled}
          />
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
          <button className="relay-icon-button" type="button" onClick={onRemove} disabled={controlsDisabled} aria-label={t("relayPricingDeleteProvider")} title={t("relayPricingDeleteProvider")}>
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <RatioField
        value={provider.rechargeRatioUsdPerRmb}
        disabled={controlsDisabled}
        onChange={(value) => onUpdate(provider.id, (item) => ({ ...item, rechargeRatioUsdPerRmb: value }))}
      />
      <ModelPriceTable
        prices={provider.modelPrices}
        ratio={provider.rechargeRatioUsdPerRmb}
        disabled={controlsDisabled}
        rmbEquivalent={rmbEquivalent}
        onChange={(index, update) => onUpdate(provider.id, (item) => ({
          ...item,
          modelPrices: item.modelPrices.map((price, candidate) => candidate === index ? update(price) : price)
        }))}
        onRemove={(index) => onUpdate(provider.id, (item) => ({
          ...item,
          modelPrices: item.modelPrices.filter((_, candidate) => candidate !== index)
        }))}
      />
      <button className="relay-add-model" type="button" onClick={onAddModel} disabled={controlsDisabled}>
        <Plus size={16} /> {t("relayPricingAddModel")}
      </button>
    </article>
  );
};

const RatioField: React.FC<{ value: string; disabled: boolean; onChange: (value: string) => void }> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation();
  return (
    <label className="relay-ratio-field">
      <span>{t("relayPricingRechargeRatio")}</span>
      <span className="relay-ratio-input"><span>1 RMB =</span><input type="number" min="0" step="0.0001" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /><span>$</span></span>
      <small>{t("relayPricingRechargeRatioHint")}</small>
    </label>
  );
};

const ModelPriceTable: React.FC<{
  prices: DraftModelPrice[];
  ratio: string;
  disabled: boolean;
  readOnly?: boolean;
  rmbEquivalent: (price: string, ratio: string) => string;
  onChange?: (index: number, update: (price: DraftModelPrice) => DraftModelPrice) => void;
  onRemove?: (index: number) => void;
}> = ({ prices, ratio, disabled, readOnly = false, rmbEquivalent, onChange, onRemove }) => {
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
            {!readOnly && <th><span className="sr-only">{t("relayPricingActions")}</span></th>}
          </tr>
        </thead>
        <tbody>
          {prices.map((price, index) => (
            <tr key={`${price.model}-${index}`}>
              <td>
                {readOnly ? <code>{price.model}</code> : <input value={price.model} placeholder="gpt-5.6-sol" onChange={(event) => onChange?.(index, (item) => ({ ...item, model: event.target.value }))} disabled={disabled} aria-label={t("relayPricingModel")} />}
              </td>
              {PRICE_FIELDS.map((field) => (
                <td key={field.key}>
                  {readOnly ? (
                    <div className="relay-readonly-rate"><strong>${price.rates[field.key]} / 1M</strong><small>{rmbEquivalent(price.rates[field.key], ratio)}</small></div>
                  ) : (
                    <label className="relay-rate-input">
                      <span className="sr-only">{t(field.label)}</span>
                      <span>$</span><input type="number" min="0" step="0.0001" inputMode="decimal" value={price.rates[field.key]} onChange={(event) => onChange?.(index, (item) => ({ ...item, rates: { ...item.rates, [field.key]: event.target.value } }))} disabled={disabled} />
                      <small>{rmbEquivalent(price.rates[field.key], ratio)}</small>
                    </label>
                  )}
                </td>
              ))}
              {!readOnly && <td><button className="relay-icon-button" type="button" onClick={() => onRemove?.(index)} disabled={disabled} aria-label={t("relayPricingDeleteModel")} title={t("relayPricingDeleteModel")}><Trash2 size={16} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
