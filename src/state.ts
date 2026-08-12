import { detectInitialLocale } from "./i18n";
import {
  PAGE_SOURCE_VISIBILITY_STORAGE_KEY,
  type AppState,
  type AppTab,
  type AutoSyncModeValue,
  type PageSourceId,
  type UpdateStatus
} from "./types";
import { detectInitialThemeMode } from "./utils/theme";

export function detectInitialPageSourceVisibility(): boolean {
  try {
    return window.localStorage.getItem(PAGE_SOURCE_VISIBILITY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function detectInitialTab(): AppTab {
  if (typeof window === "undefined") {
    return "overview";
  }

  const tab = new URLSearchParams(window.location.search).get("tab");
  if (tab === "syncInfo") {
    return "settings";
  }

  return tab === "overview" || tab === "monthlyHistory" || tab === "monthlyDetail" || tab === "settings" || tab === "dailyDetail"
    ? tab
    : "overview";
}

export const state: AppState = {
  dashboard: null,
  syncPreview: null,
  syncProgress: null,
  isLoading: true,
  isSyncing: false,
  isUpdatingDatabasePath: false,
  isUpdatingModelPricing: false,
  errorMessage: null,
  locale: detectInitialLocale(),
  themeMode: detectInitialThemeMode(),
  showPageSourceIds: detectInitialPageSourceVisibility(),
  autoSyncMode: "manual" as AutoSyncModeValue,
  nextAutoSyncAt: null,
  activeTab: detectInitialTab(),
  databasePathDraft: "",
  databasePathDraftDirty: false,
  databasePathNotice: null,
  modelPricingDraft: [],
  modelPricingDraftDirty: false,
  modelPricingErrors: {},
  modelPricingNotice: null,
  dailyDetailRows: [],
  dailyDetailStartDate: "",
  dailyDetailEndDate: "",
  dailyDetailPage: 1,
  isLoadingDailyDetails: false,
  dailyDetailsError: null,
  hasLoadedDailyDetails: false,
  monthlyDetailRows: [],
  monthlyDetailYear: "",
  monthlyDetailMonth: null,
  isLoadingMonthlyDetails: false,
  monthlyDetailsError: null,
  hasLoadedMonthlyDetails: false,
  currentAppVersion: null,
  updateStatus: "idle" as UpdateStatus,
  updateErrorMessage: null,
  availableUpdate: null,
  isInstallingUpdate: false,
  updateDownloadedBytes: 0,
  updateContentLength: null,
  hasAttemptedInitialSync: false,
  copiedPageSourceId: null as PageSourceId | null
};
