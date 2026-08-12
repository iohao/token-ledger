import {
  currentDailyDetailPageRows,
  renderDailyDetailPagination,
  renderDailyDetailTable
} from "../components/daily-detail-table";
import { renderEmptyState } from "../components/empty-state";
import { renderPageHeader } from "../components/page-header";
import { t } from "../i18n";
import { DAILY_DETAIL_PAGE_SIZE, MAX_DAILY_DETAIL_RANGE_DAYS, type AppState, type PageSourceId } from "../types";
import { dateRangeDayCount, escapeHtml, formatInteger, iconMarkup } from "../utils/format";

export const DAILY_DETAIL_PAGE_SOURCE_ID: PageSourceId = "src/views/daily-detail.ts";

export function dailyDetailTitle(state: AppState): string {
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

export function validateDailyDetailRange(state: AppState): string | null {
  if (!state.dailyDetailStartDate || !state.dailyDetailEndDate) {
    return t(state.locale, "selectDateRangeError");
  }

  if (state.dailyDetailStartDate > state.dailyDetailEndDate) {
    return t(state.locale, "invalidDateRangeError");
  }

  if (dateRangeDayCount(state.dailyDetailStartDate, state.dailyDetailEndDate) > MAX_DAILY_DETAIL_RANGE_DAYS) {
    return t(state.locale, "dailyUsageRangeTooLarge", { maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS, state.locale) });
  }

  return null;
}

export function renderDailyDetailView(state: AppState, timeZone: string): string {
  const queryDisabled = state.isLoadingDailyDetails || state.isLoading;

  let resultsMarkup = renderEmptyState(
    t(state.locale, "readyToQueryDailyUsage"),
    t(state.locale, "readyToQueryDailyUsageDescription"),
    state.locale
  );

  if (state.dailyDetailsError) {
    resultsMarkup = `<section class="banner bad">${escapeHtml(state.dailyDetailsError)}</section>`;
  } else if (state.isLoadingDailyDetails) {
    resultsMarkup = `<section class="banner">${t(state.locale, "dailyUsageLoading")}</section>`;
  } else if (state.hasLoadedDailyDetails) {
    resultsMarkup =
      state.dailyDetailRows.length > 0
        ? `
            ${renderDailyDetailPagination(state.dailyDetailPage, state.dailyDetailRows.length, DAILY_DETAIL_PAGE_SIZE, state.locale)}
            ${renderDailyDetailTable(
              dailyDetailTitle(state),
              currentDailyDetailPageRows(state.dailyDetailRows, state.dailyDetailPage, DAILY_DETAIL_PAGE_SIZE),
              timeZone,
              t(state.locale, "dailyUsageTitle"),
              state.locale
            )}
          `
        : renderEmptyState(t(state.locale, "noDataInRangeTitle"), t(state.locale, "noDataInRangeDescription"), state.locale);
  }

  return `
    <div class="page-stack">
    ${renderPageHeader(
      "calendar-days",
      t(state.locale, "navUsage"),
      t(state.locale, "navDailyDetail"),
      t(state.locale, "dailyUsageDescription"),
      DAILY_DETAIL_PAGE_SOURCE_ID,
      state.showPageSourceIds,
      state.copiedPageSourceId,
      state.locale
    )}
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
          ${iconMarkup("search", "action-icon")}
          <span>${state.isLoadingDailyDetails ? t(state.locale, "querying") : t(state.locale, "queryDailyUsage")}</span>
        </button>
      </form>

      <p class="detail-hint">${t(state.locale, "dailyUsageHint", { maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS, state.locale) })}</p>
    </section>

    ${resultsMarkup}
    </div>
  `;
}
