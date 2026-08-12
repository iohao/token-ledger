import { renderPageHeader } from "../components/page-header";
import { renderUsageTable } from "../components/usage-table";
import type { DashboardPayloadDTO } from "../dto/dashboard";
import { t } from "../i18n";
import type { AppState, PageSourceId } from "../types";

export const MONTHLY_HISTORY_PAGE_SOURCE_ID: PageSourceId = "src/views/monthly-history.ts";

export function renderMonthlyHistoryView(
  state: AppState,
  timeZone: string,
  dashboard: DashboardPayloadDTO | null
): string {
  return `
    <div class="page-stack">
      ${renderPageHeader(
        "chart-no-axes-combined",
        t(state.locale, "navUsage"),
        t(state.locale, "navMonthlyHistory"),
        t(state.locale, "monthlyHistoryDescription"),
        MONTHLY_HISTORY_PAGE_SOURCE_ID,
        state.showPageSourceIds,
        state.copiedPageSourceId,
        state.locale
      )}
      ${renderUsageTable(t(state.locale, "navMonthlyHistory"), dashboard?.monthlyHistory ?? [], timeZone, "monthly", state.locale)}
    </div>
  `;
}
