import React from "react";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import { SummaryCard } from "../components/SummaryCard";
import { ActivityWall } from "../components/ActivityWall";
import { DailyDetailTable } from "../components/DailyDetailTable";
import { AUTO_SYNC_OPTIONS, type PageSourceId } from "../types";
import { formatCountdown, formatInteger, formatTimestamp, statusLabel, statusTone } from "../utils/format";

export const OVERVIEW_PAGE_SOURCE_ID: PageSourceId = "src/views/OverviewView.tsx";

export const OverviewView: React.FC = () => {
  const { t } = useTranslation();
  const {
    dashboard,
    syncPreview,
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
  const relayProviders = dashboard?.meta.pricingProviders.filter(
    (provider) => provider.kind === "relay" && provider.enabled
  ) ?? [];

  const syncState = isSyncing ? "syncing" : (dashboard?.status.state ?? "idle");

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
        className="hero ledger-rail panel"
        aria-label={t("currentStatus", {
          status: statusLabel(syncState, locale)
        })}
      >
        <div className="ledger-metric">
          <span>{t("statusLabel")}</span>
          <strong className={`status-value ${statusTone(syncState)}`}>
            {isSyncing ? (
              <RefreshCw className="action-icon animate-spin" size={13} />
            ) : (
              <span className="status-indicator" aria-hidden="true" />
            )}
            <span>{statusLabel(syncState, locale)}</span>
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
          {t("sessionDeltaSummary", {
            newCount: formatInteger(syncPreview?.newSessions ?? 0, locale),
            changedCount: formatInteger(syncPreview?.changedSessions ?? 0, locale),
            removedCount: formatInteger(syncPreview?.removedSessions ?? 0, locale)
          })}
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
          relayProviders={relayProviders}
        />
      </section>
    </div>
  );
};
