import { renderDailyDetailTable } from "../components/daily-detail-table";
import { renderActivityWall } from "../components/activity-wall";
import { renderPageHeader } from "../components/page-header";
import { renderSyncProgressCard } from "../components/sync-progress";
import type { DashboardPayloadDTO, SyncProgressDTO } from "../dto/dashboard";
import { t } from "../i18n";
import type { AppState, PageSourceId } from "../types";
import { escapeHtml, formatTimestamp, iconMarkup, statusLabel, statusTone } from "../utils/format";

export const OVERVIEW_PAGE_SOURCE_ID: PageSourceId = "src/views/overview.ts";

export function renderHeroSection(
  state: AppState,
  dashboard: DashboardPayloadDTO | null,
  syncPreview: DashboardPayloadDTO["syncPreview"] | null,
  syncProgress: SyncProgressDTO | null,
  timeZone: string,
  syncAvailable: boolean,
  autoSyncOptionsMarkup: string,
  autoSyncCountdownMarkup: string
): string {
  const pendingSessions = syncPreview
    ? syncPreview.newSessions + syncPreview.changedSessions + syncPreview.removedSessions
    : null;
  const syncActionMarkup = `
    <button class="action primary" type="button" data-sync ${state.isLoading || state.isSyncing || !syncAvailable ? "disabled" : ""}>
      ${iconMarkup("refresh-cw", "action-icon")}
      <span>${state.isSyncing ? t(state.locale, "syncingShort") : syncAvailable ? t(state.locale, "syncButton") : t(state.locale, "syncPendingMigration")}</span>
    </button>
    <label class="sync-mode-field" for="auto-sync-mode">
      <span>${t(state.locale, "syncFrequency")}</span>
      <select id="auto-sync-mode" class="sync-mode-select" data-auto-sync-mode ${state.isSyncing ? "disabled" : ""}>
        ${autoSyncOptionsMarkup}
      </select>
    </label>
    ${autoSyncCountdownMarkup}
  `;

  return `
    ${renderPageHeader(
      "layout-dashboard",
      t(state.locale, "dashboardTitle"),
      t(state.locale, "overviewTitle"),
      t(state.locale, "overviewDescription"),
      OVERVIEW_PAGE_SOURCE_ID,
      state.showPageSourceIds,
      state.copiedPageSourceId,
      state.locale,
      `<div class="sync-toolbar">${syncActionMarkup}</div>`
    )}
    <section class="hero ledger-rail panel" aria-label="${t(state.locale, "currentStatus", { status: statusLabel(dashboard?.status.state ?? "idle", state.locale) })}">
      <div class="ledger-metric">
        <span>${t(state.locale, "statusLabel")}</span>
        <strong class="status-value ${statusTone(dashboard?.status.state ?? "idle")}">
          <span class="status-indicator" aria-hidden="true"></span>${statusLabel(dashboard?.status.state ?? "idle", state.locale)}
        </strong>
      </div>
      <div class="ledger-metric">
        <span>${t(state.locale, "lastSynced")}</span>
        <strong>${formatTimestamp(dashboard?.status.lastSyncedAt ?? null, timeZone, state.locale)}</strong>
      </div>
      <div class="ledger-metric">
        <span>${t(state.locale, "timeZone")}</span>
        <strong>${escapeHtml(dashboard?.meta.timeZone ?? timeZone)}</strong>
      </div>
      <div class="ledger-metric">
        <span>${t(state.locale, "pendingSessions")}</span>
        <strong class="${pendingSessions && pendingSessions > 0 ? "warm" : "good"}">${pendingSessions ?? "…"}</strong>
      </div>
      <div class="ledger-detail">${t(state.locale, "sessionDeltaSummary", {
        newCount: syncPreview?.newSessions ?? 0,
        changedCount: syncPreview?.changedSessions ?? 0,
        removedCount: syncPreview?.removedSessions ?? 0
      })}</div>
    </section>
    <div data-sync-progress-slot>${renderSyncProgressCard(syncProgress, state.isSyncing, state.syncPreview ?? dashboard?.syncPreview ?? null, state.locale)}</div>
  `;
}

export function renderOverviewView(
  state: AppState,
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
        state,
        dashboard,
        syncPreview,
        syncProgress,
        timeZone,
        syncAvailable,
        autoSyncOptionsMarkup,
        autoSyncCountdownMarkup
      )}

      <section class="summary-grid">${summaryCards}</section>

      ${renderActivityWall(timeZone, dashboard?.activityHistory ?? [], state.locale)}

      <section class="content-grid">
        ${renderDailyDetailTable(
          t(state.locale, "lastSevenDaysDisplay"),
          dashboard?.dailyHistory ?? [],
          timeZone,
          t(state.locale, "dailySummaryEyebrow"),
          state.locale
        )}
      </section>
    </div>
  `;
}
