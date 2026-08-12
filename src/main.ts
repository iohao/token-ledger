import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  Check,
  CircleDollarSign,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Gauge,
  Info,
  Languages,
  LayoutDashboard,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  TableProperties,
  createIcons
} from "lucide";
import {
  fetchCurrentSyncProgress,
  fetchDashboard,
  fetchSyncPreview,
  isSyncRunning,
  openSourceRepository,
  queryDailyUsage,
  resetDatabasePath,
  startSync,
  updateDatabasePath,
  updateModelPricingSettings
} from "./api/tauri";
import {
  checkForPendingAppUpdate,
  fetchCurrentAppVersion,
  installPendingAppUpdate
} from "./api/updater";
import { renderSidebarNav } from "./components/sidebar";
import { renderSummaryCard } from "./components/summary-card";
import {
  renderSyncProgressCard,
  syncProgressSnapshot,
  syncingStatusSnapshot
} from "./components/sync-progress";
import {
  decorateUpdateErrorMessage,
  renderUpdateBanner
} from "./components/update-banner";
import type {
  DashboardPayloadDTO,
  ModelPricingOverrideDTO,
  ModelPricingRatesDTO,
  ModelPricingSettingDTO,
  SyncProgressDTO,
  SyncPreviewDTO
} from "./dto/dashboard";
import { isLocale, persistLocale, t, translateErrorMessage, translatePricingNote, type Locale } from "./i18n";
import { state } from "./state";
import {
  AUTO_SYNC_OPTIONS,
  DAILY_DETAIL_PAGE_SIZE,
  PAGE_SOURCE_VISIBILITY_STORAGE_KEY,
  PRICING_RATE_FIELDS,
  RELAY_PRICING_PRESETS,
  SYNC_PROGRESS_EVENT_NAME,
  SYNC_STATUS_POLL_INTERVAL_MS,
  type AppTab,
  type AutoSyncModeValue,
  type ModelPricingDraft,
  type PageSourceId,
  type PricingRateField,
  type ThemeMode
} from "./types";
import {
  escapeHtml,
  formatCountdown,
  formatDateInputValue,
  formatPricingInput,
  statusLabel
} from "./utils/format";
import { applyTheme, systemThemeQuery } from "./utils/theme";
import { renderDailyDetailView, validateDailyDetailRange } from "./views/daily-detail";
import { dateRangeForMonth, renderMonthlyDetailView } from "./views/monthly-detail";
import { renderMonthlyHistoryView } from "./views/monthly-history";
import { renderOverviewView } from "./views/overview";
import { pricingErrorKey, renderSettingsView } from "./views/settings";
import "./styles.css";
import "./redesign.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Missing #root container");
}

const appRoot = root;

const ui = {
  liveRegion: null as HTMLDivElement | null,
  skipLink: null as HTMLAnchorElement | null,
  sidebar: null as HTMLElement | null,
  content: null as HTMLDivElement | null,
  activityTooltip: null as HTMLDivElement | null
};

let autoSyncTimeoutId: number | null = null;
let autoSyncCountdownId: number | null = null;
let syncStatusPollTimeoutId: number | null = null;
let latestDashboardRequestId = 0;
let latestSyncPreviewRequestId = 0;
let syncGeneration = 0;
let hasInitializedSyncProgressListener = false;
let hasInitializedShell = false;
let lastLiveRegionText = "";
let lastSkipLinkText = "";
let lastSidebarMarkup = "";
let lastContentMarkup = "";
let settingsSectionObserver: IntersectionObserver | null = null;
let activeActivityTooltipDay: HTMLElement | null = null;
let pageSourceCopyTimeoutId: number | null = null;
const isMacLikePlatform = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function setThemeMode(themeMode: ThemeMode): void {
  state.themeMode = themeMode;
  applyTheme(themeMode);
  render();
}

function initializeDailyDetailRange(timeZone: string, nowValue: string): void {
  if (state.dailyDetailStartDate && state.dailyDetailEndDate) {
    return;
  }

  const endDate = formatDateInputValue(new Date(nowValue), timeZone);
  const startDate = `${endDate.slice(0, 7)}-01`;

  if (!state.dailyDetailStartDate) {
    state.dailyDetailStartDate = startDate;
  }

  if (!state.dailyDetailEndDate) {
    state.dailyDetailEndDate = endDate;
  }
}

function initializeMonthlyDetailSelection(timeZone: string, nowValue: string): void {
  if (state.monthlyDetailYear && state.monthlyDetailMonth !== null) {
    return;
  }

  const currentDate = formatDateInputValue(new Date(nowValue), timeZone);

  if (!state.monthlyDetailYear) {
    state.monthlyDetailYear = currentDate.slice(0, 4);
  }

  if (state.monthlyDetailMonth === null) {
    state.monthlyDetailMonth = Number.parseInt(currentDate.slice(5, 7), 10);
  }
}

function autoSyncIntervalForMode(mode: AutoSyncModeValue): number | null {
  return AUTO_SYNC_OPTIONS.find((option) => option.value === mode)?.intervalMs ?? null;
}

function autoSyncLabel(mode: AutoSyncModeValue): string {
  switch (mode) {
    case "manual":
      return t(state.locale, "autoSyncManual");
    case "10s":
      return t(state.locale, "autoSync10s");
    case "30s":
      return t(state.locale, "autoSync30s");
    case "1m":
      return t(state.locale, "autoSync1m");
    case "5m":
      return t(state.locale, "autoSync5m");
    case "10m":
      return t(state.locale, "autoSync10m");
    case "15m":
      return t(state.locale, "autoSync15m");
    case "30m":
      return t(state.locale, "autoSync30m");
  }
}

function autoSyncRemainingMs(): number | null {
  const intervalMs = autoSyncIntervalForMode(state.autoSyncMode);

  if (intervalMs === null) {
    return null;
  }

  if (state.nextAutoSyncAt === null) {
    return intervalMs;
  }

  return Math.max(state.nextAutoSyncAt - Date.now(), 0);
}

function stopAutoSyncCountdown(): void {
  if (autoSyncCountdownId !== null) {
    window.clearInterval(autoSyncCountdownId);
    autoSyncCountdownId = null;
  }
}

function clearAutoSyncTimeout(): void {
  if (autoSyncTimeoutId !== null) {
    window.clearTimeout(autoSyncTimeoutId);
    autoSyncTimeoutId = null;
  }
}

function clearAutoSyncSchedule(): void {
  clearAutoSyncTimeout();
  stopAutoSyncCountdown();
  state.nextAutoSyncAt = null;
}

function clearSyncStatusPoll(): void {
  if (syncStatusPollTimeoutId !== null) {
    window.clearTimeout(syncStatusPollTimeoutId);
    syncStatusPollTimeoutId = null;
  }
}

function scheduleSyncStatusPoll(delayMs = SYNC_STATUS_POLL_INTERVAL_MS): void {
  clearSyncStatusPoll();
  syncStatusPollTimeoutId = window.setTimeout(() => {
    void monitorSyncCompletion();
  }, delayMs);
}

function markSyncStartedLocally(): void {
  state.isSyncing = true;
  state.syncProgress = syncProgressSnapshot(state.syncPreview ?? state.dashboard?.syncPreview ?? null);

  if (state.dashboard) {
    state.dashboard.status = syncingStatusSnapshot(state.dashboard);
  }
}

function rescheduleAutoSyncIfNeeded(): void {
  const intervalMs = autoSyncIntervalForMode(state.autoSyncMode);

  if (intervalMs === null) {
    clearAutoSyncSchedule();
    render();
    return;
  }

  scheduleNextAutoSync(intervalMs);
}

function patchVisibleSyncProgress(): void {
  if (state.activeTab !== "overview") {
    return;
  }

  const syncProgressSlot = appRoot.querySelector<HTMLElement>("[data-sync-progress-slot]");
  if (!syncProgressSlot) {
    return;
  }

  const markup = renderSyncProgressCard(
    state.syncProgress,
    state.isSyncing,
    state.syncPreview ?? state.dashboard?.syncPreview ?? null,
    state.locale
  );
  if (syncProgressSlot.innerHTML !== markup) {
    syncProgressSlot.innerHTML = markup;
  }
}

function sameSyncPreview(left: SyncPreviewDTO | null, right: SyncPreviewDTO): boolean {
  return (
    left?.needsSync === right.needsSync &&
    left?.newSessions === right.newSessions &&
    left?.changedSessions === right.changedSessions &&
    left?.removedSessions === right.removedSessions &&
    left?.totalTrackedSessions === right.totalTrackedSessions &&
    left?.totalSessionFiles === right.totalSessionFiles
  );
}

function updateAutoSyncCountdownLabel(): void {
  const countdownNode = appRoot.querySelector<HTMLElement>("[data-auto-sync-countdown]");
  const autoSyncRemaining = autoSyncRemainingMs();

  if (!countdownNode || autoSyncRemaining === null) {
    return;
  }

  countdownNode.textContent = state.isSyncing
    ? t(state.locale, "syncingShort")
    : t(state.locale, "countdown", { value: formatCountdown(autoSyncRemaining) });
}

function ensureAutoSyncCountdown(): void {
  if (autoSyncCountdownId !== null) {
    return;
  }

  autoSyncCountdownId = window.setInterval(() => {
    if (autoSyncIntervalForMode(state.autoSyncMode) === null || state.nextAutoSyncAt === null) {
      stopAutoSyncCountdown();
      return;
    }

    if (!state.isSyncing) {
      updateAutoSyncCountdownLabel();
    }
  }, 1_000);
}

function scheduleNextAutoSync(intervalMs: number): void {
  clearAutoSyncTimeout();
  state.nextAutoSyncAt = Date.now() + intervalMs;
  autoSyncTimeoutId = window.setTimeout(() => {
    void runScheduledAutoSync();
  }, intervalMs);
  ensureAutoSyncCountdown();
  render();
}

function handleAutoSyncModeChange(nextMode: string): void {
  const option = AUTO_SYNC_OPTIONS.find((item) => item.value === nextMode);
  if (!option) {
    return;
  }

  state.autoSyncMode = option.value;

  if (option.intervalMs === null) {
    clearAutoSyncSchedule();
    render();
    return;
  }

  scheduleNextAutoSync(option.intervalMs);
}

function setLocale(nextLocale: Locale): void {
  if (state.locale === nextLocale) {
    return;
  }

  state.locale = nextLocale;
  persistLocale(nextLocale);
  render();
}

function setPageSourceVisibility(visible: boolean): void {
  state.showPageSourceIds = visible;
  if (!visible) {
    state.copiedPageSourceId = null;
  }

  try {
    window.localStorage.setItem(PAGE_SOURCE_VISIBILITY_STORAGE_KEY, String(visible));
  } catch {
    // Keep the preference for this session when local storage is unavailable.
  }

  render();
}

function syncDatabasePathDraft(nextPath: string, force = false): void {
  if (!force && state.databasePathDraftDirty) {
    return;
  }

  state.databasePathDraft = nextPath;
  state.databasePathDraftDirty = false;
}

function syncModelPricingDraft(settings: ModelPricingSettingDTO[], force = false): void {
  if (!force && state.modelPricingDraftDirty) {
    return;
  }

  state.modelPricingDraft = settings.map((setting) => ({
    model: setting.model,
    enabled: setting.relayEnabled,
    rates: {
      inputUsdPerMillion: formatPricingInput(setting.relayRates.inputUsdPerMillion),
      outputUsdPerMillion: formatPricingInput(setting.relayRates.outputUsdPerMillion),
      cacheReadUsdPerMillion: formatPricingInput(setting.relayRates.cacheReadUsdPerMillion),
      cacheCreationUsdPerMillion: formatPricingInput(setting.relayRates.cacheCreationUsdPerMillion)
    }
  }));
  state.modelPricingDraftDirty = false;
  state.modelPricingErrors = {};
}

function applyDashboardPayload(
  payload: DashboardPayloadDTO,
  forceDatabasePathDraft = false,
  resetSyncPreview = false
): void {
  state.dashboard = payload;
  if (payload.syncPreview !== null || resetSyncPreview) {
    state.syncPreview = payload.syncPreview;
  }
  state.isSyncing = payload.status.state === "syncing";
  if (!state.isSyncing) {
    state.syncProgress = null;
  }
  initializeDailyDetailRange(payload.meta.timeZone, payload.now);
  initializeMonthlyDetailSelection(payload.meta.timeZone, payload.now);
  syncDatabasePathDraft(payload.meta.databasePath, forceDatabasePathDraft);
  syncModelPricingDraft(payload.meta.modelPricingSettings);
}

function handleTabChange(nextTab: string): void {
  const normalizedTab = nextTab === "syncInfo" ? "settings" : nextTab;
  if (
    normalizedTab !== "overview" &&
    normalizedTab !== "monthlyHistory" &&
    normalizedTab !== "monthlyDetail" &&
    normalizedTab !== "settings" &&
    normalizedTab !== "dailyDetail"
  ) {
    return;
  }

  if (normalizedTab === "dailyDetail") {
    const timeZone = state.dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const nowValue = state.dashboard?.now ?? new Date().toISOString();
    initializeDailyDetailRange(timeZone, nowValue);
  }

  if (normalizedTab === "monthlyDetail") {
    const timeZone = state.dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const nowValue = state.dashboard?.now ?? new Date().toISOString();
    initializeMonthlyDetailSelection(timeZone, nowValue);
  }

  state.activeTab = normalizedTab;
  render();

  if (normalizedTab === "dailyDetail" && !state.hasLoadedDailyDetails && !state.isLoadingDailyDetails) {
    void loadDailyDetails();
  }

  if (normalizedTab === "monthlyDetail" && !state.hasLoadedMonthlyDetails && !state.isLoadingMonthlyDetails) {
    void loadMonthlyDetails();
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest("[contenteditable='true']") !== null
  );
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.shiftKey || isEditableTarget(event.target)) {
    return;
  }

  const primaryModifierPressed = isMacLikePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primaryModifierPressed) {
    return;
  }

  let nextTab: AppTab | null = null;
  switch (event.key) {
    case "1":
      nextTab = "overview";
      break;
    case "2":
      nextTab = "monthlyDetail";
      break;
    case "3":
      nextTab = "monthlyHistory";
      break;
    case "4":
      nextTab = "dailyDetail";
      break;
    case "5":
      nextTab = "settings";
      break;
    default:
      break;
  }

  if (!nextTab) {
    return;
  }

  event.preventDefault();
  handleTabChange(nextTab);
}

function fallbackCopyText(value: string): boolean {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.setAttribute("aria-hidden", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  return copied;
}

async function copyPageSourceId(pageSourceId: PageSourceId): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(pageSourceId);
    } else if (!fallbackCopyText(pageSourceId)) {
      throw new Error("Clipboard API is unavailable");
    }
  } catch {
    if (!fallbackCopyText(pageSourceId)) {
      return;
    }
  }

  if (pageSourceCopyTimeoutId !== null) {
    window.clearTimeout(pageSourceCopyTimeoutId);
  }
  state.copiedPageSourceId = pageSourceId;
  render();
  pageSourceCopyTimeoutId = window.setTimeout(() => {
    if (state.copiedPageSourceId === pageSourceId) {
      state.copiedPageSourceId = null;
      render();
    }
    pageSourceCopyTimeoutId = null;
  }, 2_000);
}

function validatePricingRate(value: string): string | null {
  if (!value.trim()) {
    return t(state.locale, "pricingRequiredError");
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return t(state.locale, "pricingInvalidError");
  }

  return null;
}

function modelPricingOverridesFromDraft(): ModelPricingOverrideDTO[] | null {
  const errors: Record<string, string> = {};
  const settings = state.modelPricingDraft.map((draft) => {
    const rates = {} as ModelPricingRatesDTO;
    for (const field of PRICING_RATE_FIELDS) {
      const error = validatePricingRate(draft.rates[field]);
      if (error) {
        errors[pricingErrorKey(draft.model, field)] = error;
      }
      rates[field] = Number(draft.rates[field]);
    }

    return {
      model: draft.model,
      enabled: draft.enabled,
      rates
    };
  });

  state.modelPricingErrors = errors;
  return Object.keys(errors).length === 0 ? settings : null;
}

function resetModelPricingPresetDraft(): void {
  if (state.isLoading || state.isSyncing || state.isUpdatingModelPricing) {
    return;
  }

  state.modelPricingDraft = state.modelPricingDraft.map((draft) => {
    const preset = RELAY_PRICING_PRESETS[draft.model];
    if (!preset) {
      return draft;
    }
    return {
      ...draft,
      rates: {
        inputUsdPerMillion: formatPricingInput(preset.inputUsdPerMillion),
        outputUsdPerMillion: formatPricingInput(preset.outputUsdPerMillion),
        cacheReadUsdPerMillion: formatPricingInput(preset.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: formatPricingInput(preset.cacheCreationUsdPerMillion)
      }
    };
  });
  state.modelPricingDraftDirty = true;
  state.modelPricingErrors = {};
  state.modelPricingNotice = null;
  render();
}

async function saveModelPricingSettings(): Promise<void> {
  if (state.isLoading || state.isSyncing || state.isUpdatingModelPricing) {
    return;
  }

  const settings = modelPricingOverridesFromDraft();
  if (!settings) {
    state.modelPricingNotice = { tone: "bad", text: t(state.locale, "pricingValidationError") };
    render();
    window.setTimeout(() => {
      appRoot.querySelector<HTMLInputElement>('[data-pricing-rate][aria-invalid="true"]')?.focus();
    });
    return;
  }

  state.isUpdatingModelPricing = true;
  state.modelPricingNotice = null;
  render();

  try {
    const payload = await updateModelPricingSettings(settings);
    state.modelPricingDraftDirty = false;
    applyDashboardPayload(payload, false, true);
    state.dailyDetailRows = [];
    state.dailyDetailsError = null;
    state.hasLoadedDailyDetails = false;
    state.monthlyDetailRows = [];
    state.monthlyDetailsError = null;
    state.hasLoadedMonthlyDetails = false;
    state.modelPricingNotice = { tone: "good", text: t(state.locale, "pricingSaved") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.modelPricingNotice = {
      tone: "bad",
      text: translateErrorMessage(state.locale, message)
    };
  } finally {
    state.isUpdatingModelPricing = false;
    render();
  }
}

async function saveDatabasePathOverride(): Promise<void> {
  if (state.isLoading || state.isSyncing || state.isUpdatingDatabasePath) {
    return;
  }

  const databasePath = state.databasePathDraft.trim();
  if (!databasePath) {
    state.databasePathNotice = {
      tone: "bad",
      text: translateErrorMessage(state.locale, "database path cannot be empty")
    };
    render();
    return;
  }

  state.isUpdatingDatabasePath = true;
  state.databasePathNotice = null;
  render();

  try {
    applyDashboardPayload(await updateDatabasePath(databasePath), true, true);
    state.dailyDetailRows = [];
    state.dailyDetailsError = null;
    state.hasLoadedDailyDetails = false;
    state.monthlyDetailRows = [];
    state.monthlyDetailsError = null;
    state.hasLoadedMonthlyDetails = false;
    state.databasePathNotice = {
      tone: "good",
      text: t(state.locale, "sqlitePathSaved")
    };
    void loadSyncPreview(syncGeneration);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.databasePathNotice = {
      tone: "bad",
      text: translateErrorMessage(state.locale, message)
    };
  } finally {
    state.isUpdatingDatabasePath = false;
    render();
  }
}

async function resetDatabasePathOverride(): Promise<void> {
  if (state.isLoading || state.isSyncing || state.isUpdatingDatabasePath) {
    return;
  }

  state.isUpdatingDatabasePath = true;
  state.databasePathNotice = null;
  render();

  try {
    applyDashboardPayload(await resetDatabasePath(), true, true);
    state.dailyDetailRows = [];
    state.dailyDetailsError = null;
    state.hasLoadedDailyDetails = false;
    state.monthlyDetailRows = [];
    state.monthlyDetailsError = null;
    state.hasLoadedMonthlyDetails = false;
    state.databasePathNotice = {
      tone: "good",
      text: t(state.locale, "sqlitePathReset")
    };
    void loadSyncPreview(syncGeneration);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.databasePathNotice = {
      tone: "bad",
      text: translateErrorMessage(state.locale, message)
    };
  } finally {
    state.isUpdatingDatabasePath = false;
    render();
  }
}

async function loadDailyDetails(): Promise<void> {
  const validationError = validateDailyDetailRange(state);
  if (validationError) {
    state.dailyDetailsError = validationError;
    render();
    return;
  }

  state.isLoadingDailyDetails = true;
  state.dailyDetailsError = null;
  render();

  try {
    state.dailyDetailRows = await queryDailyUsage(state.dailyDetailStartDate, state.dailyDetailEndDate);
    state.dailyDetailPage = 1;
    state.hasLoadedDailyDetails = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.dailyDetailsError = translateErrorMessage(state.locale, message);
  } finally {
    state.isLoadingDailyDetails = false;
    render();
  }
}

async function openSourceRepositoryInBrowser(): Promise<void> {
  try {
    await openSourceRepository();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.errorMessage = translateErrorMessage(state.locale, message);
    render();
  }
}

async function ensureCurrentAppVersion(): Promise<void> {
  if (state.currentAppVersion) {
    return;
  }

  try {
    state.currentAppVersion = await fetchCurrentAppVersion();
    render();
  } catch {}
}

async function checkForAppUpdates(manual: boolean): Promise<void> {
  if (state.updateStatus === "checking" || state.isInstallingUpdate) {
    return;
  }

  state.updateStatus = "checking";
  state.updateErrorMessage = null;
  render();

  try {
    if (!state.currentAppVersion) {
      state.currentAppVersion = await fetchCurrentAppVersion();
    }

    const update = await checkForPendingAppUpdate();
    state.availableUpdate = update;
    state.updateDownloadedBytes = 0;
    state.updateContentLength = null;
    state.updateStatus = update ? "available" : "upToDate";
  } catch (error) {
    if (!manual) {
      state.updateStatus = state.availableUpdate ? "available" : "idle";
      render();
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    state.updateStatus = "error";
    state.updateErrorMessage = decorateUpdateErrorMessage(message, state.locale);
  }

  render();
}

async function installAppUpdate(): Promise<void> {
  if (!state.availableUpdate || state.isInstallingUpdate || state.updateStatus === "checking") {
    return;
  }

  state.isInstallingUpdate = true;
  state.updateStatus = "installing";
  state.updateErrorMessage = null;
  state.updateDownloadedBytes = 0;
  state.updateContentLength = null;
  render();

  try {
    await installPendingAppUpdate(state.availableUpdate, (event) => {
      if (event.kind === "started") {
        state.updateContentLength = event.contentLength;
      } else if (event.kind === "progress") {
        state.updateDownloadedBytes += event.chunkLength;
      }

      render();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.isInstallingUpdate = false;
    state.updateStatus = "error";
    state.updateErrorMessage = decorateUpdateErrorMessage(message, state.locale);
    render();
  }
}

async function loadMonthlyDetails(nextMonth = state.monthlyDetailMonth): Promise<void> {
  if (!state.monthlyDetailYear || nextMonth === null) {
    state.monthlyDetailsError = t(state.locale, "readyToQueryMonthlyDetailDescription");
    render();
    return;
  }

  state.monthlyDetailMonth = nextMonth;
  state.isLoadingMonthlyDetails = true;
  state.monthlyDetailsError = null;
  render();

  try {
    const { startDate, endDate } = dateRangeForMonth(state.monthlyDetailYear, nextMonth);
    state.monthlyDetailRows = await queryDailyUsage(startDate, endDate);
    state.hasLoadedMonthlyDetails = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.monthlyDetailsError = translateErrorMessage(state.locale, message);
  } finally {
    state.isLoadingMonthlyDetails = false;
    render();
  }
}

async function runScheduledAutoSync(): Promise<void> {
  autoSyncTimeoutId = null;
  const intervalMs = autoSyncIntervalForMode(state.autoSyncMode);

  if (intervalMs === null) {
    clearAutoSyncSchedule();
    render();
    return;
  }

  if (state.isLoading || state.isSyncing) {
    scheduleNextAutoSync(intervalMs);
    return;
  }

  await syncDashboard();
}

async function monitorSyncCompletion(): Promise<void> {
  syncStatusPollTimeoutId = null;

  try {
    const syncRunning = await isSyncRunning();
    if (syncRunning) {
      state.syncProgress = (await fetchCurrentSyncProgress()) ?? state.syncProgress;
      patchVisibleSyncProgress();
      scheduleSyncStatusPoll();
      return;
    }

    state.isSyncing = false;
    state.syncProgress = null;
    await loadDashboard();

    if (!state.isSyncing && state.hasLoadedDailyDetails) {
      await loadDailyDetails();
    }

    if (!state.isSyncing) {
      rescheduleAutoSyncIfNeeded();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.errorMessage = translateErrorMessage(state.locale, message);
    render();

    if (state.isSyncing) {
      scheduleSyncStatusPoll(SYNC_STATUS_POLL_INTERVAL_MS * 2);
    }
  }
}

async function syncDashboard(): Promise<void> {
  if (state.isLoading || state.isSyncing) {
    return;
  }

  syncGeneration += 1;
  const previousStatus = state.dashboard ? { ...state.dashboard.status } : null;
  clearAutoSyncSchedule();
  clearSyncStatusPoll();
  state.errorMessage = null;
  markSyncStartedLocally();
  render();

  try {
    const started = await startSync();
    if (!started) {
      state.isSyncing = true;
      state.syncProgress = (await fetchCurrentSyncProgress()) ?? state.syncProgress;
    }
    scheduleSyncStatusPoll();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.errorMessage = translateErrorMessage(state.locale, message);
    state.isSyncing = false;
    state.syncProgress = null;
    if (previousStatus && state.dashboard) {
      state.dashboard.status = previousStatus;
    }
  } finally {
    if (!state.isSyncing) {
      rescheduleAutoSyncIfNeeded();
    }

    render();
  }
}

async function loadDashboard(): Promise<void> {
  const requestId = ++latestDashboardRequestId;
  const requestSyncGeneration = syncGeneration;
  let shouldRefreshSyncPreview = false;
  state.isLoading = true;
  state.errorMessage = null;
  render();

  try {
    const payload = await fetchDashboard();
    if (requestId !== latestDashboardRequestId) {
      return;
    }
    if (requestSyncGeneration !== syncGeneration && state.isSyncing) {
      return;
    }

    applyDashboardPayload(payload);
    if (state.dashboard?.status.state === "failed" && state.dashboard.status.errorMessage) {
      state.errorMessage = translateErrorMessage(state.locale, state.dashboard.status.errorMessage);
    }
    if (state.isSyncing) {
      state.syncProgress = await fetchCurrentSyncProgress();
      scheduleSyncStatusPoll();
    } else {
      clearSyncStatusPoll();
      shouldRefreshSyncPreview = true;
    }
  } catch (error) {
    if (requestId !== latestDashboardRequestId) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    state.errorMessage = translateErrorMessage(state.locale, message);
  } finally {
    if (requestId === latestDashboardRequestId) {
      state.isLoading = false;
      render();

      if (shouldRefreshSyncPreview && requestSyncGeneration === syncGeneration && !state.isSyncing) {
        void loadSyncPreview(requestSyncGeneration);
      }
    }
  }
}

async function loadSyncPreview(expectedSyncGeneration = syncGeneration): Promise<void> {
  const requestId = ++latestSyncPreviewRequestId;

  try {
    const preview = await fetchSyncPreview();
    if (requestId !== latestSyncPreviewRequestId || expectedSyncGeneration !== syncGeneration || state.isSyncing) {
      return;
    }

    if (sameSyncPreview(state.syncPreview, preview)) {
      return;
    }

    state.syncPreview = preview;
    render();

    if (
      !state.hasAttemptedInitialSync &&
      !state.isSyncing &&
      !state.isLoading &&
      state.dashboard?.status.lastSyncedAt === null &&
      preview.needsSync &&
      preview.totalSessionFiles > 0
    ) {
      state.hasAttemptedInitialSync = true;
      void syncDashboard();
    }
  } catch {}
}

async function initializeSyncProgressListener(): Promise<void> {
  if (hasInitializedSyncProgressListener) {
    return;
  }

  hasInitializedSyncProgressListener = true;

  try {
    await listen<SyncProgressDTO>(SYNC_PROGRESS_EVENT_NAME, (event) => {
      state.syncProgress = event.payload;

      if (event.payload.phase === "failed" && event.payload.errorMessage) {
        state.errorMessage = translateErrorMessage(state.locale, event.payload.errorMessage);
      }

      if (event.payload.phase === "complete" || event.payload.phase === "failed") {
        render();
      } else {
        patchVisibleSyncProgress();
      }

      if (event.payload.phase === "complete" || event.payload.phase === "failed") {
        scheduleSyncStatusPoll(120);
      }
    });
  } catch {
    hasInitializedSyncProgressListener = false;
  }
}

function handleRootClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const pageSourceCopyButton = target.closest("[data-page-source-copy]");
  if (pageSourceCopyButton instanceof HTMLButtonElement) {
    const pageSourceId = pageSourceCopyButton.dataset.pageSourceCopy as PageSourceId | undefined;
    if (pageSourceId) {
      void copyPageSourceId(pageSourceId);
    }
    return;
  }

  const syncButton = target.closest("[data-sync]");
  if (syncButton instanceof HTMLButtonElement) {
    if (syncButton.disabled || state.isLoading || state.isSyncing) {
      return;
    }
    void syncDashboard();
    return;
  }

  const resetDatabasePathButton = target.closest("[data-database-path-reset]");
  if (resetDatabasePathButton instanceof HTMLButtonElement) {
    void resetDatabasePathOverride();
    return;
  }

  const resetPricingButton = target.closest("[data-pricing-reset]");
  if (resetPricingButton instanceof HTMLButtonElement) {
    resetModelPricingPresetDraft();
    return;
  }

  const checkUpdatesButton = target.closest("[data-check-updates]");
  if (checkUpdatesButton instanceof HTMLButtonElement) {
    void checkForAppUpdates(true);
    return;
  }

  const installUpdateButton = target.closest("[data-install-update]");
  if (installUpdateButton instanceof HTMLButtonElement) {
    void installAppUpdate();
    return;
  }

  const sourceRepositoryLink = target.closest("[data-open-source-repository]");
  if (sourceRepositoryLink instanceof HTMLAnchorElement) {
    event.preventDefault();
    void openSourceRepositoryInBrowser();
    return;
  }

  const dailyPageButton = target.closest("[data-daily-detail-page]");
  if (dailyPageButton instanceof HTMLButtonElement) {
    const nextPage = Number.parseInt(dailyPageButton.dataset.dailyDetailPage ?? "", 10);
    if (!Number.isNaN(nextPage) && nextPage !== state.dailyDetailPage) {
      state.dailyDetailPage = Math.min(Math.max(nextPage, 1), Math.max(Math.ceil(state.dailyDetailRows.length / DAILY_DETAIL_PAGE_SIZE), 1));
      render();
    }
    return;
  }

  const monthlyDetailMonthButton = target.closest("[data-monthly-detail-month]");
  if (monthlyDetailMonthButton instanceof HTMLButtonElement) {
    const month = Number.parseInt(monthlyDetailMonthButton.dataset.monthlyDetailMonth ?? "", 10);
    if (!Number.isNaN(month)) {
      void loadMonthlyDetails(month);
    }
    return;
  }

  const themeModeButton = target.closest("[data-theme-mode]");
  if (themeModeButton instanceof HTMLButtonElement) {
    const themeMode = themeModeButton.dataset.themeMode;
    if (themeMode === "dark" || themeMode === "light" || themeMode === "system") {
      setThemeMode(themeMode);
    }
    return;
  }

  const tabButton = target.closest("[data-tab-trigger]");
  if (tabButton instanceof HTMLButtonElement) {
    handleTabChange(tabButton.dataset.tabTrigger ?? "");
  }
}

function handleRootChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const autoSyncModeSelect = target.closest("[data-auto-sync-mode]");
  if (autoSyncModeSelect instanceof HTMLSelectElement) {
    handleAutoSyncModeChange(autoSyncModeSelect.value);
    return;
  }

  const localeSelect = target.closest("[data-locale-select]");
  if (localeSelect instanceof HTMLSelectElement) {
    if (isLocale(localeSelect.value)) {
      setLocale(localeSelect.value);
    }
    return;
  }

  const pageSourceVisibilityInput = target.closest("[data-page-source-visible]");
  if (pageSourceVisibilityInput instanceof HTMLInputElement) {
    setPageSourceVisibility(pageSourceVisibilityInput.checked);
    return;
  }

  const databasePathInput = target.closest("[data-database-path-input]");
  if (databasePathInput instanceof HTMLInputElement) {
    state.databasePathDraft = databasePathInput.value;
    state.databasePathDraftDirty = true;
    state.databasePathNotice = null;
    return;
  }

  const pricingEnabledInput = target.closest("[data-pricing-enabled]");
  if (pricingEnabledInput instanceof HTMLInputElement) {
    const draft = state.modelPricingDraft.find(
      (candidate) => candidate.model === pricingEnabledInput.dataset.pricingModel
    );
    if (draft) {
      draft.enabled = pricingEnabledInput.checked;
      state.modelPricingDraftDirty = true;
      state.modelPricingNotice = null;
      render();
    }
    return;
  }

  const pricingRateInput = target.closest("[data-pricing-rate]");
  if (pricingRateInput instanceof HTMLInputElement) {
    const field = pricingRateInput.dataset.pricingRate;
    const model = pricingRateInput.dataset.pricingModel;
    if (model && PRICING_RATE_FIELDS.includes(field as PricingRateField)) {
      const pricingField = field as PricingRateField;
      const draft = state.modelPricingDraft.find((candidate) => candidate.model === model);
      if (draft) {
        draft.rates[pricingField] = pricingRateInput.value;
        state.modelPricingDraftDirty = true;
        state.modelPricingNotice = null;
        const errorKey = pricingErrorKey(model, pricingField);
        const error = validatePricingRate(pricingRateInput.value);
        if (error) {
          state.modelPricingErrors[errorKey] = error;
        } else {
          delete state.modelPricingErrors[errorKey];
        }
        render();
      }
    }
    return;
  }

  const dailyStartInput = target.closest("[data-daily-start]");
  if (dailyStartInput instanceof HTMLInputElement) {
    state.dailyDetailStartDate = dailyStartInput.value;
    state.dailyDetailPage = 1;
    return;
  }

  const dailyEndInput = target.closest("[data-daily-end]");
  if (dailyEndInput instanceof HTMLInputElement) {
    state.dailyDetailEndDate = dailyEndInput.value;
    state.dailyDetailPage = 1;
    return;
  }

  const monthlyDetailYearSelect = target.closest("[data-monthly-detail-year]");
  if (monthlyDetailYearSelect instanceof HTMLSelectElement) {
    state.monthlyDetailYear = monthlyDetailYearSelect.value;

    if (state.activeTab === "monthlyDetail" && state.monthlyDetailMonth !== null && !state.isLoadingMonthlyDetails) {
      void loadMonthlyDetails(state.monthlyDetailMonth);
    } else {
      render();
    }
  }
}

function handleRootSubmit(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const dailyDetailForm = target.closest("[data-daily-detail-form]");
  if (dailyDetailForm instanceof HTMLFormElement) {
    event.preventDefault();
    void loadDailyDetails();
    return;
  }

  const databasePathForm = target.closest("[data-database-path-form]");
  if (databasePathForm instanceof HTMLFormElement) {
    event.preventDefault();
    void saveDatabasePathOverride();
    return;
  }

  const modelPricingForm = target.closest("[data-model-pricing-form]");
  if (modelPricingForm instanceof HTMLFormElement) {
    event.preventDefault();
    void saveModelPricingSettings();
  }
}

function activityWallDayTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const day = target.closest<HTMLElement>("[data-activity-wall-day]");
  return day instanceof HTMLElement ? day : null;
}

function hideActivityTooltip(): void {
  activeActivityTooltipDay = null;

  if (!ui.activityTooltip) {
    return;
  }

  ui.activityTooltip.hidden = true;
  ui.activityTooltip.textContent = "";
  ui.activityTooltip.removeAttribute("data-placement");
  ui.activityTooltip.style.left = "";
  ui.activityTooltip.style.top = "";
}

function positionActivityTooltip(day: HTMLElement): void {
  if (!ui.activityTooltip) {
    return;
  }

  const gap = 10;
  const viewportPadding = 8;
  const dayRect = day.getBoundingClientRect();
  const tooltipRect = ui.activityTooltip.getBoundingClientRect();
  let top = dayRect.top - tooltipRect.height - gap;
  let placement = "top";

  if (top < viewportPadding) {
    top = dayRect.bottom + gap;
    placement = "bottom";
  }

  let left = dayRect.left + dayRect.width / 2 - tooltipRect.width / 2;
  left = Math.min(Math.max(left, viewportPadding), window.innerWidth - tooltipRect.width - viewportPadding);

  ui.activityTooltip.dataset.placement = placement;
  ui.activityTooltip.style.left = `${left}px`;
  ui.activityTooltip.style.top = `${top}px`;
}

function showActivityTooltip(day: HTMLElement): void {
  if (!ui.activityTooltip) {
    return;
  }

  const tooltipText = day.dataset.activityTooltip ?? "";
  if (!tooltipText) {
    hideActivityTooltip();
    return;
  }

  activeActivityTooltipDay = day;
  ui.activityTooltip.textContent = tooltipText;
  ui.activityTooltip.hidden = false;
  positionActivityTooltip(day);
}

function handleRootMouseOver(event: Event): void {
  const day = activityWallDayTarget(event.target);
  if (!day) {
    return;
  }

  const relatedDay = activityWallDayTarget((event as MouseEvent).relatedTarget);
  if (day === relatedDay) {
    return;
  }

  showActivityTooltip(day);
}

function handleRootMouseOut(event: Event): void {
  const day = activityWallDayTarget(event.target);
  if (!day) {
    return;
  }

  const relatedDay = activityWallDayTarget((event as MouseEvent).relatedTarget);
  if (day === relatedDay) {
    return;
  }

  if (activeActivityTooltipDay === day) {
    hideActivityTooltip();
  }
}

function handleRootFocusIn(event: Event): void {
  const day = activityWallDayTarget(event.target);
  if (day) {
    showActivityTooltip(day);
  }
}

function handleRootFocusOut(event: Event): void {
  const day = activityWallDayTarget(event.target);
  if (!day) {
    return;
  }

  const relatedDay = activityWallDayTarget((event as FocusEvent).relatedTarget);
  if (day === relatedDay) {
    return;
  }

  if (activeActivityTooltipDay === day) {
    hideActivityTooltip();
  }
}

function handleRootScroll(): void {
  hideActivityTooltip();
}

function handleWindowResize(): void {
  if (activeActivityTooltipDay) {
    positionActivityTooltip(activeActivityTooltipDay);
  }
}

function initializeSettingsSectionObserver(): void {
  settingsSectionObserver?.disconnect();
  settingsSectionObserver = null;

  if (state.activeTab !== "settings") {
    return;
  }

  const sections = [...appRoot.querySelectorAll<HTMLElement>("[data-settings-section]")];
  const navItems = [...appRoot.querySelectorAll<HTMLAnchorElement>("[data-settings-nav]")];
  const setActiveSection = (id: string): void => {
    navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.settingsNav === id));
  };

  settingsSectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0];
      if (visible) {
        const section = visible.target as HTMLElement;
        setActiveSection(section.dataset.settingsSection ?? "general");
      }
    },
    { rootMargin: "-12% 0px -68% 0px", threshold: 0 }
  );

  sections.forEach((section) => settingsSectionObserver?.observe(section));
}

function initializeShell(): void {
  if (hasInitializedShell) {
    return;
  }

  appRoot.innerHTML = `
    <a class="skip-link" href="#dashboard-main" data-skip-link>${t(state.locale, "skipToMainContent")}</a>
    <main class="app-shell" id="dashboard-main">
      <div class="sr-only" aria-live="polite" data-live-region></div>
      <section class="dashboard-layout">
        <div data-sidebar-slot></div>
        <div class="dashboard-content" data-content-slot></div>
      </section>
    </main>
    <div class="activity-hover-tooltip" hidden data-activity-hover-tooltip></div>
  `;

  ui.liveRegion = appRoot.querySelector<HTMLDivElement>("[data-live-region]");
  ui.skipLink = appRoot.querySelector<HTMLAnchorElement>("[data-skip-link]");
  ui.sidebar = appRoot.querySelector<HTMLElement>("[data-sidebar-slot]");
  ui.content = appRoot.querySelector<HTMLDivElement>("[data-content-slot]");
  ui.activityTooltip = appRoot.querySelector<HTMLDivElement>("[data-activity-hover-tooltip]");

  if (!ui.liveRegion || !ui.skipLink || !ui.sidebar || !ui.content || !ui.activityTooltip) {
    throw new Error("Failed to initialize app shell");
  }

  appRoot.addEventListener("click", handleRootClick);
  appRoot.addEventListener("change", handleRootChange);
  appRoot.addEventListener("submit", handleRootSubmit);
  appRoot.addEventListener("mouseover", handleRootMouseOver);
  appRoot.addEventListener("mouseout", handleRootMouseOut);
  appRoot.addEventListener("focusin", handleRootFocusIn);
  appRoot.addEventListener("focusout", handleRootFocusOut);
  appRoot.addEventListener("scroll", handleRootScroll, true);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", handleWindowResize);

  hasInitializedShell = true;
}

function renderLucideIcons(): void {
  createIcons({
    root: appRoot,
    icons: {
      Activity,
      CalendarDays,
      CalendarRange,
      ChartNoAxesCombined,
      Check,
      CircleDollarSign,
      Clock3,
      Copy,
      Database,
      Download,
      ExternalLink,
      FolderOpen,
      Gauge,
      Info,
      Languages,
      LayoutDashboard,
      Monitor,
      Moon,
      Palette,
      RefreshCw,
      RotateCcw,
      Save,
      Search,
      Settings,
      SlidersHorizontal,
      Sun,
      TableProperties
    },
    attrs: {
      width: "18",
      height: "18",
      "stroke-width": "1.8"
    }
  });
}

function render(): void {
  initializeShell();

  const dashboard = state.dashboard;
  const syncPreview = state.syncPreview ?? dashboard?.syncPreview ?? null;
  const syncProgress = state.syncProgress;
  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const syncAvailable = true;
  const autoSyncRemaining = autoSyncRemainingMs();
  const autoSyncOptionsMarkup = AUTO_SYNC_OPTIONS.map(
    (option) =>
      `<option value="${option.value}" ${state.autoSyncMode === option.value ? "selected" : ""}>${autoSyncLabel(option.value)}</option>`
  ).join("");
  const autoSyncCountdownMarkup =
    autoSyncRemaining === null
      ? ""
      : `<div class="sync-countdown ${state.isSyncing ? "is-active" : ""}" data-auto-sync-countdown>${
          state.isSyncing
            ? t(state.locale, "syncingShort")
            : t(state.locale, "countdown", { value: formatCountdown(autoSyncRemaining) })
        }</div>`;
  const summaries = dashboard?.summaries ?? [];
  const summaryCards = summaries.map((summary) => renderSummaryCard(summary, timeZone, state.locale)).join("");
  const notes = [
    ...(dashboard?.meta.pricingNotes ?? []).map((note) => translatePricingNote(state.locale, note)),
    ...(syncPreview && syncPreview.changedSessions > 0
      ? [t(state.locale, "activeSessionNote")]
      : [])
  ]
    .map((note) => `<p class="note-card">${escapeHtml(note)}</p>`)
    .join("");
  const liveRegionText = state.errorMessage
    ? state.errorMessage
    : state.isSyncing
      ? t(state.locale, "syncingShort")
      : state.updateStatus === "available" && state.availableUpdate
        ? t(state.locale, "updateAvailableBanner", { version: state.availableUpdate.version })
        : state.updateStatus === "installing"
          ? t(state.locale, "installingUpdate")
      : state.isLoading
        ? t(state.locale, "loadingDashboard")
        : dashboard
          ? t(state.locale, "currentStatus", { status: statusLabel(dashboard.status.state, state.locale) })
          : t(state.locale, "dashboardNotLoaded");
  const skipLinkText = t(state.locale, "skipToMainContent");
  const sidebarMarkup = renderSidebarNav(state.activeTab, state.locale, state.availableUpdate);
  const contentMarkup = `
    ${renderUpdateBanner(state, timeZone)}
    ${state.errorMessage ? `<section class="banner bad">${escapeHtml(state.errorMessage)}</section>` : ""}
    ${state.isLoading && !dashboard ? `<section class="banner">${t(state.locale, "loadingPage")}</section>` : ""}
    ${
      state.activeTab === "overview"
        ? renderOverviewView(
            state,
            timeZone,
            summaryCards,
            dashboard,
            syncPreview,
            syncProgress,
            syncAvailable,
            autoSyncOptionsMarkup,
            autoSyncCountdownMarkup
          )
        : state.activeTab === "monthlyHistory"
          ? renderMonthlyHistoryView(state, timeZone, dashboard)
          : state.activeTab === "monthlyDetail"
            ? renderMonthlyDetailView(state, timeZone)
          : state.activeTab === "settings"
            ? renderSettingsView(state, timeZone, notes, dashboard)
            : renderDailyDetailView(state, timeZone)
    }
  `;

  if (ui.liveRegion && liveRegionText !== lastLiveRegionText) {
    ui.liveRegion.textContent = liveRegionText;
    lastLiveRegionText = liveRegionText;
  }

  if (ui.skipLink && skipLinkText !== lastSkipLinkText) {
    ui.skipLink.textContent = skipLinkText;
    lastSkipLinkText = skipLinkText;
  }

  if (ui.sidebar && sidebarMarkup !== lastSidebarMarkup) {
    ui.sidebar.innerHTML = sidebarMarkup;
    lastSidebarMarkup = sidebarMarkup;
  }

  if (ui.content && contentMarkup !== lastContentMarkup) {
    ui.content.innerHTML = contentMarkup;
    lastContentMarkup = contentMarkup;
  }

  renderLucideIcons();
  initializeSettingsSectionObserver();
}

applyTheme(state.themeMode, false);
systemThemeQuery.addEventListener("change", () => {
  if (state.themeMode === "system") {
    applyTheme("system", false);
  }
});
render();

try {
  void getCurrentWindow().show();
} catch (error) {
  console.error("Failed to show window:", error);
}

void initializeSyncProgressListener();
void ensureCurrentAppVersion();
if (!import.meta.env.DEV) {
  void checkForAppUpdates(false);
}
void loadDashboard();
