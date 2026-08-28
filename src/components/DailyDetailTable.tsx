import React from "react";
import { useTranslation } from "react-i18next";
import type {
  DailyUsageSummaryDTO,
  ModelUsageBreakdownDTO,
  PricingProviderDTO,
  UsageTotalsDTO
} from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import {
  formatCny,
  formatCurrency,
  formatDateLabel,
  formatInteger,
  formatModelLabel,
  formatTokenCount,
  nonCachedInputTokens,
  sumTotals
} from "../utils/format";

export function dailyDetailPageCount(totalRows: number, pageSize: number): number {
  return Math.max(Math.ceil(totalRows / pageSize), 1);
}

export function clampDailyDetailPage(page: number, totalRows: number, pageSize: number): number {
  return Math.min(Math.max(page, 1), dailyDetailPageCount(totalRows, pageSize));
}

export function currentDailyDetailPageRows(
  rows: DailyUsageSummaryDTO[],
  page: number,
  pageSize: number
): DailyUsageSummaryDTO[] {
  const clampedPage = clampDailyDetailPage(page, rows.length, pageSize);
  const startIndex = (clampedPage - 1) * pageSize;
  return rows.slice(startIndex, startIndex + pageSize);
}

export const AlignedTokenCount: React.FC<{ value: number }> = ({ value }) => {
  const { locale } = useApp();
  const formatted = formatTokenCount(value, locale);
  const match = formatted.match(/^(-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)([KMB])?$/);

  if (!match) {
    return (
      <span className="metric-align">
        <span className="metric-num">{formatted}</span>
        <span className="metric-unit" />
      </span>
    );
  }

  const [, numberPart, unitPart = ""] = match;
  return (
    <span className="metric-align">
      <span className="metric-num">{numberPart}</span>
      <span className="metric-unit">{unitPart}</span>
    </span>
  );
};

export interface DailyDetailPaginationProps {
  currentPage: number;
  totalRows: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export const DailyDetailPagination: React.FC<DailyDetailPaginationProps> = ({
  currentPage,
  totalRows,
  pageSize,
  onPageChange
}) => {
  const { t } = useTranslation();
  const { locale } = useApp();
  const totalPages = dailyDetailPageCount(totalRows, pageSize);

  if (totalPages <= 1) {
    return null;
  }

  const clampedPage = clampDailyDetailPage(currentPage, totalRows, pageSize);
  const startDay = (clampedPage - 1) * pageSize + 1;
  const endDay = Math.min(clampedPage * pageSize, totalRows);

  return (
    <div className="detail-pagination" aria-label={t("dailyUsagePaginationAria")}>
      <p className="detail-pagination-summary">
        {t("dailyUsagePageSummary", {
          start: formatInteger(startDay, locale),
          end: formatInteger(endDay, locale),
          total: formatInteger(totalRows, locale)
        })}
      </p>
      <div className="detail-pagination-actions">
        <button
          className="action detail-pagination-button"
          type="button"
          onClick={() => onPageChange(clampedPage - 1)}
          disabled={clampedPage <= 1}
        >
          {t("previousPage")}
        </button>
        <span className="detail-pagination-indicator">
          {t("pageIndicator", {
            current: formatInteger(clampedPage, locale),
            total: formatInteger(totalPages, locale)
          })}
        </span>
        <button
          className="action detail-pagination-button"
          type="button"
          onClick={() => onPageChange(clampedPage + 1)}
          disabled={clampedPage >= totalPages}
        >
          {t("nextPage")}
        </button>
      </div>
    </div>
  );
};

export interface DailyDetailTableProps {
  title: string;
  rows: DailyUsageSummaryDTO[];
  timeZone: string;
  eyebrow: string;
  relayProviders?: PricingProviderDTO[];
}

function modelIdentity(model: string): string {
  return model.trim().toLowerCase();
}

export function relayCostCny(
  totals: UsageTotalsDTO,
  model: string,
  provider: PricingProviderDTO,
  officialProvider?: PricingProviderDTO
): number | null {
  const ratio = provider.rechargeRatioUsdPerRmb;
  const rates =
    provider.modelPrices?.find((price) => modelIdentity(price.model) === modelIdentity(model))?.rates ??
    officialProvider?.modelPrices?.find((price) => modelIdentity(price.model) === modelIdentity(model))?.rates;

  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0 || !rates) {
    return null;
  }

  const inputTokens = Math.max(totals.inputTokens, 0);
  const cacheReadTokens = Math.min(Math.max(totals.cachedInputTokens, 0), inputTokens);
  const remainingInputTokens = inputTokens - cacheReadTokens;
  const cacheCreationTokens = Math.min(
    Math.max(totals.cacheCreationInputTokens, 0),
    remainingInputTokens
  );
  const regularInputTokens = remainingInputTokens - cacheCreationTokens;
  const multiplier = provider.multiplier ?? 1;
  const costUsd =
    ((regularInputTokens / 1_000_000) * rates.inputUsdPerMillion +
    (cacheReadTokens / 1_000_000) * rates.cacheReadUsdPerMillion +
    (cacheCreationTokens / 1_000_000) * rates.cacheCreationUsdPerMillion +
    (Math.max(totals.outputTokens, 0) / 1_000_000) * rates.outputUsdPerMillion) * multiplier;

  return costUsd / ratio;
}

function relayCostsForModels(
  models: ModelUsageBreakdownDTO[],
  provider: PricingProviderDTO,
  officialProvider?: PricingProviderDTO
): number | null {
  let total = 0;

  for (const model of models) {
    const cost = relayCostCny(model.totals, model.model, provider, officialProvider);
    if (cost === null) {
      return null;
    }
    total += cost;
  }

  return total;
}

export const DailyDetailTable: React.FC<DailyDetailTableProps> = ({
  title,
  rows,
  timeZone,
  eyebrow,
  relayProviders
}) => {
  const { t } = useTranslation();
  const { locale, dashboard } = useApp();
  const officialProvider = dashboard?.meta.pricingProviders?.find((p) => p.kind === "official");
  const totals = sumTotals(rows);
  const showRelayPrices = relayProviders !== undefined;
  const displayedRelayProviders = relayProviders ?? [];
  const relayTotals = displayedRelayProviders.map((provider) =>
    relayCostsForModels(rows.flatMap((row) => row.models), provider, officialProvider)
  );

  const flatRows = rows.flatMap((row) => {
    const dateLabel = formatDateLabel(row.dateKey, timeZone, locale);
    const rowSpan = row.models.length + 1;

    if (row.models.length === 0) {
      return [
        {
          key: `${row.dateKey}-empty`,
          dateLabel,
          rowSpan: 1,
          showGroupCell: true,
          modelLabel: t("noData"),
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            costUSD: 0
          },
          isSubtotal: false,
          relayCosts: displayedRelayProviders.map(() => 0)
        }
      ];
    }

    const modelRows = row.models.map((model, index) => ({
      key: `${row.dateKey}-${model.model}-${index}`,
      dateLabel,
      rowSpan,
      showGroupCell: index === 0,
      modelLabel: formatModelLabel(model.model, model.isFallback, locale),
      totals: model.totals,
      isSubtotal: false,
      relayCosts: displayedRelayProviders.map((provider) =>
        relayCostCny(model.totals, model.model, provider, officialProvider)
      )
    }));

    modelRows.push({
      key: `${row.dateKey}-subtotal`,
      dateLabel,
      rowSpan,
      showGroupCell: false,
      modelLabel: t("subtotalLabel"),
      totals: row.totals,
      isSubtotal: true,
      relayCosts: displayedRelayProviders.map((provider) =>
        relayCostsForModels(row.models, provider, officialProvider)
      )
    });

    return modelRows;
  });

  return (
    <section className="table-panel panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="table-scroll">
        <table className="usage-table daily-detail-table">
          <colgroup>
            <col className="daily-detail-col-date" />
            <col className="daily-detail-col-model" />
            <col className="daily-detail-col-requests" />
            <col className="daily-detail-col-metric" />
            <col className="daily-detail-col-metric" />
            <col className="daily-detail-col-metric" />
            <col className="daily-detail-col-metric" />
            <col className="daily-detail-col-metric" />
            {showRelayPrices ? (
              displayedRelayProviders.map((provider) => (
                <col key={provider.id} className="daily-detail-col-relay-cost" />
              ))
            ) : (
              <col className="daily-detail-col-model-cost" />
            )}
          </colgroup>
          <thead>
            <tr>
              <th>{t("date")}</th>
              <th>{t("model")}</th>
              <th>{t("requests")}</th>
              <th>{t("input")}</th>
              <th>{t("output")}</th>
              <th>{t("cachedInput")}</th>
              <th>{t("cacheCreationInput")}</th>
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
            {flatRows.map((row) => (
              <tr
                key={row.key}
                className={`${row.showGroupCell ? "daily-detail-group-start" : ""} ${
                  row.isSubtotal ? "daily-detail-subtotal-row" : ""
                }`}
              >
                {row.showGroupCell && (
                  <td className="label-cell daily-detail-date" rowSpan={row.rowSpan}>
                    {row.dateLabel}
                  </td>
                )}
                <td className={`daily-detail-model ${row.isSubtotal ? "daily-detail-subtotal-label" : ""}`}>
                  {row.modelLabel}
                </td>
                <td>
                  <span className="metric-align">
                    <span className="metric-num">{formatInteger(row.totals.requestCount, locale)}</span>
                    <span className="metric-unit" />
                  </span>
                </td>
                <td>
                  <AlignedTokenCount value={nonCachedInputTokens(row.totals)} />
                </td>
                <td>
                  <AlignedTokenCount value={row.totals.outputTokens} />
                </td>
                <td>
                  <AlignedTokenCount value={row.totals.cachedInputTokens} />
                </td>
                <td>
                  <AlignedTokenCount value={row.totals.cacheCreationInputTokens} />
                </td>
                <td className="daily-detail-total-metric">
                  <AlignedTokenCount value={row.totals.totalTokens} />
                </td>
                {showRelayPrices ? (
                  displayedRelayProviders.map((provider, index) => (
                    <td key={provider.id} className="cost-cell daily-detail-relay-cost-cell">
                      {row.relayCosts[index] === null ? <span className="muted">—</span> : formatCny(row.relayCosts[index], locale)}
                    </td>
                  ))
                ) : (
                  <td className="cost-cell daily-detail-model-cost-cell">{formatCurrency(row.totals.costUSD, locale)}</td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="summary-row">
              <td colSpan={2}>{t("totalLabel")}</td>
              <td>
                <span className="metric-align">
                  <span className="metric-num">{formatInteger(totals.requestCount, locale)}</span>
                  <span className="metric-unit" />
                </span>
              </td>
              <td>
                <AlignedTokenCount value={nonCachedInputTokens(totals)} />
              </td>
              <td>
                <AlignedTokenCount value={totals.outputTokens} />
              </td>
              <td>
                <AlignedTokenCount value={totals.cachedInputTokens} />
              </td>
              <td>
                <AlignedTokenCount value={totals.cacheCreationInputTokens} />
              </td>
              <td className="daily-detail-total-metric">
                <AlignedTokenCount value={totals.totalTokens} />
              </td>
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
          </tfoot>
        </table>
      </div>
    </section>
  );
};
