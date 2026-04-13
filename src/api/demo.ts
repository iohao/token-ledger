import type {
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  MonthlyUsageSummaryDTO,
  SyncPreviewDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  UsageSummaryDTO
} from "../dto/dashboard";

function totals(input: number, cached: number, output: number, reasoning: number, costUSD: number) {
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    totalTokens: input + cached + output + reasoning,
    costUSD
  };
}

const DEMO_META: DashboardMetaDTO = {
  codexHomePath: "/Users/demo/.codex",
  databasePath: "/Users/demo/.codex/.codex-usage/usage.sqlite",
  databasePathSource: "default",
  databasePathEditable: true,
  timeZone: "Asia/Shanghai",
  parseVersion: 3,
  pricingNotes: [
    "GPT-5.4 / GPT-5.4-mini / GPT-5.3-Codex rates use OpenAI Codex Rate Card values, converted from credits with a 25 credits = 1 USD inference."
  ]
};

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
  dailyHistory: DEMO_DAILY_HISTORY,
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
  return structuredClone(demoPayload);
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

export function getDemoDailyUsage(): DailyUsageSummaryDTO[] {
  return structuredClone(DEMO_DAILY_HISTORY);
}
