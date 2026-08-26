import React, { useEffect, useMemo, useRef, useState } from "react";
import {
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
  RelayPricingProviderDTO
} from "../dto/dashboard";
import type { PageSourceId } from "../types";

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
  multiplier: string;
  modelPrices: DraftModelPrice[];
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
        : formatPrice(provider.multiplier),
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
  const { dashboard, isLoading, isSyncing, loadDashboard } = useApp();
  const [relayProviders, setRelayProviders] = useState<DraftRelayProvider[]>([]);
  const [openaiRatio, setOpenaiRatio] = useState(DEFAULT_OPENAI_RATIO);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const providers = dashboard?.meta.pricingProviders ?? [];
  const officialProvider = providers.find((provider) => provider.kind === "official");
  const officialModels = useMemo(
    () => officialProvider?.modelPrices.map((price) => price.model) ?? [],
    [officialProvider]
  );

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
        multiplier: "1.0000",
        modelPrices: []
      }
    ]);
    markDirty();
  };

  const addModelPrice = (providerId: string) => {
    updateRelay(providerId, (provider) => {
      const usedModels = new Set(
        provider.modelPrices.map((price) => price.model.trim().toLowerCase())
      );
      const availableModels = officialModels.filter(
        (model) => !usedModels.has(model.toLowerCase())
      );
      const nextModel = availableModels[0] ?? "";
      const officialMatch = officialProvider?.modelPrices.find(
        (p) => p.model.toLowerCase() === nextModel.toLowerCase()
      );
      const initialRates = officialMatch
        ? {
            inputUsdPerMillion: formatPrice(officialMatch.rates.inputUsdPerMillion),
            outputUsdPerMillion: formatPrice(officialMatch.rates.outputUsdPerMillion),
            cacheReadUsdPerMillion: formatPrice(officialMatch.rates.cacheReadUsdPerMillion),
            cacheCreationUsdPerMillion: formatPrice(officialMatch.rates.cacheCreationUsdPerMillion)
          }
        : emptyRates();

      return {
        ...provider,
        modelPrices: [...provider.modelPrices, { model: nextModel, rates: initialRates }]
      };
    });
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
        multiplier,
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

      {saveError && <div className="relay-error-summary" ref={errorSummaryRef} tabIndex={-1} role="alert"><CircleAlert size={17} /> {saveError}</div>}
      {saveNotice && <p className="config-feedback good" role="status">{saveNotice}</p>}

      <section className="relay-provider-list" aria-label={t("relayPricingProvidersAria")}>
        {relayProviders.map((provider) => (
          <RelayProviderCard
            key={provider.id}
            provider={provider}
            officialModels={officialModels}
            officialProvider={officialProvider}
            controlsDisabled={controlsDisabled}
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void saveProviders()}
            onUpdate={updateRelay}
            onRemove={() => {
              setRelayProviders((current) => current.filter((item) => item.id !== provider.id));
              markDirty();
            }}
            onAddModel={() => addModelPrice(provider.id)}
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

const RelayProviderCard: React.FC<{
  provider: DraftRelayProvider;
  officialModels: string[];
  officialProvider?: PricingProviderDTO;
  controlsDisabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onUpdate: (id: string, update: (provider: DraftRelayProvider) => DraftRelayProvider) => void;
  onRemove: () => void;
  onAddModel: () => void;
}> = ({
  provider,
  officialModels,
  officialProvider,
  controlsDisabled,
  isDirty,
  isSaving,
  onSave,
  onUpdate,
  onRemove,
  onAddModel
}) => {
  const { t } = useTranslation();
  const usedModels = useMemo(
    () => new Set(provider.modelPrices.map((price) => price.model.trim().toLowerCase())),
    [provider.modelPrices]
  );
  const availableOfficialModels = useMemo(
    () => officialModels.filter((model) => !usedModels.has(model.toLowerCase())),
    [officialModels, usedModels]
  );
  const canAddModel = officialModels.length === 0 || availableOfficialModels.length > 0;

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
      <div className="relay-provider-config-row">
        <RatioField
          value={provider.rechargeRatioUsdPerRmb}
          disabled={controlsDisabled}
          onChange={(value) => onUpdate(provider.id, (item) => ({ ...item, rechargeRatioUsdPerRmb: value }))}
        />
        <MultiplierField
          value={provider.multiplier}
          disabled={controlsDisabled}
          onChange={(value) => onUpdate(provider.id, (item) => ({ ...item, multiplier: value }))}
        />
      </div>
      <ModelPriceTable
        prices={provider.modelPrices}
        multiplier={provider.multiplier}
        disabled={controlsDisabled}
        officialModels={officialModels}
        officialProvider={officialProvider}
        onChange={(index, update) => onUpdate(provider.id, (item) => ({
          ...item,
          modelPrices: item.modelPrices.map((price, candidate) => candidate === index ? update(price) : price)
        }))}
        onRemove={(index) => onUpdate(provider.id, (item) => ({
          ...item,
          modelPrices: item.modelPrices.filter((_, candidate) => candidate !== index)
        }))}
      />
      <div className="relay-provider-footer">
        <button className="relay-add-model" type="button" onClick={onAddModel} disabled={controlsDisabled || !canAddModel}>
          <Plus size={16} /> {t("relayPricingAddModel")}
        </button>
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

const MultiplierField: React.FC<{ value: string; disabled: boolean; onChange: (value: string) => void }> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation();
  return (
    <label className="relay-multiplier-field">
      <span>{t("relayPricingMultiplier")}</span>
      <span className="relay-multiplier-input"><span>×</span><input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /></span>
      <small>{t("relayPricingMultiplierHint")}</small>
    </label>
  );
};

const ModelPriceTable: React.FC<{
  prices: DraftModelPrice[];
  multiplier: string;
  disabled: boolean;
  readOnly?: boolean;
  officialModels?: string[];
  officialProvider?: PricingProviderDTO;
  onChange?: (index: number, update: (price: DraftModelPrice) => DraftModelPrice) => void;
  onRemove?: (index: number) => void;
}> = ({ prices, multiplier, disabled, readOnly = false, officialModels = [], officialProvider, onChange, onRemove }) => {
  const { t } = useTranslation();
  if (prices.length === 0) {
    return <p className="relay-no-models">{t("relayPricingNoModels")}</p>;
  }

  const numericMultiplier = parsePositive(multiplier);

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
          {prices.map((price, index) => {
            const otherSelectedModels = new Set(
              prices
                .filter((_, i) => i !== index)
                .map((p) => p.model.trim().toLowerCase())
                .filter(Boolean)
            );
            const availableOptions = officialModels.filter(
              (model) => !otherSelectedModels.has(model.toLowerCase())
            );
            const isCurrentModelInOptions = availableOptions.some(
              (m) => m.toLowerCase() === price.model.trim().toLowerCase()
            );
            const selectOptions =
              price.model && !isCurrentModelInOptions
                ? [price.model, ...availableOptions]
                : availableOptions;

            return (
              <tr key={`${index}-${price.model}`}>
                <td>
                  {readOnly ? (
                    <code>{price.model}</code>
                  ) : (
                    <select
                      value={price.model}
                      onChange={(event) => {
                        const newModel = event.target.value;
                        const officialMatch = officialProvider?.modelPrices.find(
                          (p) => p.model.toLowerCase() === newModel.toLowerCase()
                        );
                        onChange?.(index, (item) => ({
                          ...item,
                          model: newModel,
                          rates: officialMatch
                            ? {
                                inputUsdPerMillion: formatPrice(officialMatch.rates.inputUsdPerMillion),
                                outputUsdPerMillion: formatPrice(officialMatch.rates.outputUsdPerMillion),
                                cacheReadUsdPerMillion: formatPrice(officialMatch.rates.cacheReadUsdPerMillion),
                                cacheCreationUsdPerMillion: formatPrice(officialMatch.rates.cacheCreationUsdPerMillion)
                              }
                            : item.rates
                        }));
                      }}
                      disabled={disabled}
                      aria-label={t("relayPricingModel")}
                    >
                      {!price.model && (
                        <option value="" disabled>
                          {t("relayPricingSelectModel")}
                        </option>
                      )}
                      {selectOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                {PRICE_FIELDS.map((field) => {
                  const numericRate = parseNonNegative(price.rates[field.key]);
                  const hasMultiplier =
                    numericRate !== null &&
                    numericMultiplier !== null &&
                    Math.abs(numericMultiplier - 1) > 0.00001;
                  const effectivePrice =
                    numericRate !== null && numericMultiplier !== null
                      ? numericRate * numericMultiplier
                      : numericRate;
                  const actualPriceText =
                    hasMultiplier && effectivePrice !== null
                      ? `$${formatDisplayRate(effectivePrice)}`
                      : null;

                  return (
                    <td key={field.key}>
                      {readOnly ? (
                        <div className="relay-readonly-rate">
                          <strong>${price.rates[field.key]} / 1M</strong>
                          {actualPriceText && (
                            <small className="relay-rate-subtext">
                              <span className="relay-actual-price">
                                {t("relayPricingActualPrice", { price: actualPriceText })}
                              </span>
                            </small>
                          )}
                        </div>
                      ) : (
                        <label className="relay-rate-input">
                          <span className="sr-only">{t(field.label)}</span>
                          <span>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            inputMode="decimal"
                            value={price.rates[field.key]}
                            onChange={(event) =>
                              onChange?.(index, (item) => ({
                                ...item,
                                rates: { ...item.rates, [field.key]: event.target.value }
                              }))
                            }
                            disabled={disabled}
                          />
                          {actualPriceText && (
                            <small className="relay-rate-subtext">
                              <span className="relay-actual-price">
                                {t("relayPricingActualPrice", { price: actualPriceText })}
                              </span>
                            </small>
                          )}
                        </label>
                      )}
                    </td>
                  );
                })}
                {!readOnly && <td><button className="relay-icon-button" type="button" onClick={() => onRemove?.(index)} disabled={disabled} aria-label={t("relayPricingDeleteModel")} title={t("relayPricingDeleteModel")}><Trash2 size={16} /></button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
