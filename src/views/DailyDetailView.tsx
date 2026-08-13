import React from "react";
import { CalendarDays, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import {
  DailyDetailPagination,
  DailyDetailTable,
  currentDailyDetailPageRows
} from "../components/DailyDetailTable";
import { EmptyState } from "../components/EmptyState";
import {
  DAILY_DETAIL_PAGE_SIZE,
  MAX_DAILY_DETAIL_RANGE_DAYS,
  type PageSourceId
} from "../types";
import { formatInteger } from "../utils/format";

export const DAILY_DETAIL_PAGE_SOURCE_ID: PageSourceId = "src/views/DailyDetailView.tsx";

export const DailyDetailView: React.FC = () => {
  const { t } = useTranslation();
  const {
    dashboard,
    dailyDetailStartDate,
    dailyDetailEndDate,
    dailyDetailPage,
    dailyDetailRows,
    isLoadingDailyDetails,
    dailyDetailsError,
    hasLoadedDailyDetails,
    setDailyDetailStartDate,
    setDailyDetailEndDate,
    setDailyDetailPage,
    loadDailyDetails,
    isLoading,
    locale
  } = useApp();

  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryDisabled = isLoadingDailyDetails || isLoading;

  const pageTitle =
    !dailyDetailStartDate || !dailyDetailEndDate
      ? t("dailyUsageTitle")
      : dailyDetailStartDate === dailyDetailEndDate
        ? t("dailyUsageOnDate", { date: dailyDetailEndDate })
        : t("dailyUsageInRange", { start: dailyDetailStartDate, end: dailyDetailEndDate });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadDailyDetails();
  };

  let resultsContent: React.ReactNode = (
    <EmptyState
      title={t("readyToQueryDailyUsage")}
      description={t("readyToQueryDailyUsageDescription")}
    />
  );

  if (dailyDetailsError) {
    resultsContent = <section className="banner bad">{dailyDetailsError}</section>;
  } else if (isLoadingDailyDetails) {
    resultsContent = <section className="banner">{t("dailyUsageLoading")}</section>;
  } else if (hasLoadedDailyDetails) {
    resultsContent =
      dailyDetailRows.length > 0 ? (
        <>
          <DailyDetailPagination
            currentPage={dailyDetailPage}
            totalRows={dailyDetailRows.length}
            pageSize={DAILY_DETAIL_PAGE_SIZE}
            onPageChange={(page) => setDailyDetailPage(page)}
          />
          <DailyDetailTable
            title={pageTitle}
            rows={currentDailyDetailPageRows(dailyDetailRows, dailyDetailPage, DAILY_DETAIL_PAGE_SIZE)}
            timeZone={timeZone}
            eyebrow={t("dailyUsageTitle")}
          />
        </>
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
        icon={<CalendarDays size={18} />}
        eyebrow={t("navUsage")}
        title={t("navDailyDetail")}
        description={t("dailyUsageDescription")}
        pageSourceId={DAILY_DETAIL_PAGE_SOURCE_ID}
      />

      <section className="detail-filter-panel panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t("queryByDate")}</p>
            <h3>{t("dailyUsageTitle")}</h3>
          </div>
        </div>

        <form className="detail-filter-grid" onSubmit={handleSubmit}>
          <label className="detail-field">
            <span>{t("startDate")}</span>
            <input
              type="date"
              value={dailyDetailStartDate}
              onChange={(e) => setDailyDetailStartDate(e.target.value)}
              disabled={queryDisabled}
            />
          </label>
          <label className="detail-field">
            <span>{t("endDate")}</span>
            <input
              type="date"
              value={dailyDetailEndDate}
              onChange={(e) => setDailyDetailEndDate(e.target.value)}
              disabled={queryDisabled}
            />
          </label>
          <button className="action primary detail-query-button" type="submit" disabled={queryDisabled}>
            <Search className="action-icon" size={16} />
            <span>{isLoadingDailyDetails ? t("querying") : t("queryDailyUsage")}</span>
          </button>
        </form>

        <p className="detail-hint">
          {t("dailyUsageHint", {
            maxDays: formatInteger(MAX_DAILY_DETAIL_RANGE_DAYS, locale)
          })}
        </p>
      </section>

      {resultsContent}
    </div>
  );
};
