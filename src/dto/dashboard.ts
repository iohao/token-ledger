export type UsagePeriod = "today" | "last7Days" | "monthToDate";

export interface UsageTotalsDTO {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  costUSD: number;
}

export interface ModelPricingRatesDTO {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheCreationUsdPerMillion: number;
}

export interface ModelPricingOverrideDTO {
  model: string;
  enabled: boolean;
  rates: ModelPricingRatesDTO;
}

export interface ModelPricingSettingDTO {
  model: string;
  relayEnabled: boolean;
  officialRates: ModelPricingRatesDTO;
  relayRates: ModelPricingRatesDTO;
}

export interface ProviderModelPricingDTO {
  model: string;
  rates: ModelPricingRatesDTO;
}

export interface RelayPricingProviderDTO {
  id: string;
  name: string;
  enabled: boolean;
  rechargeRatioUsdPerRmb: number | null;
  multiplier?: number | null;
  modelPrices?: ProviderModelPricingDTO[];
}

export interface PricingProviderDTO extends RelayPricingProviderDTO {
  kind: "official" | "relay";
}

export interface ProviderCostComparisonDTO {
  providerId: string;
  isComplete: boolean;
  costUsd: number | null;
  costCny: number | null;
  fallbackModels: string[];
  unpricedModels: string[];
}

export interface PricingComparisonDTO {
  period: UsagePeriod;
  providers: ProviderCostComparisonDTO[];
}

export interface ModelUsageBreakdownDTO {
  model: string;
  isFallback: boolean;
  totals: UsageTotalsDTO;
}

export interface UsageSummaryDTO {
  period: UsagePeriod;
  totals: UsageTotalsDTO;
  models: ModelUsageBreakdownDTO[];
  lastUpdatedAt: string | null;
}

export interface DailyUsageSummaryDTO {
  dateKey: string;
  totals: UsageTotalsDTO;
  models: ModelUsageBreakdownDTO[];
  lastUpdatedAt: string | null;
}

export interface MonthlyUsageSummaryDTO {
  monthKey: string;
  totals: UsageTotalsDTO;
  models: ModelUsageBreakdownDTO[];
  lastUpdatedAt: string | null;
}

export interface SyncStatusDTO {
  state: "idle" | "syncing" | "success" | "failed";
  lastSyncedAt: string | null;
  errorMessage: string | null;
  coverageThrough: string | null;
  coverageGranularity: "minute" | "day" | null;
  scannedFiles: number;
  sessionCount: number;
  dataSource: "jsonlDirect" | null;
}

export interface SyncPreviewDTO {
  needsSync: boolean;
  newSessions: number;
  changedSessions: number;
  removedSessions: number;
  totalTrackedSessions: number;
  totalSessionFiles: number;
}

export interface SyncProgressDTO {
  phase: "preparing" | "scanningFiles" | "processingFiles" | "finalizing" | "complete" | "failed";
  totalSessionFiles: number;
  filesToProcess: number;
  processedFiles: number;
  removedSessions: number;
  newSessions: number;
  changedSessions: number;
  errorMessage: string | null;
}

export interface DashboardMetaDTO {
  codexHomePath: string;
  databasePath: string;
  databasePathSource: "env" | "config" | "default";
  databasePathEditable: boolean;
  timeZone: string;
  parseVersion: number;
  pricingProviders: PricingProviderDTO[];
}

export interface DashboardPayloadDTO {
  meta: DashboardMetaDTO;
  status: SyncStatusDTO;
  syncPreview: SyncPreviewDTO | null;
  summaries: UsageSummaryDTO[];
  providerCostComparisons: PricingComparisonDTO[];
  dailyHistory: DailyUsageSummaryDTO[];
  activityHistory: DailyUsageSummaryDTO[];
  monthlyHistory: MonthlyUsageSummaryDTO[];
  now: string;
}
