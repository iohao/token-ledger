import type {
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  ModelPricingRatesDTO,
  MonthlyUsageSummaryDTO,
  PricingComparisonDTO,
  PricingProviderDTO,
  RelayPricingProviderDTO,
  SyncPreviewDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  UsageSummaryDTO
} from "../dto/dashboard";

function totals(
  input: number,
  cached: number,
  output: number,
  reasoning: number,
  costUSD: number,
  requestCount = 12
) {
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheCreationInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    totalTokens: input + cached + output + reasoning,
    requestCount,
    costUSD
  };
}

const DEMO_META: DashboardMetaDTO = {
  codexHomePath: "/Users/demo/.codex",
  databasePath: "/Users/demo/.codex/.codex-usage/usage.sqlite",
  databasePathSource: "default",
  databasePathEditable: true,
  timeZone: "Asia/Shanghai",
  parseVersion: 8,
  locale: null,
  themeMode: null,
  showPageSourceIds: null,
  relayPricingShowOfficial: null,
  relayPricingVisibleModels: null,
  pricingProviders: [
    {
      id: "openai-official",
      kind: "official",
      name: "OpenAI 官方",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 1.0,
      modelPrices: [
        { model: "gpt-5.6-sol", rates: pricingRates([5, 30, 0.5, 6.25]) },
        { model: "gpt-5.6-terra", rates: pricingRates([2, 12, 0.2, 2.5]) },
        { model: "gpt-5.6-luna", rates: pricingRates([1, 6, 0.1, 1]) },
        { model: "gpt-5.5", rates: pricingRates([5, 30, 0.5, 5]) },
        { model: "gpt-5.4", rates: pricingRates([2.5, 15, 0.25, 2.5]) },
        { model: "gpt-5.4-mini", rates: pricingRates([0.75, 4.52, 0.075, 0.75]) },
        { model: "gpt-5.3-codex", rates: pricingRates([1.75, 14, 0.175, 1.75]) },
        { model: "gpt-5.3-codex-spark", rates: pricingRates([1.75, 14, 0.175, 1.75]) }
      ]
    },
    {
      id: "demo-relay",
      kind: "relay",
      name: "示例中转",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 0.8,
      modelPrices: []
    }
  ]
};

function pricingRates(values: [number, number, number, number]): ModelPricingRatesDTO {
  return {
    inputUsdPerMillion: values[0],
    outputUsdPerMillion: values[1],
    cacheReadUsdPerMillion: values[2],
    cacheCreationUsdPerMillion: values[3]
  };
}

const DEMO_STATUS: SyncStatusDTO = {
  state: "success",
  lastSyncedAt: "2026-04-12T15:21:00Z",
  errorMessage: null,
  coverageThrough: "2026-04-12T15:20:00Z",
  coverageGranularity: "minute",
  scannedFiles: 128,
  sessionCount: 42,
  dataSource: "jsonlDirect"
};

const DEMO_SYNC_PREVIEW: SyncPreviewDTO = {
  needsSync: true,
  newSessions: 2,
  changedSessions: 3,
  removedSessions: 0,
  totalTrackedSessions: 42,
  totalSessionFiles: 47
};

const DEMO_SUMMARIES: UsageSummaryDTO[] = [
  {
    period: "today",
    totals: totals(182_000, 96_000, 88_000, 33_000, 4.28),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(134_000, 72_000, 66_000, 22_000, 3.42) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(48_000, 24_000, 22_000, 11_000, 0.86) }
    ],
    lastUpdatedAt: "2026-04-12T15:20:00Z"
  },
  {
    period: "last7Days",
    totals: totals(1_020_000, 610_000, 544_000, 188_000, 22.61),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(760_000, 420_000, 404_000, 132_000, 17.94) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(260_000, 190_000, 140_000, 56_000, 4.67) }
    ],
    lastUpdatedAt: "2026-04-12T15:20:00Z"
  },
  {
    period: "monthToDate",
    totals: totals(3_480_000, 2_040_000, 1_860_000, 622_000, 79.34),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(2_640_000, 1_520_000, 1_428_000, 476_000, 64.28) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(840_000, 520_000, 432_000, 146_000, 15.06) }
    ],
    lastUpdatedAt: "2026-04-12T15:20:00Z"
  }
];

const DEMO_DAILY_HISTORY: DailyUsageSummaryDTO[] = [
  {
    dateKey: "2026-04-06",
    totals: totals(121_000, 64_000, 59_000, 21_000, 2.74),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(121_000, 64_000, 59_000, 21_000, 2.74) }],
    lastUpdatedAt: "2026-04-06T15:20:00Z"
  },
  {
    dateKey: "2026-04-07",
    totals: totals(142_000, 82_000, 74_000, 26_000, 3.35),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(142_000, 82_000, 74_000, 26_000, 3.35) }],
    lastUpdatedAt: "2026-04-07T15:20:00Z"
  },
  {
    dateKey: "2026-04-08",
    totals: totals(138_000, 80_000, 71_000, 24_000, 3.18),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(138_000, 80_000, 71_000, 24_000, 3.18) }],
    lastUpdatedAt: "2026-04-08T15:20:00Z"
  },
  {
    dateKey: "2026-04-09",
    totals: totals(167_000, 95_000, 86_000, 29_000, 3.92),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(167_000, 95_000, 86_000, 29_000, 3.92) }],
    lastUpdatedAt: "2026-04-09T15:20:00Z"
  },
  {
    dateKey: "2026-04-10",
    totals: totals(176_000, 100_000, 90_000, 30_000, 4.12),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(176_000, 100_000, 90_000, 30_000, 4.12) }],
    lastUpdatedAt: "2026-04-10T15:20:00Z"
  },
  {
    dateKey: "2026-04-11",
    totals: totals(194_000, 112_000, 97_000, 33_000, 4.56),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(194_000, 112_000, 97_000, 33_000, 4.56) }],
    lastUpdatedAt: "2026-04-11T15:20:00Z"
  },
  {
    dateKey: "2026-04-12",
    totals: totals(182_000, 96_000, 88_000, 33_000, 4.28),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(134_000, 72_000, 66_000, 22_000, 3.42) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(48_000, 24_000, 22_000, 11_000, 0.86) }
    ],
    lastUpdatedAt: "2026-04-12T15:20:00Z"
  }
];

function buildDemoActivityHistory(): DailyUsageSummaryDTO[] {
  const endDate = new Date(Date.UTC(2026, 3, 12));
  const totalDays = 365 + endDate.getUTCDay();

  return Array.from({ length: totalDays }, (_, index) => {
    const offset = totalDays - index - 1;
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - offset);

    const weekdayBoost = [0.12, 0.92, 1.06, 0.88, 0.98, 0.54, 0.18][date.getUTCDay()];
    const seasonalWave = Math.max(Math.sin(index / 17) + Math.cos(index / 39) * 0.45, -0.8);
    const burst = (index % 31 === 0 ? 1.15 : 0) + (index % 67 === 0 ? 0.75 : 0);
    const intensity = Math.max(weekdayBoost + seasonalWave + burst - 0.58, 0);
    const totalTokens = Math.round(intensity * 72_000);
    const inputTokens = Math.round(totalTokens * 0.48);
    const cachedInputTokens = Math.round(totalTokens * 0.19);
    const outputTokens = Math.round(totalTokens * 0.24);
    const reasoningOutputTokens = Math.max(totalTokens - inputTokens - cachedInputTokens - outputTokens, 0);

    return {
      dateKey: date.toISOString().slice(0, 10),
      totals: totals(inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens / 42_000),
      models:
        totalTokens > 0
          ? [
              {
                model: totalTokens > 96_000 ? "gpt-5.4" : "gpt-5.4-mini",
                isFallback: false,
                totals: totals(inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens / 42_000)
              }
            ]
          : [],
      lastUpdatedAt: `${date.toISOString().slice(0, 10)}T15:20:00Z`
    };
  }).reverse();
}

const DEMO_ACTIVITY_HISTORY: DailyUsageSummaryDTO[] = buildDemoActivityHistory();

const DEMO_MONTHLY_HISTORY: MonthlyUsageSummaryDTO[] = [
  {
    monthKey: "2026-02",
    totals: totals(2_040_000, 1_180_000, 1_050_000, 354_000, 46.73),
    models: [{ model: "gpt-5.4", isFallback: false, totals: totals(2_040_000, 1_180_000, 1_050_000, 354_000, 46.73) }],
    lastUpdatedAt: "2026-02-29T15:20:00Z"
  },
  {
    monthKey: "2026-03",
    totals: totals(3_860_000, 2_320_000, 2_044_000, 688_000, 88.41),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(3_220_000, 1_920_000, 1_720_000, 578_000, 75.12) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(640_000, 400_000, 324_000, 110_000, 13.29) }
    ],
    lastUpdatedAt: "2026-03-31T15:20:00Z"
  },
  {
    monthKey: "2026-04",
    totals: totals(3_480_000, 2_040_000, 1_860_000, 622_000, 79.34),
    models: [
      { model: "gpt-5.4", isFallback: false, totals: totals(2_640_000, 1_520_000, 1_428_000, 476_000, 64.28) },
      { model: "gpt-5.4-mini", isFallback: false, totals: totals(840_000, 520_000, 432_000, 146_000, 15.06) }
    ],
    lastUpdatedAt: "2026-04-12T15:20:00Z"
  }
];

let demoPayload: DashboardPayloadDTO = {
  meta: DEMO_META,
  status: DEMO_STATUS,
  syncPreview: DEMO_SYNC_PREVIEW,
  summaries: DEMO_SUMMARIES,
  providerCostComparisons: [],
  dailyHistory: DEMO_DAILY_HISTORY,
  activityHistory: DEMO_ACTIVITY_HISTORY,
  monthlyHistory: DEMO_MONTHLY_HISTORY,
  now: "2026-04-12T15:21:00Z"
};

export function isDemoMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("demo") === "1";
}

export function getDemoDashboard(): DashboardPayloadDTO {
  return structuredClone({
    ...demoPayload,
    providerCostComparisons: buildDemoPricingComparisons(
      demoPayload.summaries,
      demoPayload.meta.pricingProviders
    )
  });
}

export function getDemoSyncPreview(): SyncPreviewDTO {
  return structuredClone(demoPayload.syncPreview ?? DEMO_SYNC_PREVIEW);
}

export function getDemoSyncProgress(): SyncProgressDTO | null {
  return null;
}

export function getDemoSyncRunning(): boolean {
  return false;
}

export function updateDemoDatabasePath(databasePath: string): DashboardPayloadDTO {
  demoPayload = {
    ...demoPayload,
    meta: {
      ...demoPayload.meta,
      databasePath,
      databasePathSource: "config"
    }
  };

  return getDemoDashboard();
}

export function resetDemoDatabasePath(): DashboardPayloadDTO {
  demoPayload = {
    ...demoPayload,
    meta: {
      ...demoPayload.meta,
      databasePath: DEMO_META.databasePath,
      databasePathSource: DEMO_META.databasePathSource
    }
  };

  return getDemoDashboard();
}

export function updateDemoPricingProviders(
  relayPricingProviders: RelayPricingProviderDTO[],
  openaiUsdPerRmb: number
): DashboardPayloadDTO {
  demoPayload = {
    ...demoPayload,
    meta: {
      ...demoPayload.meta,
      pricingProviders: demoPayload.meta.pricingProviders.map((provider) =>
        provider.kind === "official"
          ? { ...provider, rechargeRatioUsdPerRmb: openaiUsdPerRmb }
          : provider
      ).filter((provider) => provider.kind === "official").concat(
        relayPricingProviders.map((provider) => ({ ...provider, kind: "relay" as const }))
      )
    }
  };

  return getDemoDashboard();
}

function buildDemoPricingComparisons(
  summaries: UsageSummaryDTO[],
  providers: PricingProviderDTO[]
): PricingComparisonDTO[] {
  return summaries.map((summary) => ({
    period: summary.period,
    providers: providers.filter((provider) => provider.enabled).map((provider) => {
      const fallbackModels: string[] = [];
      const unpricedModels: string[] = [];
      let costUsd = 0;

      const multiplier = provider.multiplier ?? 1.0;
      for (const modelUsage of summary.models) {
        const supplied = provider.modelPrices?.find((price) => price.model === modelUsage.model);
        const official = DEMO_META.pricingProviders[0]?.modelPrices?.find(
          (price) => price.model === modelUsage.model
        );
        const rates = supplied?.rates ?? official?.rates;
        if (!rates) {
          unpricedModels.push(modelUsage.model);
          continue;
        }
        if (!supplied && provider.kind === "relay") {
          fallbackModels.push(modelUsage.model);
        }
        costUsd += costForRates(modelUsage.totals, rates) * multiplier;
      }

      const isComplete = unpricedModels.length === 0 && provider.rechargeRatioUsdPerRmb !== null;
      return {
        providerId: provider.id,
        isComplete,
        costUsd: isComplete ? costUsd : null,
        costCny: isComplete ? costUsd / provider.rechargeRatioUsdPerRmb! : null,
        fallbackModels,
        unpricedModels
      };
    })
  }));
}

function costForRates(
  usage: UsageSummaryDTO["totals"],
  rates: ModelPricingRatesDTO
): number {
  const input = Math.max(0, usage.inputTokens);
  const cached = Math.min(Math.max(0, usage.cachedInputTokens), input);
  const remaining = input - cached;
  const cacheCreation = Math.min(Math.max(0, usage.cacheCreationInputTokens), remaining);
  const regular = remaining - cacheCreation;

  return (
    (regular / 1_000_000) * rates.inputUsdPerMillion
    + (cached / 1_000_000) * rates.cacheReadUsdPerMillion
    + (cacheCreation / 1_000_000) * rates.cacheCreationUsdPerMillion
    + (Math.max(0, usage.outputTokens) / 1_000_000) * rates.outputUsdPerMillion
  );
}

export function getDemoDailyUsage(): DailyUsageSummaryDTO[] {
  return structuredClone(DEMO_DAILY_HISTORY);
}

let demoPluginConfig = {
  enabled: true,
  selectedProviderId: "openai-official",
  hookInstalled: true,
  pluginPath: "/Users/demo/.codex/.tokenledger/plugins/codex-token-cost/scripts/token_cost.py",
  pricingPath: "/Users/demo/.codex/.tokenledger/plugins/codex-token-cost/pricing.toml"
};

export function getDemoCodexPluginConfig() {
  return structuredClone(demoPluginConfig);
}

export function updateDemoCodexPluginConfig(enabled: boolean, selectedProviderId: string) {
  demoPluginConfig = {
    ...demoPluginConfig,
    enabled,
    selectedProviderId,
    hookInstalled: enabled
  };
  return structuredClone(demoPluginConfig);
}
