import React from "react";
import { useTranslation } from "react-i18next";
import type { DailyUsageSummaryDTO, DashboardPayloadDTO } from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import {
  formatCurrency,
  formatDateLabel,
  formatModelLabel,
  formatMonthLabel,
  formatTokenCount,
  nonCachedInputTokens,
  sumTotals
} from "../utils/format";

export interface UsageTableProps {
  title: string;
  rows: DashboardPayloadDTO["dailyHistory"] | DashboardPayloadDTO["monthlyHistory"] | DailyUsageSummaryDTO[];
  timeZone: string;
  mode: "daily" | "monthly";
}

export const UsageTable: React.FC<UsageTableProps> = ({ title, rows, timeZone, mode }) => {
  const { t } = useTranslation();
  const { locale } = useApp();
  const totals = sumTotals(rows);
  const isDaily = mode === "daily";

  return (
    <section className="table-panel panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">{isDaily ? t("dailySummaryEyebrow") : t("historySummaryEyebrow")}</p>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th>{isDaily ? t("date") : t("month")}</th>
              <th>{t("model")}</th>
              <th>{t("input")}</th>
              <th>{t("output")}</th>
              <th>{t("reasoning")}</th>
              <th>{t("cachedInput")}</th>
              <th>{t("cacheCreationInput")}</th>
              <th>{t("total")}</th>
              <th>{t("cost")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const label = isDaily
                ? formatDateLabel((row as DailyUsageSummaryDTO).dateKey, timeZone, locale)
                : formatMonthLabel(
                    (row as DashboardPayloadDTO["monthlyHistory"][number]).monthKey,
                    timeZone,
                    locale
                  );

              return (
                <tr key={idx}>
                  <td className="label-cell">{label}</td>
                  <td>
                    {row.models.length > 0 ? (
                      <ul className="model-list">
                        {row.models.map((model, mIdx) => (
                          <li key={mIdx}>{formatModelLabel(model.model, model.isFallback, locale)}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">{t("noData")}</span>
                    )}
                  </td>
                  <td>{formatTokenCount(nonCachedInputTokens(row.totals), locale)}</td>
                  <td>{formatTokenCount(row.totals.outputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.reasoningOutputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.cachedInputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.cacheCreationInputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.totalTokens, locale)}</td>
                  <td className="cost-cell">{formatCurrency(row.totals.costUSD, locale)}</td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>{t("totalLabel")}</td>
              <td />
              <td>{formatTokenCount(nonCachedInputTokens(totals), locale)}</td>
              <td>{formatTokenCount(totals.outputTokens, locale)}</td>
              <td>{formatTokenCount(totals.reasoningOutputTokens, locale)}</td>
              <td>{formatTokenCount(totals.cachedInputTokens, locale)}</td>
              <td>{formatTokenCount(totals.cacheCreationInputTokens, locale)}</td>
              <td>{formatTokenCount(totals.totalTokens, locale)}</td>
              <td className="cost-cell">{formatCurrency(totals.costUSD, locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};
