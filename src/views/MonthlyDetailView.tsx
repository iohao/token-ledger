import React from "react";
import { CalendarRange } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import { DailyDetailTable } from "../components/DailyDetailTable";
import { EmptyState } from "../components/EmptyState";
import { ENGLISH_MONTH_LABELS, MONTH_BUTTON_VALUES, type PageSourceId } from "../types";
import { formatMonthLabel, padNumber } from "../utils/format";
import type { Locale } from "../i18n";

export const MONTHLY_DETAIL_PAGE_SOURCE_ID: PageSourceId = "src/views/MonthlyDetailView.tsx";

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

export const MonthlyDetailView: React.FC = () => {
  const { t } = useTranslation();
  const {
    dashboard,
    monthlyDetailYear,
    monthlyDetailMonth,
    monthlyDetailRows,
    isLoadingMonthlyDetails,
    monthlyDetailsError,
    hasLoadedMonthlyDetails,
    setMonthlyDetailYear,
    loadMonthlyDetails,
    isLoading,
    locale
  } = useApp();

  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const relayProviders = dashboard?.meta.pricingProviders?.filter(
    (provider) => provider.kind === "relay" && provider.enabled
  ) ?? [];
  const queryDisabled = isLoadingMonthlyDetails || isLoading;
  const monthlyDetailRowsWithData = monthlyDetailRows.filter((row) => row.models.length > 0);

  // Calculate year options
  const years = new Set<string>();
  const currentYear = dashboard?.now ? dashboard.now.slice(0, 4) : String(new Date().getUTCFullYear());
  years.add(currentYear);
  for (const row of dashboard?.monthlyHistory ?? []) {
    years.add(row.monthKey.slice(0, 4));
  }
  if (monthlyDetailYear) {
    years.add(monthlyDetailYear);
  }
  const yearOptions = [...years].sort((a, b) => Number(b) - Number(a));

  const pageTitle =
    !monthlyDetailYear || monthlyDetailMonth === null
      ? t("monthlyDetailTitle")
      : t("monthlyDetailSelectedTitle", {
          month: formatMonthLabel(monthKeyForParts(monthlyDetailYear, monthlyDetailMonth), timeZone, locale)
        });

  let resultsContent: React.ReactNode = (
    <EmptyState
      title={t("readyToQueryMonthlyDetail")}
      description={t("readyToQueryMonthlyDetailDescription")}
    />
  );

  if (monthlyDetailsError) {
    resultsContent = <section className="banner bad">{monthlyDetailsError}</section>;
  } else if (isLoadingMonthlyDetails) {
    resultsContent = <section className="banner">{t("monthlyDetailLoading")}</section>;
  } else if (hasLoadedMonthlyDetails) {
    resultsContent =
      monthlyDetailRowsWithData.length > 0 ? (
        <DailyDetailTable
          title={pageTitle}
          rows={monthlyDetailRowsWithData}
          timeZone={timeZone}
          eyebrow={t("monthlyDetailTitle")}
          relayProviders={relayProviders}
        />
      ) : (
        <EmptyState
          title={t("noDataInRangeTitle")}
          description={t("noDataInRangeDescription")}
        />
      );
  }

  return (
    <div className="page-stack">
      <PageHeader
        icon={<CalendarRange size={18} />}
        eyebrow={t("navUsage")}
        title={t("navMonthlyDetail")}
        description={t("monthlyDetailDescription")}
        pageSourceId={MONTHLY_DETAIL_PAGE_SOURCE_ID}
      />

      <section className="detail-filter-panel panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t("queryByMonth")}</p>
            <h3>{t("monthlyDetailTitle")}</h3>
          </div>
        </div>

        <div className="monthly-detail-controls">
          <label className="detail-field monthly-detail-year-field">
            <span>{t("year")}</span>
            <select
              value={monthlyDetailYear}
              onChange={(e) => {
                const newYear = e.target.value;
                setMonthlyDetailYear(newYear);
                if (monthlyDetailMonth !== null && !isLoadingMonthlyDetails) {
                  void loadMonthlyDetails(monthlyDetailMonth);
                }
              }}
              disabled={queryDisabled}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <div className="monthly-detail-months" role="group" aria-label={t("month")}>
            {MONTH_BUTTON_VALUES.map((month) => (
              <button
                key={month}
                className={`action detail-month-button ${monthlyDetailMonth === month ? "is-active" : ""}`}
                type="button"
                onClick={() => void loadMonthlyDetails(month)}
                disabled={queryDisabled}
              >
                {monthButtonLabel(month, locale)}
              </button>
            ))}
          </div>
        </div>

        <p className="detail-hint">{t("monthlyDetailHint")}</p>
      </section>

      {resultsContent}
    </div>
  );
};
