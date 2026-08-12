import type { DashboardPayloadDTO, SyncProgressDTO, SyncPreviewDTO, SyncStatusDTO } from "../dto/dashboard";
import { t, type Locale, translateErrorMessage } from "../i18n";
import { escapeHtml, formatInteger } from "../utils/format";

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

export function syncProgressPhaseLabel(phase: SyncProgressDTO["phase"], locale: Locale): string {
  switch (phase) {
    case "preparing":
      return t(locale, "syncPhasePreparing");
    case "scanningFiles":
      return t(locale, "syncPhaseScanningFiles");
    case "processingFiles":
      return t(locale, "syncPhaseProcessingFiles");
    case "finalizing":
      return t(locale, "syncPhaseFinalizing");
    case "complete":
      return t(locale, "syncPhaseComplete");
    case "failed":
      return t(locale, "syncPhaseFailed");
  }
}

export function syncProgressPercent(progress: SyncProgressDTO): number | null {
  if (progress.filesToProcess <= 0) {
    if (progress.phase === "complete") {
      return 100;
    }
    return null;
  }

  const ratio = Math.min(progress.processedFiles / progress.filesToProcess, 1);
  return Math.round(ratio * 100);
}

export function renderSyncProgressCard(
  syncProgress: SyncProgressDTO | null,
  isSyncing: boolean,
  syncPreview: SyncPreviewDTO | null,
  locale: Locale
): string {
  if (!syncProgress && !isSyncing) {
    return "";
  }

  const progress = syncProgress ?? syncProgressSnapshot(syncPreview);
  const progressPercent = syncProgressPercent(progress);
  const filesDiscoveredText =
    progress.totalSessionFiles > 0
      ? t(locale, "syncProgressFilesDiscovered", {
          count: formatInteger(progress.totalSessionFiles, locale)
        })
      : t(locale, "syncProgressWaiting");
  const processedText =
    progress.filesToProcess > 0
      ? t(locale, "syncProgressFilesProcessed", {
          processed: formatInteger(progress.processedFiles, locale),
          total: formatInteger(progress.filesToProcess, locale)
        })
      : filesDiscoveredText;
  const removedText =
    progress.removedSessions > 0
      ? `<span>${t(locale, "syncProgressRemovedSessions", {
          count: formatInteger(progress.removedSessions, locale)
        })}</span>`
      : "";
  const meterModifierClass = progressPercent === null ? " sync-progress-meter--indeterminate" : "";
  const fillModifierClass = progressPercent === null ? " sync-progress-meter-fill--indeterminate" : "";
  const fillWidth = progressPercent === null ? 38 : progressPercent;
  const progressValueLabel =
    progressPercent === null ? t(locale, "syncingShort") : t(locale, "syncProgressPercent", { value: progressPercent });
  const progressBarMarkup = `
    <div class="sync-progress-meter${meterModifierClass}" aria-hidden="true">
      <span class="sync-progress-meter-fill${fillModifierClass}" style="width: ${fillWidth}%;"></span>
    </div>
  `;
  const errorMarkup = progress.errorMessage
    ? `<p class="sync-progress-error">${escapeHtml(translateErrorMessage(locale, progress.errorMessage))}</p>`
    : "";

  return `
    <section class="sync-progress-card" aria-live="polite">
      <div class="sync-progress-header">
        <p>${t(locale, "syncProgressTitle")}</p>
        <strong>${syncProgressPhaseLabel(progress.phase, locale)}</strong>
      </div>
      ${progressBarMarkup}
      <div class="sync-progress-summary">
        <span>${progressValueLabel}</span>
      </div>
      <div class="sync-progress-meta">
        <span>${filesDiscoveredText}</span>
        <span>${processedText}</span>
        <span>${t(locale, "sessionDeltaSummary", {
          newCount: formatInteger(progress.newSessions, locale),
          changedCount: formatInteger(progress.changedSessions, locale),
          removedCount: formatInteger(progress.removedSessions, locale)
        })}</span>
        ${removedText}
      </div>
      ${errorMarkup}
    </section>
  `;
}
