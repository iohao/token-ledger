import React from "react";
import { useTranslation } from "react-i18next";
import type { DailyUsageSummaryDTO, DashboardPayloadDTO, PricingProviderDTO } from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import {
  formatCny,
  formatCurrency,
  formatDateLabel,
  formatInteger,
  formatModelLabel,
  formatMonthLabel,
  formatTokenCount,
  nonCachedInputTokens,
  sumTotals
} from "../utils/format";
import { relayCostsForModels } from "./DailyDetailTable";

export interface UsageTableProps {
  title: string;
  rows: DashboardPayloadDTO["dailyHistory"] | DashboardPayloadDTO["monthlyHistory"] | DailyUsageSummaryDTO[];
  timeZone: string;
  mode: "daily" | "monthly";
  relayProviders?: PricingProviderDTO[];
}

export const UsageTable: React.FC<UsageTableProps> = ({
  title,
  rows,
  timeZone,
  mode,
  relayProviders
}) => {
  const { t } = useTranslation();
  const { locale, dashboard } = useApp();
  const officialProvider = dashboard?.meta.pricingProviders?.find((p) => p.kind === "official");
  const totals = sumTotals(rows);
  const isDaily = mode === "daily";
  const showRelayPrices = relayProviders !== undefined;
  const displayedRelayProviders = relayProviders ?? [];
  const relayTotals = displayedRelayProviders.map((provider) =>
    relayCostsForModels(rows.flatMap((row) => row.models), provider, officialProvider)
  );

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
              <th>{t("requests")}</th>
              <th>{t("input")}</th>
              <th>{t("output")}</th>
              <th>{t("cachedInput")}</th>
              <th>{t("reasoning")}</th>
              <th>{t("total")}</th>
              {showRelayPrices ? (
                displayedRelayProviders.map((provider) => (
                  <th key={provider.id} className="daily-detail-relay-cost-header" title={provider.name}>
                    {provider.name}
                  </th>
                ))
              ) : (
                <th className="daily-detail-model-cost-header">{t("cost")}</th>
              )}
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
                  <td>{formatInteger(row.totals.requestCount, locale)}</td>
                  <td>{formatTokenCount(nonCachedInputTokens(row.totals), locale)}</td>
                  <td>{formatTokenCount(row.totals.outputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.cachedInputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.reasoningOutputTokens, locale)}</td>
                  <td>{formatTokenCount(row.totals.totalTokens, locale)}</td>
                  {showRelayPrices ? (
                    displayedRelayProviders.map((provider) => {
                      const cost = relayCostsForModels(row.models, provider, officialProvider);
                      return (
                        <td key={provider.id} className="cost-cell daily-detail-relay-cost-cell">
                          {cost === null ? <span className="muted">—</span> : formatCny(cost, locale)}
                        </td>
                      );
                    })
                  ) : (
                    <td className="cost-cell daily-detail-model-cost-cell">{formatCurrency(row.totals.costUSD, locale)}</td>
                  )}
                </tr>
              );
            })}
            <tr className="total-row">
              <td>{t("totalLabel")}</td>
              <td />
              <td>{formatInteger(totals.requestCount, locale)}</td>
              <td>{formatTokenCount(nonCachedInputTokens(totals), locale)}</td>
              <td>{formatTokenCount(totals.outputTokens, locale)}</td>
              <td>{formatTokenCount(totals.cachedInputTokens, locale)}</td>
              <td>{formatTokenCount(totals.reasoningOutputTokens, locale)}</td>
              <td>{formatTokenCount(totals.totalTokens, locale)}</td>
              {showRelayPrices ? (
                displayedRelayProviders.map((provider, index) => (
                  <td key={provider.id} className="cost-cell daily-detail-relay-cost-cell">
                    {relayTotals[index] === null ? <span className="muted">—</span> : formatCny(relayTotals[index], locale)}
                  </td>
                ))
              ) : (
                <td className="cost-cell daily-detail-model-cost-cell">{formatCurrency(totals.costUSD, locale)}</td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};
