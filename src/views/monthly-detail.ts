import { renderDailyDetailTable } from "../components/daily-detail-table";
import { renderEmptyState } from "../components/empty-state";
import { renderPageHeader } from "../components/page-header";
import { t, type Locale } from "../i18n";
import { ENGLISH_MONTH_LABELS, MONTH_BUTTON_VALUES, type AppState, type PageSourceId } from "../types";
import { escapeHtml, formatMonthLabel, padNumber } from "../utils/format";

export const MONTHLY_DETAIL_PAGE_SOURCE_ID: PageSourceId = "src/views/monthly-detail.ts";

export function monthKeyForParts(year: string, month: number): string {
  return `${year}-${padNumber(month)}`;
}

export function dateRangeForMonth(year: string, month: number): { startDate: string; endDate: string } {
  const endDay = new Date(Date.UTC(Number(year), month, 0)).getUTCDate();
  return {
    startDate: `${year}-${padNumber(month)}-01`,
    endDate: `${year}-${padNumber(month)}-${padNumber(endDay)}`
  };
}

export function monthButtonLabel(month: number, locale: Locale): string {
  return locale === "en-US" ? ENGLISH_MONTH_LABELS[month - 1] : `${month}月`;
}

export function monthlyDetailYearOptions(state: AppState): string[] {
  const years = new Set<string>();
  const currentYear = state.dashboard?.now ? state.dashboard.now.slice(0, 4) : String(new Date().getUTCFullYear());
  years.add(currentYear);

  for (const row of state.dashboard?.monthlyHistory ?? []) {
    years.add(row.monthKey.slice(0, 4));
  }

  if (state.monthlyDetailYear) {
    years.add(state.monthlyDetailYear);
  }

  return [...years].sort((left, right) => Number(right) - Number(left));
}

export function monthlyDetailTitle(state: AppState, timeZone: string): string {
  if (!state.monthlyDetailYear || state.monthlyDetailMonth === null) {
    return t(state.locale, "monthlyDetailTitle");
  }

  return t(state.locale, "monthlyDetailSelectedTitle", {
    month: formatMonthLabel(monthKeyForParts(state.monthlyDetailYear, state.monthlyDetailMonth), timeZone, state.locale)
  });
}

export function renderMonthlyDetailView(state: AppState, timeZone: string): string {
  const queryDisabled = state.isLoadingMonthlyDetails || state.isLoading;
  const monthlyDetailRowsWithData = state.monthlyDetailRows.filter((row) => row.models.length > 0);
  const yearOptionsMarkup = monthlyDetailYearOptions(state)
    .map(
      (year) => `<option value="${year}" ${state.monthlyDetailYear === year ? "selected" : ""}>${escapeHtml(year)}</option>`
    )
    .join("");
  const monthButtonsMarkup = MONTH_BUTTON_VALUES.map(
    (month) => `
      <button
        class="action detail-month-button ${state.monthlyDetailMonth === month ? "is-active" : ""}"
        type="button"
        data-monthly-detail-month="${month}"
        ${queryDisabled ? "disabled" : ""}
      >
        ${monthButtonLabel(month, state.locale)}
      </button>
    `
  ).join("");

  let resultsMarkup = renderEmptyState(
    t(state.locale, "readyToQueryMonthlyDetail"),
    t(state.locale, "readyToQueryMonthlyDetailDescription"),
    state.locale
  );

  if (state.monthlyDetailsError) {
    resultsMarkup = `<section class="banner bad">${escapeHtml(state.monthlyDetailsError)}</section>`;
  } else if (state.isLoadingMonthlyDetails) {
    resultsMarkup = `<section class="banner">${t(state.locale, "monthlyDetailLoading")}</section>`;
  } else if (state.hasLoadedMonthlyDetails) {
    resultsMarkup =
      monthlyDetailRowsWithData.length > 0
        ? renderDailyDetailTable(
            monthlyDetailTitle(state, timeZone),
            monthlyDetailRowsWithData,
            timeZone,
            t(state.locale, "monthlyDetailTitle"),
            state.locale
          )
        : renderEmptyState(t(state.locale, "noDataInRangeTitle"), t(state.locale, "noDataInRangeDescription"), state.locale);
  }

  return `
    <div class="page-stack">
    ${renderPageHeader(
      "calendar-range",
      t(state.locale, "navUsage"),
      t(state.locale, "navMonthlyDetail"),
      t(state.locale, "monthlyDetailDescription"),
      MONTHLY_DETAIL_PAGE_SOURCE_ID,
      state.showPageSourceIds,
      state.copiedPageSourceId,
      state.locale
    )}
    <section class="detail-filter-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${t(state.locale, "queryByMonth")}</p>
          <h3>${t(state.locale, "monthlyDetailTitle")}</h3>
        </div>
      </div>

      <div class="monthly-detail-controls">
        <label class="detail-field monthly-detail-year-field">
          <span>${t(state.locale, "year")}</span>
          <select data-monthly-detail-year ${queryDisabled ? "disabled" : ""}>${yearOptionsMarkup}</select>
        </label>
        <div class="monthly-detail-months" role="group" aria-label="${t(state.locale, "month")}">
          ${monthButtonsMarkup}
        </div>
      </div>

      <p class="detail-hint">${t(state.locale, "monthlyDetailHint")}</p>
    </section>

    ${resultsMarkup}
    </div>
  `;
}
