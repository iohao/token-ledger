import type {
  ModelPricingRatesDTO,
  ModelUsageBreakdownDTO,
  PricingProviderDTO,
  ProviderModelPricingDTO,
  RelayPricingProviderDTO,
  UsageTotalsDTO
} from "../../src/dto/dashboard";

export const OPENAI_OFFICIAL_PROVIDER_ID = "openai-official";
export const MIGRATED_RELAY_PROVIDER_ID = "migrated-relay";
export const DEFAULT_OPENAI_USD_PER_RMB = 0.14;

export const OFFICIAL_MODELS: readonly string[] = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark"
];

function rates(
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion: number,
  cacheCreationUsdPerMillion: number
): ModelPricingRatesDTO {
  return {
    inputUsdPerMillion,
    outputUsdPerMillion,
    cacheReadUsdPerMillion,
    cacheCreationUsdPerMillion
  };
}

export function normalizeModel(rawValue: string): string {
  let normalized = rawValue.trim().toLowerCase();

  for (const prefix of ["openrouter/openai/", "openai/", "azure/"]) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }

  const stripped = (() => {
    if (normalized.length > 11) {
      const suffix = normalized.slice(normalized.length - 11);
      if (
        suffix.startsWith("-") &&
        /^\-\d{4}\-\d{2}\-\d{2}$/.test(suffix)
      ) {
        return normalized.slice(0, normalized.length - 11);
      }
    }
    return normalized;
  })();

  switch (stripped) {
    case "gpt-5-codex":
    case "gpt-5.2-codex":
      return "gpt-5.3-codex";
    case "gpt-5.3-codex-spark":
      return "gpt-5.3-codex-spark";
    default:
      return stripped;
  }
}

export function pricingIdentity(model: string): string {
  const normalized = normalizeModel(model);
  if (normalized === "gpt-5.6") {
    return "gpt-5.6-sol";
  }
  return normalized;
}

export function officialPricingFor(model: string): ModelPricingRatesDTO | null {
  switch (pricingIdentity(model)) {
    case "gpt-5.6-sol":
      return rates(5.0, 30.0, 0.5, 6.25);
    case "gpt-5.6-terra":
      return rates(2.0, 12.0, 0.2, 2.5);
    case "gpt-5.6-luna":
      return rates(1.0, 6.0, 0.1, 1.0);
    case "gpt-5.5":
      return rates(5.0, 30.0, 0.5, 5.0);
    case "gpt-5.4":
      return rates(2.5, 15.0, 0.25, 2.5);
    case "gpt-5.4-mini":
      return rates(0.75, 4.52, 0.075, 0.75);
    case "gpt-5.3-codex":
    case "gpt-5.3-codex-spark":
      return rates(1.75, 14.0, 0.175, 1.75);
    default:
      return null;
  }
}

export function pricingProviders(
  relays: RelayPricingProviderDTO[],
  openaiUsdPerRmb: number
): PricingProviderDTO[] {
  const official: PricingProviderDTO = {
    id: OPENAI_OFFICIAL_PROVIDER_ID,
    kind: "official",
    name: "OpenAI 官方",
    enabled: true,
    rechargeRatioUsdPerRmb: openaiUsdPerRmb,
    multiplier: 1.0,
    modelPrices: OFFICIAL_MODELS.map((model) => {
      const modelRates = officialPricingFor(model);
      return modelRates ? { model, rates: modelRates } : null;
    }).filter((item): item is ProviderModelPricingDTO => item !== null)
  };

  const relayProviders: PricingProviderDTO[] = relays.map((relay) => ({
    id: relay.id,
    kind: "relay",
    name: relay.name,
    enabled: relay.enabled,
    rechargeRatioUsdPerRmb: relay.rechargeRatioUsdPerRmb ?? null,
    multiplier: relay.multiplier ?? 1.0,
    modelPrices: relay.modelPrices ?? []
  }));

  return [official, ...relayProviders];
}

function validateRates(modelRates: ModelPricingRatesDTO, model: string): void {
  const fields: [string, number][] = [
    ["input", modelRates.inputUsdPerMillion],
    ["output", modelRates.outputUsdPerMillion],
    ["cache read", modelRates.cacheReadUsdPerMillion],
    ["cache creation", modelRates.cacheCreationUsdPerMillion]
  ];
  for (const [name, value] of fields) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${model} ${name} price must be a non-negative finite number`);
    }
  }
}

export function validateRelayPricingProviders(
  providers: RelayPricingProviderDTO[]
): RelayPricingProviderDTO[] {
  const ids = new Set<string>();
  const normalized: RelayPricingProviderDTO[] = [];

  for (const provider of providers) {
    const id = provider.id.trim();
    const name = provider.name.trim();
    if (!id) {
      throw new Error("relay provider id is required");
    }
    if (id === OPENAI_OFFICIAL_PROVIDER_ID) {
      throw new Error("OpenAI official provider id is reserved");
    }
    if (ids.has(id)) {
      throw new Error("relay provider id must be unique");
    }
    ids.add(id);

    if (!name) {
      throw new Error("relay provider name is required");
    }

    const ratio = provider.rechargeRatioUsdPerRmb;
    if (ratio !== null && ratio !== undefined) {
      if (!Number.isFinite(ratio) || ratio <= 0) {
        throw new Error(`${name} recharge ratio must be a positive finite number`);
      }
    } else if (provider.enabled || id !== MIGRATED_RELAY_PROVIDER_ID) {
      throw new Error(`${name} needs a recharge ratio before it can be saved`);
    }

    const multiplier =
      provider.multiplier !== null && provider.multiplier !== undefined
        ? provider.multiplier
        : 1.0;
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`${name} multiplier must be a positive finite number`);
    }

    const models = new Set<string>();
    const modelPrices: ProviderModelPricingDTO[] = [];
    for (const price of provider.modelPrices ?? []) {
      const model = price.model.trim();
      if (!model) {
        throw new Error(`${name} model name is required`);
      }
      const identity = pricingIdentity(model);
      if (models.has(identity)) {
        throw new Error(`${name} has duplicate model pricing for ${model}`);
      }
      models.add(identity);
      validateRates(price.rates, model);
      modelPrices.push({
        model,
        rates: { ...price.rates }
      });
    }

    normalized.push({
      id,
      name,
      enabled: provider.enabled,
      rechargeRatioUsdPerRmb: ratio ?? null,
      multiplier,
      modelPrices
    });
  }

  return normalized;
}

export function validateOpenaiUsdPerRmb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("OpenAI recharge ratio must be a positive finite number");
  }
  return value;
}

export function generatePluginPricingTomlForProvider(
  relays: RelayPricingProviderDTO[],
  selectedProviderId?: string | null
): string {
  let buffer = "# Prices are USD per one million tokens. Keep amounts quoted for Decimal parsing.\n";
  buffer += "# Managed by TokenLedger - Relay Pricing Configuration\n\n";

  const activeRelay =
    selectedProviderId && selectedProviderId !== OPENAI_OFFICIAL_PROVIDER_ID
      ? relays.find((p) => p.id === selectedProviderId)
      : undefined;

  const providerName = activeRelay ? activeRelay.name : "OpenAI 官方";
  const multiplier = activeRelay?.multiplier ?? 1.0;

  buffer += "[provider]\n";
  buffer += `name = "${providerName}"\n`;
  buffer += `multiplier = "${multiplier.toFixed(4)}"\n\n`;

  for (const model of OFFICIAL_MODELS) {
    const base = officialPricingFor(model);
    if (!base) continue;

    let ratesForModel: ModelPricingRatesDTO;
    if (activeRelay) {
      const custom = activeRelay.modelPrices?.find(
        (p) => pricingIdentity(p.model) === pricingIdentity(model)
      );
      const baseRate = custom ? custom.rates : base;
      ratesForModel = {
        inputUsdPerMillion: baseRate.inputUsdPerMillion * multiplier,
        outputUsdPerMillion: baseRate.outputUsdPerMillion * multiplier,
        cacheReadUsdPerMillion: baseRate.cacheReadUsdPerMillion * multiplier,
        cacheCreationUsdPerMillion: baseRate.cacheCreationUsdPerMillion * multiplier
      };
    } else {
      ratesForModel = base;
    }

    buffer += `[models."${model}"]\n`;
    buffer += `input_per_million = "${ratesForModel.inputUsdPerMillion.toFixed(4)}"\n`;
    buffer += `output_per_million = "${ratesForModel.outputUsdPerMillion.toFixed(4)}"\n`;
    buffer += `cached_input_per_million = "${ratesForModel.cacheReadUsdPerMillion.toFixed(4)}"\n`;
    buffer += `cache_creation_per_million = "${ratesForModel.cacheCreationUsdPerMillion.toFixed(4)}"\n\n`;
  }

  return buffer;
}

export function generatePluginPricingToml(relays: RelayPricingProviderDTO[]): string {
  const firstEnabled = relays.find((p) => p.enabled)?.id ?? null;
  return generatePluginPricingTomlForProvider(relays, firstEnabled);
}

export function costForRates(totals: UsageTotalsDTO, pricing: ModelPricingRatesDTO): number {
  const inputTokens = Math.max(0, totals.inputTokens);
  const cacheReadTokens = Math.min(Math.max(0, totals.cachedInputTokens), inputTokens);
  const remainingInputTokens = inputTokens - cacheReadTokens;
  const cacheCreationTokens = Math.min(
    Math.max(0, totals.cacheCreationInputTokens),
    remainingInputTokens
  );
  const regularInputTokens = remainingInputTokens - cacheCreationTokens;

  return (
    (regularInputTokens / 1_000_000.0) * pricing.inputUsdPerMillion +
    (cacheReadTokens / 1_000_000.0) * pricing.cacheReadUsdPerMillion +
    (cacheCreationTokens / 1_000_000.0) * pricing.cacheCreationUsdPerMillion +
    (Math.max(0, totals.outputTokens) / 1_000_000.0) * pricing.outputUsdPerMillion
  );
}

export function costFor(totals: UsageTotalsDTO, model: string): number {
  const pricing = officialPricingFor(model);
  return pricing ? costForRates(totals, pricing) : 0.0;
}

export interface ProviderCostResult {
  costUsd: number | null;
  fallbackModels: string[];
  unpricedModels: string[];
}

export function costForProvider(
  models: ModelUsageBreakdownDTO[],
  provider: PricingProviderDTO
): ProviderCostResult {
  let total = 0.0;
  const fallbackModels: string[] = [];
  const unpricedModels: string[] = [];
  const multiplier = provider.multiplier ?? 1.0;

  for (const usage of models) {
    const identity = pricingIdentity(usage.model);
    const suppliedRates = provider.modelPrices?.find(
      (price) => pricingIdentity(price.model) === identity
    )?.rates;
    const officialRates = officialPricingFor(identity);

    let ratesToUse: ModelPricingRatesDTO | null = null;
    let isFallback = false;

    if (suppliedRates) {
      ratesToUse = suppliedRates;
      isFallback = false;
    } else if (officialRates) {
      ratesToUse = officialRates;
      isFallback = true;
    } else {
      unpricedModels.push(usage.model);
      continue;
    }

    if (isFallback && provider.kind !== "official") {
      fallbackModels.push(usage.model);
    }

    total += costForRates(usage.totals, ratesToUse) * multiplier;
  }

  return {
    costUsd: unpricedModels.length === 0 ? total : null,
    fallbackModels,
    unpricedModels
  };
}
