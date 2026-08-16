import React from "react";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, syncProgressSnapshot } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import { SummaryCard } from "../components/SummaryCard";
import { ActivityWall } from "../components/ActivityWall";
import { DailyDetailTable } from "../components/DailyDetailTable";
import { AUTO_SYNC_OPTIONS, type PageSourceId } from "../types";
import { formatCountdown, formatInteger, formatTimestamp, statusLabel, statusTone } from "../utils/format";
import { syncProgressPercent } from "../components/SyncProgressCard";
import { translateErrorMessage } from "../i18n";

export const OVERVIEW_PAGE_SOURCE_ID: PageSourceId = "src/views/OverviewView.tsx";

export const OverviewView: React.FC = () => {
  const { t } = useTranslation();
  const {
    dashboard,
    syncPreview,
    syncProgress,
    isLoading,
    isSyncing,
    autoSyncMode,
    setAutoSyncMode,
    autoSyncRemaining,
    syncDashboard,
    locale
  } = useApp();

  const hasTriggeredInitialSyncRef = React.useRef(false);

  React.useEffect(() => {
    if (hasTriggeredInitialSyncRef.current) {
      return;
    }
    if (isSyncing) {
      hasTriggeredInitialSyncRef.current = true;
      return;
    }
    if (!isLoading) {
      hasTriggeredInitialSyncRef.current = true;
      void syncDashboard();
    }
  }, [isLoading, isSyncing, syncDashboard]);

  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pendingSessions = syncPreview
    ? syncPreview.newSessions + syncPreview.changedSessions + syncPreview.removedSessions
    : null;

  const progress =
    syncProgress ??
    (isSyncing ? syncProgressSnapshot(syncPreview ?? dashboard?.syncPreview ?? null) : null);
  const progressPercent = progress ? syncProgressPercent(progress) : null;

  let syncStatusText = "";
  if (progress && isSyncing) {
    switch (progress.phase) {
      case "preparing":
        syncStatusText = t("syncPhasePreparing");
        break;
      case "scanningFiles":
        syncStatusText =
          progress.totalSessionFiles > 0
            ? `${t("syncPhaseScanningFiles")} (${t("syncProgressFilesDiscovered", { count: formatInteger(progress.totalSessionFiles, locale) })})`
            : t("syncPhaseScanningFiles");
        break;
      case "processingFiles":
        if (progress.filesToProcess > 0) {
          const processed = formatInteger(progress.processedFiles, locale);
          const total = formatInteger(progress.filesToProcess, locale);
          const pct = progressPercent !== null ? ` · ${progressPercent}%` : "";
          syncStatusText = `${t("syncPhaseProcessingFiles")} (${processed}/${total}${pct})`;
        } else {
          syncStatusText = t("syncPhaseProcessingFiles");
        }
        break;
      case "finalizing":
        syncStatusText = t("syncPhaseFinalizing");
        break;
      case "complete":
        syncStatusText = t("syncPhaseComplete");
        break;
      case "failed":
        syncStatusText = t("syncPhaseFailed");
        break;
      default:
        syncStatusText = t("syncingShort");
    }
  }

  const autoSyncLabel = (mode: string) => {
    switch (mode) {
      case "manual":
        return t("autoSyncManual");
      case "10s":
        return t("autoSync10s");
      case "30s":
        return t("autoSync30s");
      case "1m":
        return t("autoSync1m");
      case "5m":
        return t("autoSync5m");
      case "10m":
        return t("autoSync10m");
      case "15m":
        return t("autoSync15m");
      case "30m":
        return t("autoSync30m");
      default:
        return mode;
    }
  };

  const syncToolbar = (
    <div className="sync-toolbar">
      <button
        className="action primary"
        type="button"
        onClick={() => void syncDashboard()}
        disabled={isLoading || isSyncing}
      >
        <RefreshCw className={`action-icon ${isSyncing ? "animate-spin" : ""}`} size={16} />
        <span>{isSyncing ? t("syncingShort") : t("syncButton")}</span>
      </button>
      <label className="sync-mode-field" htmlFor="auto-sync-mode">
        <span>{t("syncFrequency")}</span>
        <select
          id="auto-sync-mode"
          className="sync-mode-select"
          value={autoSyncMode}
          onChange={(e) => setAutoSyncMode(e.target.value as any)}
          disabled={isSyncing}
        >
          {AUTO_SYNC_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {autoSyncLabel(opt.value)}
            </option>
          ))}
        </select>
      </label>
      {autoSyncRemaining !== null && (
        <div className={`sync-countdown ${isSyncing ? "is-active" : ""}`}>
          {isSyncing ? t("syncingShort") : t("countdown", { value: formatCountdown(autoSyncRemaining) })}
        </div>
      )}
    </div>
  );

  return (
    <div className="overview-stack">
      <PageHeader
        icon={<LayoutDashboard size={18} />}
        eyebrow={t("dashboardTitle")}
        title={t("overviewTitle")}
        description={t("overviewDescription")}
        pageSourceId={OVERVIEW_PAGE_SOURCE_ID}
        actions={syncToolbar}
      />

      <section
        className={`hero ledger-rail panel${isSyncing ? " is-syncing" : ""}`}
        aria-label={t("currentStatus", {
          status: statusLabel(dashboard?.status.state ?? "idle", locale)
        })}
      >
        <div
          className={`ledger-rail-progress${isSyncing ? " is-active" : ""}`}
          aria-hidden="true"
        >
          <span
            className={`ledger-rail-progress-fill${progressPercent === null ? " is-indeterminate" : ""}`}
            style={{ width: progressPercent !== null ? `${progressPercent}%` : undefined }}
          />
        </div>

        <div className="ledger-metric">
          <span>{t("statusLabel")}</span>
          <strong className={`status-value ${statusTone(dashboard?.status.state ?? "idle")}`}>
            <span className="status-indicator" aria-hidden="true" />
            {statusLabel(dashboard?.status.state ?? "idle", locale)}
          </strong>
        </div>
        <div className="ledger-metric">
          <span>{t("lastSynced")}</span>
          <strong>{formatTimestamp(dashboard?.status.lastSyncedAt ?? null, timeZone, locale)}</strong>
        </div>
        <div className="ledger-metric">
          <span>{t("timeZone")}</span>
          <strong>{dashboard?.meta.timeZone ?? timeZone}</strong>
        </div>
        <div className="ledger-metric">
          <span>{t("pendingSessions")}</span>
          <strong className={pendingSessions && pendingSessions > 0 ? "warm" : "good"}>
            {pendingSessions ?? "…"}
          </strong>
        </div>
        <div className="ledger-detail">
          <div className="ledger-detail-sessions">
            {t("sessionDeltaSummary", {
              newCount: formatInteger(syncPreview?.newSessions ?? progress?.newSessions ?? 0, locale),
              changedCount: formatInteger(syncPreview?.changedSessions ?? progress?.changedSessions ?? 0, locale),
              removedCount: formatInteger(syncPreview?.removedSessions ?? progress?.removedSessions ?? 0, locale)
            })}
          </div>
          <div className="ledger-detail-status">
            {isSyncing && (
              <span className="ledger-sync-badge is-syncing">
                <RefreshCw className="action-icon animate-spin" size={12} />
                <span>{syncStatusText}</span>
              </span>
            )}
            {!isSyncing && progress?.errorMessage && (
              <span className="ledger-sync-badge is-error">
                {translateErrorMessage(locale, progress.errorMessage)}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="summary-grid">
        {(dashboard?.summaries ?? []).map((summary) => (
          <SummaryCard key={summary.period} summary={summary} />
        ))}
      </section>

      <ActivityWall rows={dashboard?.activityHistory ?? []} timeZone={timeZone} />

      <section className="content-grid">
        <DailyDetailTable
          title={t("lastSevenDaysDisplay")}
          rows={dashboard?.dailyHistory ?? []}
          timeZone={timeZone}
          eyebrow={t("dailySummaryEyebrow")}
        />
      </section>
    </div>
  );
};
