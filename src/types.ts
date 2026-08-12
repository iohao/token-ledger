import type {
  DailyUsageSummaryDTO,
  DashboardPayloadDTO,
  ModelPricingRatesDTO,
  SyncProgressDTO,
  SyncPreviewDTO
} from "./dto/dashboard";
import type { PendingAppUpdate } from "./api/updater";
import type { Locale } from "./i18n";

export const AUTO_SYNC_OPTIONS = [
  { value: "manual", intervalMs: null },
  { value: "10s", intervalMs: 10_000 },
  { value: "30s", intervalMs: 30_000 },
  { value: "1m", intervalMs: 60_000 },
  { value: "5m", intervalMs: 5 * 60_000 },
  { value: "10m", intervalMs: 10 * 60_000 },
  { value: "15m", intervalMs: 15 * 60_000 },
  { value: "30m", intervalMs: 30 * 60_000 }
] as const;

export const SYNC_STATUS_POLL_INTERVAL_MS = 1_000;
export const SYNC_PROGRESS_EVENT_NAME = "sync-progress";
export const DAILY_DETAIL_PAGE_SIZE = 31;
export const MAX_DAILY_DETAIL_RANGE_DAYS = 93;
export const MONTH_BUTTON_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const ENGLISH_MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
] as const;
export const SOURCE_REPOSITORY_URL = "https://github.com/iohao/token-ledger";
export const PRICING_RATE_FIELDS = [
  "inputUsdPerMillion",
  "outputUsdPerMillion",
  "cacheReadUsdPerMillion",
  "cacheCreationUsdPerMillion"
] as const;

export function pricingRates(
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

export const RELAY_PRICING_PRESETS: Record<string, ModelPricingRatesDTO> = {
  "gpt-5.6-sol": pricingRates(9, 54, 0.9, 11.25),
  "gpt-5.6-terra": pricingRates(4.5, 27, 0.45, 5.4),
  "gpt-5.6-luna": pricingRates(1.8, 10.8, 0.18, 2.25)
};

export type AutoSyncModeValue = (typeof AUTO_SYNC_OPTIONS)[number]["value"];
export type AppTab = "overview" | "monthlyHistory" | "monthlyDetail" | "settings" | "dailyDetail";
export type InlineNoticeTone = "good" | "bad";
export type UpdateStatus = "idle" | "checking" | "available" | "upToDate" | "installing" | "error";
export type PricingRateField = (typeof PRICING_RATE_FIELDS)[number];
export type PageSourceId =
  | "src/views/overview.ts"
  | "src/views/monthly-history.ts"
  | "src/views/monthly-detail.ts"
  | "src/views/settings.ts"
  | "src/views/daily-detail.ts";

export type ModelPricingDraft = {
  model: string;
  enabled: boolean;
  rates: Record<PricingRateField, string>;
};

export type ActivityWallCell = {
  dateKey: string | null;
  totalTokens: number;
  level: 0 | 1 | 2 | 3 | 4;
  title: string;
};

export type ResolvedTheme = "dark" | "light";
export type ThemeMode = ResolvedTheme | "system";

export const THEME_STORAGE_KEY = "tokenledger.theme";
export const PAGE_SOURCE_VISIBILITY_STORAGE_KEY = "tokenledger.showPageSourceIds";

export interface AppState {
  dashboard: DashboardPayloadDTO | null;
  syncPreview: SyncPreviewDTO | null;
  syncProgress: SyncProgressDTO | null;
  isLoading: boolean;
  isSyncing: boolean;
  isUpdatingDatabasePath: boolean;
  isUpdatingModelPricing: boolean;
  errorMessage: string | null;
  locale: Locale;
  themeMode: ThemeMode;
  showPageSourceIds: boolean;
  autoSyncMode: AutoSyncModeValue;
  nextAutoSyncAt: number | null;
  activeTab: AppTab;
  databasePathDraft: string;
  databasePathDraftDirty: boolean;
  databasePathNotice: { tone: InlineNoticeTone; text: string } | null;
  modelPricingDraft: ModelPricingDraft[];
  modelPricingDraftDirty: boolean;
  modelPricingErrors: Record<string, string>;
  modelPricingNotice: { tone: InlineNoticeTone; text: string } | null;
  dailyDetailRows: DailyUsageSummaryDTO[];
  dailyDetailStartDate: string;
  dailyDetailEndDate: string;
  dailyDetailPage: number;
  isLoadingDailyDetails: boolean;
  dailyDetailsError: string | null;
  hasLoadedDailyDetails: boolean;
  monthlyDetailRows: DailyUsageSummaryDTO[];
  monthlyDetailYear: string;
  monthlyDetailMonth: number | null;
  isLoadingMonthlyDetails: boolean;
  monthlyDetailsError: string | null;
  hasLoadedMonthlyDetails: boolean;
  currentAppVersion: string | null;
  updateStatus: UpdateStatus;
  updateErrorMessage: string | null;
  availableUpdate: PendingAppUpdate | null;
  isInstallingUpdate: boolean;
  updateDownloadedBytes: number;
  updateContentLength: number | null;
  hasAttemptedInitialSync: boolean;
  copiedPageSourceId: PageSourceId | null;
}
