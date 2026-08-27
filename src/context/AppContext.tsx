import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  fetchCurrentSyncProgress,
  fetchDashboard,
  fetchSyncPreview,
  isSyncRunning,
  openSourceRepository,
  queryDailyUsage,
  resetDatabasePath,
  startSync,
  updateDatabasePath
} from "../api/tauri";
import {
  checkForPendingAppUpdate,
  fetchCurrentAppVersion,
  installPendingAppUpdate,
  type PendingAppUpdate
} from "../api/updater";
import { useDeferredTasks } from "../hooks/useDeferredTasks";
import type {
  DailyUsageSummaryDTO,
  DashboardPayloadDTO,
  SyncProgressDTO,
  SyncPreviewDTO,
  SyncStatusDTO
} from "../dto/dashboard";
import i18n, {
  detectInitialLocale,
  isLocale,
  persistLocale,
  t,
  translateErrorMessage,
  type Locale
} from "../i18n";
import {
  AUTO_SYNC_OPTIONS,
  DAILY_DETAIL_PAGE_SIZE,
  MAX_DAILY_DETAIL_RANGE_DAYS,
  PAGE_SOURCE_VISIBILITY_STORAGE_KEY,
  SYNC_PROGRESS_EVENT_NAME,
  SYNC_STATUS_POLL_INTERVAL_MS,
  type AppTab,
  type AutoSyncModeValue,
  type InlineNoticeTone,
  type PageSourceId,
  type ThemeMode,
  type UpdateStatus
} from "../types";
import {
  dateRangeDayCount,
  formatCountdown,
  formatDateInputValue,
  formatInteger
} from "../utils/format";
import { applyTheme, detectInitialThemeMode, systemThemeQuery } from "../utils/theme";
import { dateRangeForMonth } from "../views/MonthlyDetailView";

export interface AppContextType {
  dashboard: DashboardPayloadDTO | null;
  syncPreview: SyncPreviewDTO | null;
  syncProgress: SyncProgressDTO | null;
  isLoading: boolean;
  isSyncing: boolean;
  isUpdatingDatabasePath: boolean;
  errorMessage: string | null;
  locale: Locale;
  themeMode: ThemeMode;
  showPageSourceIds: boolean;
  autoSyncMode: AutoSyncModeValue;
  nextAutoSyncAt: number | null;
  autoSyncRemaining: number | null;
  activeTab: AppTab;
  databasePathDraft: string;
  databasePathDraftDirty: boolean;
  databasePathNotice: { tone: InlineNoticeTone; text: string } | null;
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
  copiedPageSourceId: PageSourceId | null;

  // Actions
  setThemeMode: (mode: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  setShowPageSourceIds: (show: boolean) => void;
  setActiveTab: (tab: AppTab) => void;
  setAutoSyncMode: (mode: AutoSyncModeValue) => void;
  setDatabasePathDraft: (val: string) => void;
  setDailyDetailStartDate: (val: string) => void;
  setDailyDetailEndDate: (val: string) => void;
  setDailyDetailPage: (page: number) => void;
  setMonthlyDetailYear: (year: string) => void;
  copyPageSourceId: (id: PageSourceId) => Promise<void>;
  syncDashboard: () => Promise<void>;
  loadDashboard: () => Promise<void>;
  loadDailyDetails: () => Promise<void>;
  loadMonthlyDetails: (month?: number | null) => Promise<void>;
  saveDatabasePathOverride: () => Promise<void>;
  resetDatabasePathOverride: () => Promise<void>;
  checkForAppUpdates: (manual?: boolean) => Promise<void>;
  installAppUpdate: () => Promise<void>;
  openSourceRepositoryInBrowser: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

function detectInitialPageSourceVisibility(): boolean {
  try {
    return window.localStorage.getItem(PAGE_SOURCE_VISIBILITY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function detectInitialTab(): AppTab {
  if (typeof window === "undefined") {
    return "overview";
  }
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (tab === "syncInfo") {
    return "settings";
  }
  return tab === "overview" ||
    tab === "monthlyHistory" ||
    tab === "monthlyDetail" ||
    tab === "settings" ||
    tab === "dailyDetail" ||
    tab === "relayPricing" ||
    tab === "codexPlugin"
    ? tab
    : "overview";
}

export function syncingStatusSnapshot(dashboard: DashboardPayloadDTO | null): SyncStatusDTO {
  const currentStatus = dashboard?.status;
  return {
    state: "syncing",
    lastSyncedAt: currentStatus?.lastSyncedAt ?? null,
    errorMessage: null,
    coverageThrough: currentStatus?.coverageThrough ?? null,
    coverageGranularity: currentStatus?.coverageGranularity ?? null,
    scannedFiles: currentStatus?.scannedFiles ?? 0,
    sessionCount: currentStatus?.sessionCount ?? 0,
    dataSource: currentStatus?.dataSource ?? null
  };
}

export function syncProgressSnapshot(
  syncPreview: SyncPreviewDTO | null,
  phase: SyncProgressDTO["phase"] = "preparing"
): SyncProgressDTO {
  return {
    phase,
    totalSessionFiles: syncPreview?.totalSessionFiles ?? 0,
    filesToProcess: (syncPreview?.newSessions ?? 0) + (syncPreview?.changedSessions ?? 0),
    processedFiles: 0,
    removedSessions: syncPreview?.removedSessions ?? 0,
    newSessions: syncPreview?.newSessions ?? 0,
    changedSessions: syncPreview?.changedSessions ?? 0,
    errorMessage: null
  };
}

const isMacLikePlatform =
  typeof navigator !== "undefined" &&
  (/Mac|iPod|iPhone|iPad/.test(navigator.userAgent) || /Mac/i.test(navigator.platform || ""));

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dashboard, setDashboard] = useState<DashboardPayloadDTO | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewDTO | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgressDTO | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isUpdatingDatabasePath, setIsUpdatingDatabasePath] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(detectInitialThemeMode);
  const [showPageSourceIds, setShowPageSourceIdsState] = useState<boolean>(detectInitialPageSourceVisibility);
  const [autoSyncMode, setAutoSyncModeState] = useState<AutoSyncModeValue>("manual");
  const [nextAutoSyncAt, setNextAutoSyncAt] = useState<number | null>(null);
  const [autoSyncRemaining, setAutoSyncRemaining] = useState<number | null>(null);
  const [activeTab, setActiveTabState] = useState<AppTab>(detectInitialTab);

  // Settings drafts
  const [databasePathDraft, setDatabasePathDraftState] = useState<string>("");
  const [databasePathDraftDirty, setDatabasePathDraftDirty] = useState<boolean>(false);
  const [databasePathNotice, setDatabasePathNotice] = useState<{ tone: InlineNoticeTone; text: string } | null>(null);

  // Daily Detail state
  const [dailyDetailRows, setDailyDetailRows] = useState<DailyUsageSummaryDTO[]>([]);
  const [dailyDetailStartDate, setDailyDetailStartDate] = useState<string>("");
  const [dailyDetailEndDate, setDailyDetailEndDate] = useState<string>("");
  const [dailyDetailPage, setDailyDetailPage] = useState<number>(1);
  const [isLoadingDailyDetails, setIsLoadingDailyDetails] = useState<boolean>(false);
  const [dailyDetailsError, setDailyDetailsError] = useState<string | null>(null);
  const [hasLoadedDailyDetails, setHasLoadedDailyDetails] = useState<boolean>(false);

  // Monthly Detail state
  const [monthlyDetailRows, setMonthlyDetailRows] = useState<DailyUsageSummaryDTO[]>([]);
  const [monthlyDetailYear, setMonthlyDetailYear] = useState<string>("");
  const [monthlyDetailMonth, setMonthlyDetailMonth] = useState<number | null>(null);
  const [isLoadingMonthlyDetails, setIsLoadingMonthlyDetails] = useState<boolean>(false);
  const [monthlyDetailsError, setMonthlyDetailsError] = useState<string | null>(null);
  const [hasLoadedMonthlyDetails, setHasLoadedMonthlyDetails] = useState<boolean>(false);

  // Update state
  const [currentAppVersion, setCurrentAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateErrorMessage, setUpdateErrorMessage] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<PendingAppUpdate | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [updateDownloadedBytes, setUpdateDownloadedBytes] = useState<number>(0);
  const [updateContentLength, setUpdateContentLength] = useState<number | null>(null);

  const [copiedPageSourceId, setCopiedPageSourceId] = useState<PageSourceId | null>(null);
  const hasAttemptedInitialSyncRef = useRef<boolean>(false);

  // Sync generations & Request IDs
  const syncGenerationRef = useRef<number>(0);
  const latestDashboardRequestIdRef = useRef<number>(0);
  const latestSyncPreviewRequestIdRef = useRef<number>(0);
  const autoSyncTimeoutIdRef = useRef<number | null>(null);
  const syncStatusPollTimeoutIdRef = useRef<number | null>(null);
  const pageSourceCopyTimeoutIdRef = useRef<number | null>(null);

  // State refs for access in callbacks
  const stateRef = useRef({
    locale,
    themeMode,
    autoSyncMode,
    nextAutoSyncAt,
    activeTab,
    isSyncing,
    isLoading,
    isUpdatingDatabasePath,
    dashboard,
    syncPreview,
    syncProgress,
    databasePathDraft,
    databasePathDraftDirty,
    dailyDetailStartDate,
    dailyDetailEndDate,
    dailyDetailRows,
    dailyDetailPage,
    hasLoadedDailyDetails,
    isLoadingDailyDetails,
    monthlyDetailYear,
    monthlyDetailMonth,
    hasLoadedMonthlyDetails,
    isLoadingMonthlyDetails,
    updateStatus,
    isInstallingUpdate,
    availableUpdate,
    currentAppVersion
  });

  useEffect(() => {
    stateRef.current = {
      locale,
      themeMode,
      autoSyncMode,
      nextAutoSyncAt,
      activeTab,
      isSyncing,
      isLoading,
      isUpdatingDatabasePath,
      dashboard,
      syncPreview,
      syncProgress,
      databasePathDraft,
      databasePathDraftDirty,
      dailyDetailStartDate,
      dailyDetailEndDate,
      dailyDetailRows,
      dailyDetailPage,
      hasLoadedDailyDetails,
      isLoadingDailyDetails,
      monthlyDetailYear,
      monthlyDetailMonth,
      hasLoadedMonthlyDetails,
      isLoadingMonthlyDetails,
      updateStatus,
      isInstallingUpdate,
      availableUpdate,
      currentAppVersion
    };
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    applyTheme(mode);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
    void i18n.changeLanguage(nextLocale);
  }, []);

  const setShowPageSourceIds = useCallback((visible: boolean) => {
    setShowPageSourceIdsState(visible);
    if (!visible) {
      setCopiedPageSourceId(null);
    }
    try {
      window.localStorage.setItem(PAGE_SOURCE_VISIBILITY_STORAGE_KEY, String(visible));
    } catch {}
  }, []);

  const setDatabasePathDraft = useCallback((val: string) => {
    setDatabasePathDraftState(val);
    setDatabasePathDraftDirty(true);
    setDatabasePathNotice(null);
  }, []);

  const autoSyncIntervalForMode = useCallback((mode: AutoSyncModeValue): number | null => {
    return AUTO_SYNC_OPTIONS.find((option) => option.value === mode)?.intervalMs ?? null;
  }, []);

  const clearAutoSyncTimeout = useCallback(() => {
    if (autoSyncTimeoutIdRef.current !== null) {
      window.clearTimeout(autoSyncTimeoutIdRef.current);
      autoSyncTimeoutIdRef.current = null;
    }
  }, []);

  const clearSyncStatusPoll = useCallback(() => {
    if (syncStatusPollTimeoutIdRef.current !== null) {
      window.clearTimeout(syncStatusPollTimeoutIdRef.current);
      syncStatusPollTimeoutIdRef.current = null;
    }
  }, []);

  const initializeDailyDetailRange = useCallback((timeZone: string, nowValue: string) => {
    if (stateRef.current.dailyDetailStartDate && stateRef.current.dailyDetailEndDate) {
      return;
    }
    const endDate = formatDateInputValue(new Date(nowValue), timeZone);
    const startDate = `${endDate.slice(0, 7)}-01`;
    if (!stateRef.current.dailyDetailStartDate) {
      setDailyDetailStartDate(startDate);
    }
    if (!stateRef.current.dailyDetailEndDate) {
      setDailyDetailEndDate(endDate);
    }
  }, []);

  const initializeMonthlyDetailSelection = useCallback((timeZone: string, nowValue: string) => {
    if (stateRef.current.monthlyDetailYear && stateRef.current.monthlyDetailMonth !== null) {
      return;
    }
    const currentDate = formatDateInputValue(new Date(nowValue), timeZone);
    if (!stateRef.current.monthlyDetailYear) {
      setMonthlyDetailYear(currentDate.slice(0, 4));
    }
    if (stateRef.current.monthlyDetailMonth === null) {
      setMonthlyDetailMonth(Number.parseInt(currentDate.slice(5, 7), 10));
    }
  }, []);

  const syncDatabasePathDraft = useCallback((nextPath: string, force = false) => {
    if (!force && stateRef.current.databasePathDraftDirty) {
      return;
    }
    setDatabasePathDraftState(nextPath);
    setDatabasePathDraftDirty(false);
  }, []);

  const applyDashboardPayload = useCallback(
    (payload: DashboardPayloadDTO, forceDatabasePathDraft = false, resetSyncPreview = false) => {
      setDashboard(payload);
      if (payload.syncPreview !== null || resetSyncPreview) {
        setSyncPreview(payload.syncPreview);
      }
      const isCurrentlySyncing = payload.status.state === "syncing";
      setIsSyncing(isCurrentlySyncing);
      if (!isCurrentlySyncing) {
        setSyncProgress(null);
      }
      initializeDailyDetailRange(payload.meta.timeZone, payload.now);
      initializeMonthlyDetailSelection(payload.meta.timeZone, payload.now);
      syncDatabasePathDraft(payload.meta.databasePath, forceDatabasePathDraft);
    },
    [initializeDailyDetailRange, initializeMonthlyDetailSelection, syncDatabasePathDraft]
  );

  const loadSyncPreview = useCallback(async (expectedSyncGeneration = syncGenerationRef.current) => {
    const requestId = ++latestSyncPreviewRequestIdRef.current;
    try {
      const preview = await fetchSyncPreview();
      if (
        requestId !== latestSyncPreviewRequestIdRef.current ||
        expectedSyncGeneration !== syncGenerationRef.current ||
        stateRef.current.isSyncing
      ) {
        return;
      }
      setSyncPreview(preview);

      if (
        !hasAttemptedInitialSyncRef.current &&
        !stateRef.current.isSyncing &&
        !stateRef.current.isLoading &&
        stateRef.current.dashboard?.status.lastSyncedAt === null &&
        preview.needsSync &&
        preview.totalSessionFiles > 0
      ) {
        hasAttemptedInitialSyncRef.current = true;
        void syncDashboard();
      }
    } catch {}
  }, []);

  const monitorSyncCompletion = useCallback(async () => {
    clearSyncStatusPoll();
    try {
      const syncRunning = await isSyncRunning();
      if (syncRunning) {
        const progress = await fetchCurrentSyncProgress();
        if (progress) {
          setSyncProgress(progress);
        }
        scheduleSyncStatusPoll();
        return;
      }

      setIsSyncing(false);
      setSyncProgress(null);
      await loadDashboard();

      if (!stateRef.current.isSyncing && stateRef.current.hasLoadedDailyDetails) {
        void loadDailyDetails();
      }

      if (!stateRef.current.isSyncing) {
        rescheduleAutoSyncIfNeeded();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(translateErrorMessage(stateRef.current.locale, message));
      if (stateRef.current.isSyncing) {
        scheduleSyncStatusPoll(SYNC_STATUS_POLL_INTERVAL_MS * 2);
      }
    }
  }, []);

  const scheduleSyncStatusPoll = useCallback(
    (delayMs = SYNC_STATUS_POLL_INTERVAL_MS) => {
      clearSyncStatusPoll();
      syncStatusPollTimeoutIdRef.current = window.setTimeout(() => {
        void monitorSyncCompletion();
      }, delayMs);
    },
    [clearSyncStatusPoll, monitorSyncCompletion]
  );

  const scheduleNextAutoSync = useCallback(
    (intervalMs: number) => {
      clearAutoSyncTimeout();
      const targetTime = Date.now() + intervalMs;
      setNextAutoSyncAt(targetTime);
      setAutoSyncRemaining(intervalMs);
      autoSyncTimeoutIdRef.current = window.setTimeout(() => {
        void runScheduledAutoSync();
      }, intervalMs);
    },
    [clearAutoSyncTimeout]
  );

  const rescheduleAutoSyncIfNeeded = useCallback(() => {
    const intervalMs = autoSyncIntervalForMode(stateRef.current.autoSyncMode);
    if (intervalMs === null) {
      clearAutoSyncTimeout();
      setNextAutoSyncAt(null);
      setAutoSyncRemaining(null);
      return;
    }
    scheduleNextAutoSync(intervalMs);
  }, [autoSyncIntervalForMode, clearAutoSyncTimeout, scheduleNextAutoSync]);

  const runScheduledAutoSync = useCallback(async () => {
    autoSyncTimeoutIdRef.current = null;
    const intervalMs = autoSyncIntervalForMode(stateRef.current.autoSyncMode);
    if (intervalMs === null) {
      clearAutoSyncTimeout();
      setNextAutoSyncAt(null);
      setAutoSyncRemaining(null);
      return;
    }

    if (stateRef.current.isLoading || stateRef.current.isSyncing) {
      scheduleNextAutoSync(intervalMs);
      return;
    }

    await syncDashboard();
  }, [autoSyncIntervalForMode, clearAutoSyncTimeout, scheduleNextAutoSync]);

  const syncDashboard = useCallback(async () => {
    if (stateRef.current.isLoading || stateRef.current.isSyncing) {
      return;
    }

    syncGenerationRef.current += 1;
    const previousStatus = stateRef.current.dashboard ? { ...stateRef.current.dashboard.status } : null;
    clearAutoSyncTimeout();
    setNextAutoSyncAt(null);
    setAutoSyncRemaining(null);
    clearSyncStatusPoll();
    setErrorMessage(null);

    setIsSyncing(true);
    setSyncProgress(syncProgressSnapshot(stateRef.current.syncPreview ?? stateRef.current.dashboard?.syncPreview ?? null));
    if (stateRef.current.dashboard) {
      setDashboard({
        ...stateRef.current.dashboard,
        status: syncingStatusSnapshot(stateRef.current.dashboard)
      });
    }

    try {
      const started = await startSync();
      if (!started) {
        setIsSyncing(true);
        const progress = await fetchCurrentSyncProgress();
        if (progress) {
          setSyncProgress(progress);
        }
      }
      scheduleSyncStatusPoll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(translateErrorMessage(stateRef.current.locale, message));
      setIsSyncing(false);
      setSyncProgress(null);
      if (previousStatus && stateRef.current.dashboard) {
        setDashboard({
          ...stateRef.current.dashboard,
          status: previousStatus
        });
      }
    } finally {
      if (!stateRef.current.isSyncing) {
        rescheduleAutoSyncIfNeeded();
      }
    }
  }, [clearAutoSyncTimeout, clearSyncStatusPoll, rescheduleAutoSyncIfNeeded, scheduleSyncStatusPoll]);

  const loadDashboard = useCallback(async () => {
    const requestId = ++latestDashboardRequestIdRef.current;
    const requestSyncGeneration = syncGenerationRef.current;
    let shouldRefreshSyncPreview = false;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const payload = await fetchDashboard();
      if (requestId !== latestDashboardRequestIdRef.current) {
        return;
      }
      if (requestSyncGeneration !== syncGenerationRef.current && stateRef.current.isSyncing) {
        return;
      }

      applyDashboardPayload(payload);
      if (payload.status.state === "failed" && payload.status.errorMessage) {
        setErrorMessage(translateErrorMessage(stateRef.current.locale, payload.status.errorMessage));
      }
      if (stateRef.current.isSyncing) {
        const progress = await fetchCurrentSyncProgress();
        setSyncProgress(progress);
        scheduleSyncStatusPoll();
      } else {
        clearSyncStatusPoll();
        shouldRefreshSyncPreview = true;
      }
    } catch (error) {
      if (requestId !== latestDashboardRequestIdRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(translateErrorMessage(stateRef.current.locale, message));
    } finally {
      if (requestId === latestDashboardRequestIdRef.current) {
        setIsLoading(false);
        if (shouldRefreshSyncPreview && requestSyncGeneration === syncGenerationRef.current && !stateRef.current.isSyncing) {
          void loadSyncPreview(requestSyncGeneration);
        }
      }
    }
  }, [applyDashboardPayload, clearSyncStatusPoll, loadSyncPreview, scheduleSyncStatusPoll]);

  const setAutoSyncMode = useCallback(
    (nextMode: AutoSyncModeValue) => {
      const option = AUTO_SYNC_OPTIONS.find((item) => item.value === nextMode);
      if (!option) {
        return;
      }
      setAutoSyncModeState(option.value);
      if (option.intervalMs === null) {
        clearAutoSyncTimeout();
        setNextAutoSyncAt(null);
        setAutoSyncRemaining(null);
        return;
      }
      scheduleNextAutoSync(option.intervalMs);
    },
    [clearAutoSyncTimeout, scheduleNextAutoSync]
  );

  const validateDailyDetailRange = useCallback((): string | null => {
    const { dailyDetailStartDate: start, dailyDetailEndDate: end, locale: curLocale } = stateRef.current;
    if (!start || !end) {
      return t(curLocale, "selectDateRangeError");
    }
    if (start > end) {
      return t(curLocale, "invalidDateRangeError");
    }
    if (dateRangeDayCount(start, end) > MAX_DAILY_DETAIL_RANGE_DAYS) {
      return t(curLocale, "dailyUsageRangeTooLarge", { maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS, curLocale) });
    }
    return null;
  }, []);

  const loadDailyDetails = useCallback(async () => {
    const validationError = validateDailyDetailRange();
    if (validationError) {
      setDailyDetailsError(validationError);
      return;
    }

    setIsLoadingDailyDetails(true);
    setDailyDetailsError(null);

    try {
      const rows = await queryDailyUsage(stateRef.current.dailyDetailStartDate, stateRef.current.dailyDetailEndDate);
      setDailyDetailRows(rows);
      setDailyDetailPage(1);
      setHasLoadedDailyDetails(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDailyDetailsError(translateErrorMessage(stateRef.current.locale, message));
    } finally {
      setIsLoadingDailyDetails(false);
    }
  }, [validateDailyDetailRange]);

  const loadMonthlyDetails = useCallback(async (nextMonth = stateRef.current.monthlyDetailMonth) => {
    if (!stateRef.current.monthlyDetailYear || nextMonth === null) {
      setMonthlyDetailsError(t(stateRef.current.locale, "readyToQueryMonthlyDetailDescription"));
      return;
    }

    setMonthlyDetailMonth(nextMonth);
    setIsLoadingMonthlyDetails(true);
    setMonthlyDetailsError(null);

    try {
      const { startDate, endDate } = dateRangeForMonth(stateRef.current.monthlyDetailYear, nextMonth);
      const rows = await queryDailyUsage(startDate, endDate);
      setMonthlyDetailRows(rows);
      setHasLoadedMonthlyDetails(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMonthlyDetailsError(translateErrorMessage(stateRef.current.locale, message));
    } finally {
      setIsLoadingMonthlyDetails(false);
    }
  }, []);

  const setActiveTab = useCallback(
    (nextTab: AppTab) => {
      const normalizedTab = (nextTab as string) === "syncInfo" ? "settings" : nextTab;
      if (
        normalizedTab !== "overview" &&
        normalizedTab !== "monthlyHistory" &&
        normalizedTab !== "monthlyDetail" &&
        normalizedTab !== "settings" &&
        normalizedTab !== "dailyDetail" &&
        normalizedTab !== "relayPricing" &&
        normalizedTab !== "codexPlugin"
      ) {
        return;
      }

      if (normalizedTab === "dailyDetail") {
        const timeZone = stateRef.current.dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const nowValue = stateRef.current.dashboard?.now ?? new Date().toISOString();
        initializeDailyDetailRange(timeZone, nowValue);
      }

      if (normalizedTab === "monthlyDetail") {
        const timeZone = stateRef.current.dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const nowValue = stateRef.current.dashboard?.now ?? new Date().toISOString();
        initializeMonthlyDetailSelection(timeZone, nowValue);
      }

      setActiveTabState(normalizedTab);

      if (normalizedTab === "dailyDetail" && !stateRef.current.hasLoadedDailyDetails && !stateRef.current.isLoadingDailyDetails) {
        void loadDailyDetails();
      }

      if (normalizedTab === "monthlyDetail" && !stateRef.current.hasLoadedMonthlyDetails && !stateRef.current.isLoadingMonthlyDetails) {
        void loadMonthlyDetails();
      }
    },
    [initializeDailyDetailRange, initializeMonthlyDetailSelection, loadDailyDetails, loadMonthlyDetails]
  );

  const copyPageSourceId = useCallback(async (pageSourceId: PageSourceId) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pageSourceId);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = pageSourceId;
        textArea.setAttribute("readonly", "");
        textArea.setAttribute("aria-hidden", "true");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.append(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
    } catch {}

    if (pageSourceCopyTimeoutIdRef.current !== null) {
      window.clearTimeout(pageSourceCopyTimeoutIdRef.current);
    }
    setCopiedPageSourceId(pageSourceId);
    pageSourceCopyTimeoutIdRef.current = window.setTimeout(() => {
      setCopiedPageSourceId((curr) => (curr === pageSourceId ? null : curr));
      pageSourceCopyTimeoutIdRef.current = null;
    }, 2_000);
  }, []);

  const saveDatabasePathOverride = useCallback(async () => {
    if (stateRef.current.isLoading || stateRef.current.isSyncing || stateRef.current.isUpdatingDatabasePath) {
      return;
    }

    const databasePath = stateRef.current.databasePathDraft.trim();
    if (!databasePath) {
      setDatabasePathNotice({
        tone: "bad",
        text: translateErrorMessage(stateRef.current.locale, "database path cannot be empty")
      });
      return;
    }

    setIsUpdatingDatabasePath(true);
    setDatabasePathNotice(null);

    try {
      const payload = await updateDatabasePath(databasePath);
      applyDashboardPayload(payload, true, true);
      setDailyDetailRows([]);
      setDailyDetailsError(null);
      setHasLoadedDailyDetails(false);
      setMonthlyDetailRows([]);
      setMonthlyDetailsError(null);
      setHasLoadedMonthlyDetails(false);
      setDatabasePathNotice({
        tone: "good",
        text: t(stateRef.current.locale, "sqlitePathSaved")
      });
      void loadSyncPreview(syncGenerationRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDatabasePathNotice({
        tone: "bad",
        text: translateErrorMessage(stateRef.current.locale, message)
      });
    } finally {
      setIsUpdatingDatabasePath(false);
    }
  }, [applyDashboardPayload, loadSyncPreview]);

  const resetDatabasePathOverride = useCallback(async () => {
    if (stateRef.current.isLoading || stateRef.current.isSyncing || stateRef.current.isUpdatingDatabasePath) {
      return;
    }

    setIsUpdatingDatabasePath(true);
    setDatabasePathNotice(null);

    try {
      const payload = await resetDatabasePath();
      applyDashboardPayload(payload, true, true);
      setDailyDetailRows([]);
      setDailyDetailsError(null);
      setHasLoadedDailyDetails(false);
      setMonthlyDetailRows([]);
      setMonthlyDetailsError(null);
      setHasLoadedMonthlyDetails(false);
      setDatabasePathNotice({
        tone: "good",
        text: t(stateRef.current.locale, "sqlitePathReset")
      });
      void loadSyncPreview(syncGenerationRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDatabasePathNotice({
        tone: "bad",
        text: translateErrorMessage(stateRef.current.locale, message)
      });
    } finally {
      setIsUpdatingDatabasePath(false);
    }
  }, [applyDashboardPayload, loadSyncPreview]);

  const checkForAppUpdates = useCallback(async (manual = false) => {
    if (stateRef.current.updateStatus === "checking" || stateRef.current.isInstallingUpdate) {
      return;
    }

    setUpdateStatus("checking");
    setUpdateErrorMessage(null);

    try {
      if (!stateRef.current.currentAppVersion) {
        const version = await fetchCurrentAppVersion();
        setCurrentAppVersion(version);
      }

      const update = await checkForPendingAppUpdate();
      setAvailableUpdate(update);
      setUpdateDownloadedBytes(0);
      setUpdateContentLength(null);
      setUpdateStatus(update ? "available" : "upToDate");
    } catch (error) {
      if (!manual) {
        setUpdateStatus(stateRef.current.availableUpdate ? "available" : "idle");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setUpdateStatus("error");
      setUpdateErrorMessage(translateErrorMessage(stateRef.current.locale, message));
    }
  }, []);

  const installAppUpdate = useCallback(async () => {
    if (!stateRef.current.availableUpdate || stateRef.current.isInstallingUpdate || stateRef.current.updateStatus === "checking") {
      return;
    }

    setIsInstallingUpdate(true);
    setUpdateStatus("installing");
    setUpdateErrorMessage(null);
    setUpdateDownloadedBytes(0);
    setUpdateContentLength(null);

    try {
      await installPendingAppUpdate(stateRef.current.availableUpdate, (event) => {
        if (event.kind === "started") {
          setUpdateContentLength(event.contentLength);
        } else if (event.kind === "progress") {
          setUpdateDownloadedBytes((prev) => prev + event.chunkLength);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setIsInstallingUpdate(false);
      setUpdateStatus("error");
      setUpdateErrorMessage(translateErrorMessage(stateRef.current.locale, message));
    }
  }, []);

  const openSourceRepositoryInBrowser = useCallback(async () => {
    try {
      await openSourceRepository();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(translateErrorMessage(stateRef.current.locale, message));
    }
  }, []);

  // Countdown timer effect
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (nextAutoSyncAt === null) {
        setAutoSyncRemaining(null);
        return;
      }
      const remaining = Math.max(nextAutoSyncAt - Date.now(), 0);
      setAutoSyncRemaining(remaining);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [nextAutoSyncAt]);

  // Global keydown (Cmd/Ctrl + 1..5, Cmd/Ctrl + ,)
  useEffect(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof Element && target.closest("[contenteditable='true']"))
      ) {
        return;
      }

      const primaryModifier = isMacLikePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!primaryModifier) {
        return;
      }

      let targetTab: AppTab | null = null;
      if (event.key === "," || event.code === "Comma") {
        targetTab = "settings";
      } else if (event.key === "1" || event.code === "Digit1" || event.code === "Numpad1") {
        targetTab = "overview";
      } else if (event.key === "2" || event.code === "Digit2" || event.code === "Numpad2") {
        targetTab = "dailyDetail";
      } else if (event.key === "3" || event.code === "Digit3" || event.code === "Numpad3") {
        targetTab = "monthlyHistory";
      } else if (event.key === "4" || event.code === "Digit4" || event.code === "Numpad4") {
        targetTab = "monthlyDetail";
      } else if (event.key === "5" || event.code === "Digit5" || event.code === "Numpad5") {
        targetTab = "relayPricing";
      } else if (event.key === "6" || event.code === "Digit6" || event.code === "Numpad6") {
        targetTab = "codexPlugin";
      }

      if (targetTab) {
        event.preventDefault();
        setActiveTab(targetTab);
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, [setActiveTab]);

  // Native menu listener (open-settings & navigate-tab)
  useEffect(() => {
    let unlistenSettings: (() => void) | null = null;
    let unlistenNavigate: (() => void) | null = null;

    void listen("open-settings", () => {
      setActiveTab("settings");
    }).then((fn) => {
      unlistenSettings = fn;
    });

    void listen<AppTab>("navigate-tab", (event) => {
      if (event.payload) {
        setActiveTab(event.payload);
      }
    }).then((fn) => {
      unlistenNavigate = fn;
    });

    return () => {
      if (unlistenSettings) {
        unlistenSettings();
      }
      if (unlistenNavigate) {
        unlistenNavigate();
      }
    };
  }, [setActiveTab]);

  // System theme changes listener
  useEffect(() => {
    const handleSystemThemeChange = () => {
      if (stateRef.current.themeMode === "system") {
        applyTheme("system", false);
      }
    };
    systemThemeQuery?.addEventListener("change", handleSystemThemeChange);
    return () => systemThemeQuery?.removeEventListener("change", handleSystemThemeChange);
  }, []);

  // Sync Progress listener from Tauri
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<SyncProgressDTO>(SYNC_PROGRESS_EVENT_NAME, (event) => {
      setSyncProgress(event.payload);
      if (event.payload.phase === "failed" && event.payload.errorMessage) {
        setErrorMessage(translateErrorMessage(stateRef.current.locale, event.payload.errorMessage));
      }
      if (event.payload.phase === "complete" || event.payload.phase === "failed") {
        scheduleSyncStatusPoll(120);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [scheduleSyncStatusPoll]);

  // Initial mount setup
  useEffect(() => {
    applyTheme(themeMode, false);
    try {
      const appWindow = getCurrentWindow();
      void appWindow.maximize();
      void appWindow.show();
    } catch {}

    void fetchCurrentAppVersion().then(setCurrentAppVersion).catch(() => {});
    void loadDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Non-critical background deferred tasks queue (runs after initial render settles & main thread is idle)
  useDeferredTasks([
    {
      id: "app-update-check",
      name: "Check for App Updates",
      run: async () => {
        if (!import.meta.env.DEV) {
          await checkForAppUpdates(false);
        }
      },
      delayMs: 1500
    }
  ]);

  const contextValue: AppContextType = {
    dashboard,
    syncPreview,
    syncProgress,
    isLoading,
    isSyncing,
    isUpdatingDatabasePath,
    errorMessage,
    locale,
    themeMode,
    showPageSourceIds,
    autoSyncMode,
    nextAutoSyncAt,
    autoSyncRemaining,
    activeTab,
    databasePathDraft,
    databasePathDraftDirty,
    databasePathNotice,
    dailyDetailRows,
    dailyDetailStartDate,
    dailyDetailEndDate,
    dailyDetailPage,
    isLoadingDailyDetails,
    dailyDetailsError,
    hasLoadedDailyDetails,
    monthlyDetailRows,
    monthlyDetailYear,
    monthlyDetailMonth,
    isLoadingMonthlyDetails,
    monthlyDetailsError,
    hasLoadedMonthlyDetails,
    currentAppVersion,
    updateStatus,
    updateErrorMessage,
    availableUpdate,
    isInstallingUpdate,
    updateDownloadedBytes,
    updateContentLength,
    copiedPageSourceId,
    setThemeMode,
    setLocale,
    setShowPageSourceIds,
    setActiveTab,
    setAutoSyncMode,
    setDatabasePathDraft,
    setDailyDetailStartDate,
    setDailyDetailEndDate,
    setDailyDetailPage,
    setMonthlyDetailYear,
    copyPageSourceId,
    syncDashboard,
    loadDashboard,
    loadDailyDetails,
    loadMonthlyDetails,
    saveDatabasePathOverride,
    resetDatabasePathOverride,
    checkForAppUpdates,
    installAppUpdate,
    openSourceRepositoryInBrowser
  };

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};
