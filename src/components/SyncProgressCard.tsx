import React from "react";
import { useTranslation } from "react-i18next";
import type { SyncProgressDTO } from "../dto/dashboard";
import { useApp, syncProgressSnapshot } from "../context/AppContext";
import { formatInteger } from "../utils/format";
import { translateErrorMessage, type Locale } from "../i18n";

export function syncProgressPhaseLabel(phase: SyncProgressDTO["phase"], locale: Locale): string {
  switch (phase) {
    case "preparing":
      return "syncPhasePreparing";
    case "scanningFiles":
      return "syncPhaseScanningFiles";
    case "processingFiles":
      return "syncPhaseProcessingFiles";
    case "finalizing":
      return "syncPhaseFinalizing";
    case "complete":
      return "syncPhaseComplete";
    case "failed":
      return "syncPhaseFailed";
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

export const SyncProgressCard: React.FC = () => {
  const { t } = useTranslation();
  const { syncProgress, isSyncing, syncPreview, dashboard, locale } = useApp();

  if (!syncProgress && !isSyncing) {
    return null;
  }

  const progress = syncProgress ?? syncProgressSnapshot(syncPreview ?? dashboard?.syncPreview ?? null);
  const progressPercent = syncProgressPercent(progress);

  const filesDiscoveredText =
    progress.totalSessionFiles > 0
      ? t("syncProgressFilesDiscovered", {
          count: formatInteger(progress.totalSessionFiles, locale)
        })
      : t("syncProgressWaiting");

  const processedText =
    progress.filesToProcess > 0
      ? t("syncProgressFilesProcessed", {
          processed: formatInteger(progress.processedFiles, locale),
          total: formatInteger(progress.filesToProcess, locale)
        })
      : filesDiscoveredText;

  const meterModifierClass = progressPercent === null ? " sync-progress-meter--indeterminate" : "";
  const fillModifierClass = progressPercent === null ? " sync-progress-meter-fill--indeterminate" : "";
  const fillWidth = progressPercent === null ? 38 : progressPercent;
  const progressValueLabel =
    progressPercent === null ? t("syncingShort") : t("syncProgressPercent", { value: progressPercent });

  return (
    <section className="sync-progress-card" aria-live="polite">
      <div className="sync-progress-header">
        <p>{t("syncProgressTitle")}</p>
        <strong>{t(syncProgressPhaseLabel(progress.phase, locale))}</strong>
      </div>
      <div className={`sync-progress-meter${meterModifierClass}`} aria-hidden="true">
        <span className={`sync-progress-meter-fill${fillModifierClass}`} style={{ width: `${fillWidth}%` }} />
      </div>
      <div className="sync-progress-summary">
        <span>{progressValueLabel}</span>
      </div>
      <div className="sync-progress-meta">
        <span>{filesDiscoveredText}</span>
        <span>{processedText}</span>
        <span>
          {t("sessionDeltaSummary", {
            newCount: formatInteger(progress.newSessions, locale),
            changedCount: formatInteger(progress.changedSessions, locale),
            removedCount: formatInteger(progress.removedSessions, locale)
          })}
        </span>
        {progress.removedSessions > 0 && (
          <span>
            {t("syncProgressRemovedSessions", {
              count: formatInteger(progress.removedSessions, locale)
            })}
          </span>
        )}
      </div>
      {progress.errorMessage && (
        <p className="sync-progress-error">{translateErrorMessage(locale, progress.errorMessage)}</p>
      )}
    </section>
  );
};
