import { listen } from "@tauri-apps/api/event";
import {
  fetchCurrentSyncProgress,
  fetchDashboard,
  fetchSyncPreview,
  isSyncRunning,
  resetDatabasePath,
  queryDailyUsage,
  startSync,
  updateDatabasePath
} from "./api/tauri";
import type {
  DailyUsageSummaryDTO,
  DashboardPayloadDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  SyncPreviewDTO,
  UsageSummaryDTO,
  UsageTotalsDTO
} from "./dto/dashboard";
import {
  detectInitialLocale,
  isLocale,
  persistLocale,
  t,
  translateErrorMessage,
  translatePricingNote,
  type Locale
} from "./i18n";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Missing #root container");
}

const appRoot = root;

const AUTO_SYNC_OPTIONS = [
  { value: "manual", intervalMs: null },
  { value: "10s", intervalMs: 10_000 },
  { value: "30s", intervalMs: 30_000 },
  { value: "1m", intervalMs: 60_000 },
  { value: "5m", intervalMs: 5 * 60_000 },
  { value: "10m", intervalMs: 10 * 60_000 },
  { value: "15m", intervalMs: 15 * 60_000 },
  { value: "30m", intervalMs: 30 * 60_000 }
] as const;
const SYNC_STATUS_POLL_INTERVAL_MS = 1_000;
const SYNC_PROGRESS_EVENT_NAME = "sync-progress";
const DAILY_DETAIL_PAGE_SIZE = 31;
const MAX_DAILY_DETAIL_RANGE_DAYS = 93;

type AutoSyncModeValue = (typeof AUTO_SYNC_OPTIONS)[number]["value"];
type AppTab = "overview" | "monthlyHistory" | "syncInfo" | "dailyDetail";
type InlineNoticeTone = "good" | "bad";

function detectInitialTab(): AppTab {
  if (typeof window === "undefined") {
    return "overview";
  }

  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "overview" || tab === "monthlyHistory" || tab === "syncInfo" || tab === "dailyDetail" ? tab : "overview";
}

const state = {
  dashboard: null as DashboardPayloadDTO | null,
  syncPreview: null as SyncPreviewDTO | null,
  syncProgress: null as SyncProgressDTO | null,
  isLoading: true,
  isSyncing: false,
  isUpdatingDatabasePath: false,
  errorMessage: null as string | null,
  locale: detectInitialLocale(),
  autoSyncMode: "manual" as AutoSyncModeValue,
  nextAutoSyncAt: null as number | null,
  activeTab: detectInitialTab(),
  databasePathDraft: "",
  databasePathDraftDirty: false,
  databasePathNotice: null as { tone: InlineNoticeTone; text: string } | null,
  dailyDetailRows: [] as DailyUsageSummaryDTO[],
  dailyDetailStartDate: "",
  dailyDetailEndDate: "",
  dailyDetailPage: 1,
  isLoadingDailyDetails: false,
  dailyDetailsError: null as string | null,
  hasLoadedDailyDetails: false
};

const numberFormatterCache = new Map<Locale, Intl.NumberFormat>();
const currencyFormatterCache = new Map<Locale, Intl.NumberFormat>();
const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateInputFormatterCache = new Map<string, Intl.DateTimeFormat>();
const ui = {
  liveRegion: null as HTMLDivElement | null,
  skipLink: null as HTMLAnchorElement | null,
  sidebar: null as HTMLElement | null,
  content: null as HTMLDivElement | null
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
const isMacLikePlatform = navigator.platform.toLowerCase().includes("mac");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function localeNumberFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = numberFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatterCache.set(locale, formatter);
  }

  return formatter;
}

function localeCurrencyFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = currencyFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      currencyDisplay: locale === "zh-CN" ? "narrowSymbol" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    currencyFormatterCache.set(locale, formatter);
  }

  return formatter;
}

function formatInteger(value: number): string {
  return localeNumberFormatter(state.locale).format(value);
}

function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    const scaled = value / 1_000_000_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}B`;
  }

  if (absolute >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}K`;
  }

  return formatInteger(value);
}

function renderAlignedTokenCount(value: number): string {
  const formatted = formatTokenCount(value);
  const match = formatted.match(/^(-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)([KMB])?$/);

  if (!match) {
    return `<span class="metric-align"><span class="metric-num">${escapeHtml(formatted)}</span><span class="metric-unit"></span></span>`;
  }

  const [, numberPart, unitPart = ""] = match;
  return `<span class="metric-align"><span class="metric-num">${numberPart}</span><span class="metric-unit">${unitPart}</span></span>`;
}

function nonCachedInputTokens(totals: UsageTotalsDTO): number {
  return Math.max(totals.inputTokens - totals.cachedInputTokens, 0);
}

function formatCurrency(value: number): string {
  return localeCurrencyFormatter(state.locale).format(value);
}

function formatDateLabel(dateKey: string, timeZone: string): string {
  void timeZone;
  const [, month = "01", day = "01"] = dateKey.split("-");
  return state.locale === "en-US" ? `${month}/${day}` : `${month}-${day}`;
}

function formatMonthLabel(monthKey: string, timeZone: string): string {
  void timeZone;
  if (state.locale === "en-US") {
    const [year = "0000", month = "01"] = monthKey.split("-");
    return `${month}/${year}`;
  }

  return monthKey;
}

function formatTimestamp(value: string | null, timeZone: string): string {
  if (!value) {
    return t(state.locale, "notSyncedYet");
  }

  const cacheKey = `${state.locale}:${timeZone}`;
  let formatter = timestampFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(state.locale, {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    timestampFormatterCache.set(cacheKey, formatter);
  }

  return formatter.format(new Date(value));
}

function formatDateInputValue(date: Date, timeZone: string): string {
  let formatter = dateInputFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dateInputFormatterCache.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
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

function dailyDetailPageCount(): number {
  return Math.max(Math.ceil(state.dailyDetailRows.length / DAILY_DETAIL_PAGE_SIZE), 1);
}

function clampDailyDetailPage(page: number): number {
  return Math.min(Math.max(page, 1), dailyDetailPageCount());
}

function currentDailyDetailPageRows(): DailyUsageSummaryDTO[] {
  const page = clampDailyDetailPage(state.dailyDetailPage);
  const startIndex = (page - 1) * DAILY_DETAIL_PAGE_SIZE;
  return state.dailyDetailRows.slice(startIndex, startIndex + DAILY_DETAIL_PAGE_SIZE);
}

function dateRangeDayCount(startDate: string, endDate: string): number {
  const startValue = new Date(`${startDate}T00:00:00Z`).getTime();
  const endValue = new Date(`${endDate}T00:00:00Z`).getTime();
  const dayMs = 24 * 60 * 60 * 1_000;
  return Math.floor((endValue - startValue) / dayMs) + 1;
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

function formatCountdown(valueMs: number): string {
  const totalSeconds = Math.max(Math.ceil(valueMs / 1_000), 0);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
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

function syncingStatusSnapshot(): SyncStatusDTO {
  const currentStatus = state.dashboard?.status;
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

function syncProgressSnapshot(phase: SyncProgressDTO["phase"] = "preparing"): SyncProgressDTO {
  const syncPreview = state.syncPreview ?? state.dashboard?.syncPreview;
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

function markSyncStartedLocally(): void {
  state.isSyncing = true;
  state.syncProgress = syncProgressSnapshot();

  if (state.dashboard) {
    state.dashboard.status = syncingStatusSnapshot();
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

function syncProgressPhaseLabel(phase: SyncProgressDTO["phase"]): string {
  switch (phase) {
    case "preparing":
      return t(state.locale, "syncPhasePreparing");
    case "scanningFiles":
      return t(state.locale, "syncPhaseScanningFiles");
    case "processingFiles":
      return t(state.locale, "syncPhaseProcessingFiles");
    case "finalizing":
      return t(state.locale, "syncPhaseFinalizing");
    case "complete":
      return t(state.locale, "syncPhaseComplete");
    case "failed":
      return t(state.locale, "syncPhaseFailed");
  }
}

function syncProgressPercent(progress: SyncProgressDTO): number | null {
  if (progress.filesToProcess <= 0) {
    if (progress.phase === "complete") {
      return 100;
    }
    return null;
  }

  const ratio = Math.min(progress.processedFiles / progress.filesToProcess, 1);
  return Math.round(ratio * 100);
}

function renderSyncProgressCard(syncProgress: SyncProgressDTO | null): string {
  if (!syncProgress && !state.isSyncing) {
    return "";
  }

  const progress = syncProgress ?? syncProgressSnapshot();
  const progressPercent = syncProgressPercent(progress);
  const filesDiscoveredText =
    progress.totalSessionFiles > 0
      ? t(state.locale, "syncProgressFilesDiscovered", {
          count: formatInteger(progress.totalSessionFiles)
        })
      : t(state.locale, "syncProgressWaiting");
  const processedText =
    progress.filesToProcess > 0
      ? t(state.locale, "syncProgressFilesProcessed", {
          processed: formatInteger(progress.processedFiles),
          total: formatInteger(progress.filesToProcess)
        })
      : filesDiscoveredText;
  const removedText =
    progress.removedSessions > 0
      ? `<span>${t(state.locale, "syncProgressRemovedSessions", {
          count: formatInteger(progress.removedSessions)
        })}</span>`
      : "";
  const meterModifierClass = progressPercent === null ? " sync-progress-meter--indeterminate" : "";
  const fillModifierClass = progressPercent === null ? " sync-progress-meter-fill--indeterminate" : "";
  const fillWidth = progressPercent === null ? 38 : progressPercent;
  const progressValueLabel =
    progressPercent === null ? t(state.locale, "syncingShort") : t(state.locale, "syncProgressPercent", { value: progressPercent });
  const progressBarMarkup = `
    <div class="sync-progress-meter${meterModifierClass}" aria-hidden="true">
      <span class="sync-progress-meter-fill${fillModifierClass}" style="width: ${fillWidth}%;"></span>
    </div>
  `;
  const errorMarkup = progress.errorMessage
    ? `<p class="sync-progress-error">${escapeHtml(translateErrorMessage(state.locale, progress.errorMessage))}</p>`
    : "";

  return `
    <section class="sync-progress-card" aria-live="polite">
      <div class="sync-progress-header">
        <p>${t(state.locale, "syncProgressTitle")}</p>
        <strong>${syncProgressPhaseLabel(progress.phase)}</strong>
      </div>
      ${progressBarMarkup}
      <div class="sync-progress-summary">
        <span>${progressValueLabel}</span>
      </div>
      <div class="sync-progress-meta">
        <span>${filesDiscoveredText}</span>
        <span>${processedText}</span>
        <span>${t(state.locale, "sessionDeltaSummary", {
          newCount: formatInteger(progress.newSessions),
          changedCount: formatInteger(progress.changedSessions),
          removedCount: formatInteger(progress.removedSessions)
        })}</span>
        ${removedText}
      </div>
      ${errorMarkup}
    </section>
  `;
}

function patchVisibleSyncProgress(): void {
  if (state.activeTab !== "overview") {
    return;
  }

  const syncProgressSlot = appRoot.querySelector<HTMLElement>("[data-sync-progress-slot]");
  if (!syncProgressSlot) {
    return;
  }

  const markup = renderSyncProgressCard(state.syncProgress);
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

function syncDatabasePathDraft(nextPath: string, force = false): void {
  if (!force && state.databasePathDraftDirty) {
    return;
  }

  state.databasePathDraft = nextPath;
  state.databasePathDraftDirty = false;
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
  syncDatabasePathDraft(payload.meta.databasePath, forceDatabasePathDraft);
}

function databasePathSourceLabel(source: DashboardPayloadDTO["meta"]["databasePathSource"]): string {
  switch (source) {
    case "env":
      return t(state.locale, "databasePathSourceEnv");
    case "config":
      return t(state.locale, "databasePathSourceConfig");
    case "default":
      return t(state.locale, "databasePathSourceDefault");
  }
}

function handleTabChange(nextTab: string): void {
  if (nextTab !== "overview" && nextTab !== "monthlyHistory" && nextTab !== "syncInfo" && nextTab !== "dailyDetail") {
    return;
  }

  if (nextTab === "dailyDetail") {
    const timeZone = state.dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const nowValue = state.dashboard?.now ?? new Date().toISOString();
    initializeDailyDetailRange(timeZone, nowValue);
  }

  state.activeTab = nextTab;
  render();

  if (nextTab === "dailyDetail" && !state.hasLoadedDailyDetails && !state.isLoadingDailyDetails) {
    void loadDailyDetails();
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
      nextTab = "dailyDetail";
      break;
    case "3":
      nextTab = "monthlyHistory";
      break;
    case "4":
      nextTab = "syncInfo";
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

function formatModelLabel(model: string, isFallback: boolean): string {
  return `${model}${isFallback ? t(state.locale, "fallbackSuffix") : ""}`;
}

function sumTotals(rows: Array<{ totals: UsageTotalsDTO }>): UsageTotalsDTO {
  return rows.reduce<UsageTotalsDTO>(
    (totals, row) => ({
      inputTokens: totals.inputTokens + row.totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + row.totals.cachedInputTokens,
      outputTokens: totals.outputTokens + row.totals.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens + row.totals.reasoningOutputTokens,
      totalTokens: totals.totalTokens + row.totals.totalTokens,
      costUSD: totals.costUSD + row.totals.costUSD
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      costUSD: 0
    }
  );
}

function periodLabel(period: UsageSummaryDTO["period"]): string {
  switch (period) {
    case "today":
      return t(state.locale, "periodToday");
    case "last7Days":
      return t(state.locale, "periodLast7Days");
    case "monthToDate":
      return t(state.locale, "periodMonthToDate");
  }
}

function statusLabel(value: DashboardPayloadDTO["status"]["state"]): string {
  switch (value) {
    case "idle":
      return t(state.locale, "statusIdle");
    case "syncing":
      return t(state.locale, "statusSyncing");
    case "success":
      return t(state.locale, "statusSuccess");
    case "failed":
      return t(state.locale, "statusFailed");
  }
}

function statusTone(value: DashboardPayloadDTO["status"]["state"]): string {
  switch (value) {
    case "success":
      return "good";
    case "failed":
      return "bad";
    case "syncing":
      return "warm";
    case "idle":
      return "neutral";
  }
}

function renderSummaryCard(summary: UsageSummaryDTO, timeZone: string): string {
  void timeZone;
  return `
    <article class="summary-card panel">
      <p class="summary-kicker">${periodLabel(summary.period)}</p>
      <div class="summary-total">
        <span>${t(state.locale, "summaryTotal")}</span>
        <strong>${formatTokenCount(summary.totals.totalTokens)}</strong>
      </div>
      <div class="summary-inline">
        <span>${t(state.locale, "input")}: ${formatTokenCount(nonCachedInputTokens(summary.totals))}</span>
        <span>${t(state.locale, "output")}: ${formatTokenCount(summary.totals.outputTokens)}</span>
        <span>${t(state.locale, "cachedInput")}: ${formatTokenCount(summary.totals.cachedInputTokens)}</span>
        <span>${t(state.locale, "reasoning")}: ${formatTokenCount(summary.totals.reasoningOutputTokens)}</span>
        <span class="summary-cost-inline">${t(state.locale, "cost")}: ${formatCurrency(summary.totals.costUSD)}</span>
      </div>
    </article>
  `;
}

function renderUsageTable(
  title: string,
  rows: DashboardPayloadDTO["dailyHistory"] | DashboardPayloadDTO["monthlyHistory"] | DailyUsageSummaryDTO[],
  timeZone: string,
  mode: "daily" | "monthly"
): string {
  const totals = sumTotals(rows);
  const isDaily = mode === "daily";
  const body = rows
    .map((row) => {
      const label = isDaily
        ? formatDateLabel((row as DailyUsageSummaryDTO).dateKey, timeZone)
        : formatMonthLabel((row as DashboardPayloadDTO["monthlyHistory"][number]).monthKey, timeZone);
      const models =
        row.models.length > 0
          ? `<ul class="model-list">${row.models
              .map(
                (model) =>
                  `<li>${escapeHtml(formatModelLabel(model.model, model.isFallback))}</li>`
              )
              .join("")}</ul>`
          : `<span class="muted">${t(state.locale, "noData")}</span>`;

      return `
        <tr>
          <td class="label-cell">${label}</td>
          <td>${models}</td>
          <td>${formatTokenCount(nonCachedInputTokens(row.totals))}</td>
          <td>${formatTokenCount(row.totals.outputTokens)}</td>
          <td>${formatTokenCount(row.totals.reasoningOutputTokens)}</td>
          <td>${formatTokenCount(row.totals.cachedInputTokens)}</td>
          <td>${formatTokenCount(row.totals.totalTokens)}</td>
          <td class="cost-cell">${formatCurrency(row.totals.costUSD)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="table-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${isDaily ? t(state.locale, "dailySummaryEyebrow") : t(state.locale, "historySummaryEyebrow")}</p>
          <h3>${title}</h3>
        </div>
      </div>
      <div class="table-scroll">
        <table class="usage-table">
          <thead>
            <tr>
              <th>${isDaily ? t(state.locale, "date") : t(state.locale, "month")}</th>
              <th>${t(state.locale, "model")}</th>
              <th>${t(state.locale, "input")}</th>
              <th>${t(state.locale, "output")}</th>
              <th>${t(state.locale, "reasoning")}</th>
              <th>${t(state.locale, "cachedInput")}</th>
              <th>${t(state.locale, "total")}</th>
              <th>${t(state.locale, "cost")}</th>
            </tr>
          </thead>
          <tbody>
            ${body}
            <tr class="total-row">
              <td>${t(state.locale, "totalLabel")}</td>
              <td></td>
              <td>${formatTokenCount(nonCachedInputTokens(totals))}</td>
              <td>${formatTokenCount(totals.outputTokens)}</td>
              <td>${formatTokenCount(totals.reasoningOutputTokens)}</td>
              <td>${formatTokenCount(totals.cachedInputTokens)}</td>
              <td>${formatTokenCount(totals.totalTokens)}</td>
              <td class="cost-cell">${formatCurrency(totals.costUSD)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDailyDetailTable(title: string, rows: DailyUsageSummaryDTO[], timeZone: string): string {
  const totals = sumTotals(rows);
  const flatRows = rows.flatMap((row) => {
    const dateLabel = formatDateLabel(row.dateKey, timeZone);
    const models =
      row.models.length > 0
        ? row.models.map((model, index) => ({
            dateLabel,
            rowSpan: row.models.length,
            showGroupCell: index === 0,
            modelLabel: formatModelLabel(model.model, model.isFallback),
            totals: model.totals,
            dailyCost: row.totals.costUSD
          }))
        : [
            {
              dateLabel,
              rowSpan: 1,
              showGroupCell: true,
              modelLabel: t(state.locale, "noData"),
              totals: {
                inputTokens: 0,
                cachedInputTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0,
                costUSD: 0
              },
              dailyCost: 0
            }
          ];

    return models;
  });

  const body = flatRows
    .map(
      (row) => `
        <tr class="${row.showGroupCell ? "daily-detail-group-start" : ""}">
          ${
            row.showGroupCell
              ? `<td class="label-cell daily-detail-date" rowspan="${row.rowSpan}">${escapeHtml(row.dateLabel)}</td>`
              : ""
          }
          <td class="daily-detail-model">${escapeHtml(row.modelLabel)}</td>
          <td>${renderAlignedTokenCount(nonCachedInputTokens(row.totals))}</td>
          <td>${renderAlignedTokenCount(row.totals.outputTokens)}</td>
          <td>${renderAlignedTokenCount(row.totals.cachedInputTokens)}</td>
          <td>${renderAlignedTokenCount(row.totals.reasoningOutputTokens)}</td>
          <td class="daily-detail-total-metric">${renderAlignedTokenCount(row.totals.totalTokens)}</td>
          <td class="daily-detail-model-cost-cell">${formatCurrency(row.totals.costUSD)}</td>
          ${
            row.showGroupCell
              ? `<td class="cost-cell daily-detail-total-cost-cell" rowspan="${row.rowSpan}">${formatCurrency(row.dailyCost)}</td>`
              : ""
          }
        </tr>
      `
    )
    .join("");

  return `
    <section class="table-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${t(state.locale, "dailyUsageTitle")}</p>
          <h3>${title}</h3>
        </div>
      </div>
      <div class="table-scroll">
        <table class="usage-table daily-detail-table">
          <colgroup>
            <col class="daily-detail-col-date" />
            <col class="daily-detail-col-model" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-model-cost" />
            <col class="daily-detail-col-total-cost" />
          </colgroup>
          <thead>
            <tr>
              <th>${t(state.locale, "date")}</th>
              <th>${t(state.locale, "model")}</th>
              <th>${t(state.locale, "input")}</th>
              <th>${t(state.locale, "output")}</th>
              <th>${t(state.locale, "cachedInput")}</th>
              <th>${t(state.locale, "reasoning")}</th>
              <th>${t(state.locale, "total")}</th>
              <th class="daily-detail-model-cost-header">${t(state.locale, "modelCost")}</th>
              <th class="daily-detail-total-cost-header">${t(state.locale, "totalCost")}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr class="summary-row">
              <td colspan="2">${t(state.locale, "totalLabel")}</td>
              <td>${renderAlignedTokenCount(nonCachedInputTokens(totals))}</td>
              <td>${renderAlignedTokenCount(totals.outputTokens)}</td>
              <td>${renderAlignedTokenCount(totals.cachedInputTokens)}</td>
              <td>${renderAlignedTokenCount(totals.reasoningOutputTokens)}</td>
              <td class="daily-detail-total-metric">${renderAlignedTokenCount(totals.totalTokens)}</td>
              <td class="daily-detail-model-cost-cell">${formatCurrency(totals.costUSD)}</td>
              <td class="cost-cell daily-detail-summary-total-cost">${formatCurrency(totals.costUSD)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function renderDailyDetailPagination(): string {
  const totalPages = dailyDetailPageCount();
  if (totalPages <= 1) {
    return "";
  }

  const currentPage = clampDailyDetailPage(state.dailyDetailPage);
  const startDay = (currentPage - 1) * DAILY_DETAIL_PAGE_SIZE + 1;
  const endDay = Math.min(currentPage * DAILY_DETAIL_PAGE_SIZE, state.dailyDetailRows.length);

  return `
    <div class="detail-pagination" aria-label="${t(state.locale, "dailyUsagePaginationAria")}">
      <p class="detail-pagination-summary">
        ${t(state.locale, "dailyUsagePageSummary", {
          start: formatInteger(startDay),
          end: formatInteger(endDay),
          total: formatInteger(state.dailyDetailRows.length)
        })}
      </p>
      <div class="detail-pagination-actions">
        <button
          class="action detail-pagination-button"
          type="button"
          data-daily-detail-page="${currentPage - 1}"
          ${currentPage <= 1 ? "disabled" : ""}
        >
          ${t(state.locale, "previousPage")}
        </button>
        <span class="detail-pagination-indicator">
          ${t(state.locale, "pageIndicator", {
            current: formatInteger(currentPage),
            total: formatInteger(totalPages)
          })}
        </span>
        <button
          class="action detail-pagination-button"
          type="button"
          data-daily-detail-page="${currentPage + 1}"
          ${currentPage >= totalPages ? "disabled" : ""}
        >
          ${t(state.locale, "nextPage")}
        </button>
      </div>
    </div>
  `;
}

function renderEmptyState(title: string, description: string): string {
  return `
    <section class="empty-panel panel">
      <p class="eyebrow">${t(state.locale, "emptyStateEyebrow")}</p>
      <h3>${title}</h3>
      <p class="empty-copy">${description}</p>
    </section>
  `;
}

function renderSidebarNav(): string {
  const tabs: Array<{ value: AppTab; label: string; markerClass: string }> = [
    { value: "overview", label: t(state.locale, "navOverview"), markerClass: "menu-item-mark--overview" },
    { value: "dailyDetail", label: t(state.locale, "navDailyDetail"), markerClass: "menu-item-mark--daily-detail" },
    { value: "monthlyHistory", label: t(state.locale, "navMonthlyHistory"), markerClass: "menu-item-mark--monthly-history" },
    { value: "syncInfo", label: t(state.locale, "navSyncInfo"), markerClass: "menu-item-mark--sync-info" }
  ];

  return `
    <aside class="sidebar">
      <nav class="menu-shell panel" aria-label="${t(state.locale, "dashboardViewsAria")}">
        <div class="menu-locale">
          <label class="menu-locale-field" for="locale-select">
            <span class="menu-locale-label">${t(state.locale, "language")}</span>
            <select
              id="locale-select"
              class="menu-locale-select"
              data-locale-select
              aria-label="${t(state.locale, "languageSwitcherAria")}"
            >
              <option value="zh-CN" ${state.locale === "zh-CN" ? "selected" : ""}>${t(state.locale, "languageChinese")}</option>
              <option value="en-US" ${state.locale === "en-US" ? "selected" : ""}>${t(state.locale, "languageEnglish")}</option>
            </select>
          </label>
        </div>
        ${tabs
          .map(
            (tab) => `
              <button
                class="menu-item ${state.activeTab === tab.value ? "is-active" : ""}"
                type="button"
                aria-pressed="${state.activeTab === tab.value}"
                data-tab-trigger="${tab.value}"
              >
                <span class="menu-item-mark ${tab.markerClass}" aria-hidden="true"></span>
                <span class="menu-item-label">${tab.label}</span>
              </button>
            `
          )
          .join("")}
      </nav>
    </aside>
  `;
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
  `;

  ui.liveRegion = appRoot.querySelector<HTMLDivElement>("[data-live-region]");
  ui.skipLink = appRoot.querySelector<HTMLAnchorElement>("[data-skip-link]");
  ui.sidebar = appRoot.querySelector<HTMLElement>("[data-sidebar-slot]");
  ui.content = appRoot.querySelector<HTMLDivElement>("[data-content-slot]");

  if (!ui.liveRegion || !ui.skipLink || !ui.sidebar || !ui.content) {
    throw new Error("Failed to initialize app shell");
  }

  appRoot.addEventListener("click", handleRootClick);
  appRoot.addEventListener("change", handleRootChange);
  appRoot.addEventListener("submit", handleRootSubmit);
  window.addEventListener("keydown", handleGlobalKeydown);

  hasInitializedShell = true;
}

function handleRootClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
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

  const dailyPageButton = target.closest("[data-daily-detail-page]");
  if (dailyPageButton instanceof HTMLButtonElement) {
    const nextPage = Number.parseInt(dailyPageButton.dataset.dailyDetailPage ?? "", 10);
    if (!Number.isNaN(nextPage) && nextPage !== state.dailyDetailPage) {
      state.dailyDetailPage = clampDailyDetailPage(nextPage);
      render();
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

  const databasePathInput = target.closest("[data-database-path-input]");
  if (databasePathInput instanceof HTMLInputElement) {
    state.databasePathDraft = databasePathInput.value;
    state.databasePathDraftDirty = true;
    state.databasePathNotice = null;
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
  }
}

function renderHeroSection(
  dashboard: DashboardPayloadDTO | null,
  syncPreview: DashboardPayloadDTO["syncPreview"] | null,
  syncProgress: SyncProgressDTO | null,
  timeZone: string,
  syncAvailable: boolean,
  autoSyncOptionsMarkup: string,
  autoSyncCountdownMarkup: string
): string {
  return `
    <section class="hero panel">
      <div class="hero-copy">
        <p class="eyebrow">${t(state.locale, "dashboardTitle")}</p>
        ${
          dashboard
            ? `
              <div class="chip-row">
                <span class="chip ${statusTone(dashboard.status.state)}">${t(state.locale, "heroStatus", {
                  status: statusLabel(dashboard.status.state)
                })}</span>
                <span class="chip">${t(state.locale, "heroTimeZone", {
                  timeZone: escapeHtml(dashboard.meta.timeZone)
                })}</span>
                <span class="chip">${t(state.locale, "heroTrackedSessions", {
                  count: syncPreview?.totalTrackedSessions ?? "…"
                })}</span>
                <span class="chip ${syncPreview?.needsSync ? "warm" : "good"}">
                  ${
                    !syncPreview
                      ? t(state.locale, "heroSyncPreviewUnavailable")
                      : syncPreview.needsSync
                        ? t(state.locale, "heroPendingSessions", {
                            count: syncPreview.newSessions + syncPreview.changedSessions + syncPreview.removedSessions
                          })
                        : t(state.locale, "heroCaughtUp")
                  }
                </span>
              </div>
            `
            : ""
        }
      </div>

      <div class="hero-actions">
        <div class="sync-toolbar">
          <button class="action primary" type="button" data-sync ${state.isLoading || state.isSyncing || !syncAvailable ? "disabled" : ""}>
            ${state.isSyncing ? t(state.locale, "syncingShort") : syncAvailable ? t(state.locale, "syncButton") : t(state.locale, "syncPendingMigration")}
          </button>
          <label class="sync-mode-field" for="auto-sync-mode">
            <span>${t(state.locale, "syncFrequency")}</span>
            <select id="auto-sync-mode" class="sync-mode-select" data-auto-sync-mode ${state.isSyncing ? "disabled" : ""}>
              ${autoSyncOptionsMarkup}
            </select>
          </label>
          ${autoSyncCountdownMarkup}
        </div>
        <div data-sync-progress-slot>${renderSyncProgressCard(syncProgress)}</div>
        <div class="status-card">
          <div class="status-card-head">
            <p>${t(state.locale, "lastSynced")}</p>
            <strong>${formatTimestamp(dashboard?.status.lastSyncedAt ?? null, timeZone)}</strong>
          </div>
          <span class="status-card-detail">
            ${t(state.locale, "sessionDeltaSummary", {
              newCount: syncPreview?.newSessions ?? 0,
              changedCount: syncPreview?.changedSessions ?? 0,
              removedCount: syncPreview?.removedSessions ?? 0
            })}
          </span>
        </div>
      </div>
    </section>
  `;
}

function renderOverviewView(
  timeZone: string,
  summaryCards: string,
  dashboard: DashboardPayloadDTO | null,
  syncPreview: DashboardPayloadDTO["syncPreview"] | null,
  syncProgress: SyncProgressDTO | null,
  syncAvailable: boolean,
  autoSyncOptionsMarkup: string,
  autoSyncCountdownMarkup: string
): string {
  return `
    <div class="overview-stack">
      ${renderHeroSection(
        dashboard,
        syncPreview,
        syncProgress,
        timeZone,
        syncAvailable,
        autoSyncOptionsMarkup,
        autoSyncCountdownMarkup
      )}

      <section class="summary-grid">${summaryCards}</section>

      <section class="content-grid">
        ${renderUsageTable(t(state.locale, "lastSevenDaysDisplay"), dashboard?.dailyHistory ?? [], timeZone, "daily")}
      </section>
    </div>
  `;
}

function renderMonthlyHistoryView(timeZone: string, dashboard: DashboardPayloadDTO | null): string {
  return renderUsageTable(t(state.locale, "navMonthlyHistory"), dashboard?.monthlyHistory ?? [], timeZone, "monthly");
}

function renderSyncInfoView(timeZone: string, notes: string, dashboard: DashboardPayloadDTO | null): string {
  const databasePathEditable = dashboard?.meta.databasePathEditable ?? false;
  const databasePathDisabled = state.isLoading || state.isSyncing || state.isUpdatingDatabasePath || !databasePathEditable;
  const databasePathSource = dashboard ? databasePathSourceLabel(dashboard.meta.databasePathSource) : "-";
  const databasePathFeedback = state.databasePathNotice
    ? `<p class="config-feedback ${state.databasePathNotice.tone}">${escapeHtml(state.databasePathNotice.text)}</p>`
    : "";
  const databasePathLockNote =
    dashboard && !dashboard.meta.databasePathEditable
      ? `<p class="config-note">${t(state.locale, "sqlitePathLockedByEnv")}</p>`
      : "";

  return `
    <section class="info-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${t(state.locale, "localData")}</p>
          <h3>${t(state.locale, "syncInfoTitle")}</h3>
        </div>
      </div>

      <dl class="meta-list">
        <div>
          <dt>${t(state.locale, "codexDirectory")}</dt>
          <dd>${escapeHtml(dashboard?.meta.codexHomePath ?? "-")}</dd>
        </div>
        <div>
          <dt>${t(state.locale, "sqlite")}</dt>
          <dd>${escapeHtml(dashboard?.meta.databasePath ?? "-")}</dd>
        </div>
        <div>
          <dt>${t(state.locale, "parseVersion")}</dt>
          <dd>${dashboard?.meta.parseVersion ?? "-"}</dd>
        </div>
        <div>
          <dt>${t(state.locale, "coverageThrough")}</dt>
          <dd>${formatTimestamp(dashboard?.status.coverageThrough ?? null, timeZone)}</dd>
        </div>
        <div>
          <dt>${t(state.locale, "scannedFiles")}</dt>
          <dd>${dashboard?.status.scannedFiles ?? 0}</dd>
        </div>
        <div>
          <dt>${t(state.locale, "affectedSessions")}</dt>
          <dd>${dashboard?.status.sessionCount ?? 0}</dd>
        </div>
      </dl>

      <div class="config-block">
        <div class="section-head">
          <div>
            <p class="eyebrow">${t(state.locale, "sqlitePathSection")}</p>
            <h3>${t(state.locale, "sqlitePath")}</h3>
          </div>
        </div>

        <form class="config-form" data-database-path-form>
          <label class="config-field">
            <span>${t(state.locale, "sqlitePath")}</span>
            <input
              type="text"
              value="${escapeHtml(state.databasePathDraft)}"
              data-database-path-input
              ${databasePathDisabled ? "disabled" : ""}
            />
          </label>

          <div class="config-actions">
            <button class="action primary" type="submit" ${databasePathDisabled ? "disabled" : ""}>
              ${state.isUpdatingDatabasePath ? t(state.locale, "savingPath") : t(state.locale, "savePath")}
            </button>
            <button
              class="action"
              type="button"
              data-database-path-reset
              ${databasePathDisabled ? "disabled" : ""}
            >
              ${t(state.locale, "resetDefaultPath")}
            </button>
          </div>
        </form>

        <p class="config-hint">${t(state.locale, "sqlitePathHint")}</p>
        <p class="config-note">${t(state.locale, "databasePathSource", { source: databasePathSource })}</p>
        ${databasePathLockNote}
        ${databasePathFeedback}
      </div>

      <div class="note-stack">${notes}</div>
    </section>
  `;
}

function dailyDetailTitle(): string {
  if (!state.dailyDetailStartDate || !state.dailyDetailEndDate) {
    return t(state.locale, "dailyUsageTitle");
  }

  if (state.dailyDetailStartDate === state.dailyDetailEndDate) {
    return t(state.locale, "dailyUsageOnDate", { date: state.dailyDetailEndDate });
  }

  return t(state.locale, "dailyUsageInRange", {
    start: state.dailyDetailStartDate,
    end: state.dailyDetailEndDate
  });
}

function renderDailyDetailView(timeZone: string): string {
  const queryDisabled = state.isLoadingDailyDetails || state.isLoading;

  let resultsMarkup = renderEmptyState(
    t(state.locale, "readyToQueryDailyUsage"),
    t(state.locale, "readyToQueryDailyUsageDescription")
  );

  if (state.dailyDetailsError) {
    resultsMarkup = `<section class="banner bad">${escapeHtml(state.dailyDetailsError)}</section>`;
  } else if (state.isLoadingDailyDetails) {
    resultsMarkup = `<section class="banner">${t(state.locale, "dailyUsageLoading")}</section>`;
  } else if (state.hasLoadedDailyDetails) {
    resultsMarkup =
      state.dailyDetailRows.length > 0
        ? `
            ${renderDailyDetailPagination()}
            ${renderDailyDetailTable(dailyDetailTitle(), currentDailyDetailPageRows(), timeZone)}
          `
        : renderEmptyState(t(state.locale, "noDataInRangeTitle"), t(state.locale, "noDataInRangeDescription"));
  }

  return `
    <section class="detail-filter-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${t(state.locale, "queryByDate")}</p>
          <h3>${t(state.locale, "dailyUsageTitle")}</h3>
        </div>
      </div>

      <form class="detail-filter-grid" data-daily-detail-form>
        <label class="detail-field">
          <span>${t(state.locale, "startDate")}</span>
          <input type="date" value="${state.dailyDetailStartDate}" data-daily-start ${queryDisabled ? "disabled" : ""} />
        </label>
        <label class="detail-field">
          <span>${t(state.locale, "endDate")}</span>
          <input type="date" value="${state.dailyDetailEndDate}" data-daily-end ${queryDisabled ? "disabled" : ""} />
        </label>
        <button class="action primary detail-query-button" type="submit" ${queryDisabled ? "disabled" : ""}>
          ${state.isLoadingDailyDetails ? t(state.locale, "querying") : t(state.locale, "queryDailyUsage")}
        </button>
      </form>

      <p class="detail-hint">${t(state.locale, "dailyUsageHint", { maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS) })}</p>
    </section>

    ${resultsMarkup}
  `;
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
  const summaryCards = summaries.map((summary) => renderSummaryCard(summary, timeZone)).join("");
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
      : state.isLoading
        ? t(state.locale, "loadingDashboard")
        : dashboard
          ? t(state.locale, "currentStatus", { status: statusLabel(dashboard.status.state) })
          : t(state.locale, "dashboardNotLoaded");
  const skipLinkText = t(state.locale, "skipToMainContent");
  const sidebarMarkup = renderSidebarNav();
  const contentMarkup = `
    ${state.errorMessage ? `<section class="banner bad">${escapeHtml(state.errorMessage)}</section>` : ""}
    ${state.isLoading && !dashboard ? `<section class="banner">${t(state.locale, "loadingPage")}</section>` : ""}
    ${
      state.activeTab === "overview"
        ? renderOverviewView(
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
          ? renderMonthlyHistoryView(timeZone, dashboard)
          : state.activeTab === "syncInfo"
            ? renderSyncInfoView(timeZone, notes, dashboard)
            : renderDailyDetailView(timeZone)
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
}

function validateDailyDetailRange(): string | null {
  if (!state.dailyDetailStartDate || !state.dailyDetailEndDate) {
    return t(state.locale, "selectDateRangeError");
  }

  if (state.dailyDetailStartDate > state.dailyDetailEndDate) {
    return t(state.locale, "invalidDateRangeError");
  }

  if (dateRangeDayCount(state.dailyDetailStartDate, state.dailyDetailEndDate) > MAX_DAILY_DETAIL_RANGE_DAYS) {
    return t(state.locale, "dailyUsageRangeTooLarge", { maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS) });
  }

  return null;
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
  const validationError = validateDailyDetailRange();
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

render();
void initializeSyncProgressListener();
void loadDashboard();
