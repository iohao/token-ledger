import type { DailyUsageSummaryDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
import {
  escapeHtml,
  formatCurrency,
  formatDateLabel,
  formatInteger,
  formatModelLabel,
  nonCachedInputTokens,
  renderAlignedTokenCount,
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

export function renderDailyDetailTable(
  title: string,
  rows: DailyUsageSummaryDTO[],
  timeZone: string,
  eyebrow: string,
  locale: Locale
): string {
  const totals = sumTotals(rows);
  const flatRows = rows.flatMap((row) => {
    const dateLabel = formatDateLabel(row.dateKey, timeZone, locale);
    const hasMultipleModels = row.models.length > 1;
    const rowSpan = hasMultipleModels ? row.models.length + 1 : Math.max(row.models.length, 1);

    if (row.models.length === 0) {
      return [
        {
          dateLabel,
          rowSpan: 1,
          showGroupCell: true,
          modelLabel: t(locale, "noData"),
          totals: {
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
            costUSD: 0
          },
          dailyCost: 0,
          isSubtotal: false
        }
      ];
    }

    const modelRows = row.models.map((model, index) => ({
      dateLabel,
      rowSpan,
      showGroupCell: index === 0,
      modelLabel: formatModelLabel(model.model, model.isFallback, locale),
      totals: model.totals,
      dailyCost: row.totals.costUSD,
      isSubtotal: false
    }));

    if (hasMultipleModels) {
      modelRows.push({
        dateLabel,
        rowSpan,
        showGroupCell: false,
        modelLabel: t(locale, "subtotalLabel"),
        totals: row.totals,
        dailyCost: row.totals.costUSD,
        isSubtotal: true
      });
    }

    return modelRows;
  });

  const body = flatRows
    .map(
      (row) => `
        <tr class="${row.showGroupCell ? "daily-detail-group-start" : ""} ${row.isSubtotal ? "daily-detail-subtotal-row" : ""}">
          ${
            row.showGroupCell
              ? `<td class="label-cell daily-detail-date" rowspan="${row.rowSpan}">${escapeHtml(row.dateLabel)}</td>`
              : ""
          }
          <td class="daily-detail-model ${row.isSubtotal ? "daily-detail-subtotal-label" : ""}">${escapeHtml(row.modelLabel)}</td>
          <td>${renderAlignedTokenCount(nonCachedInputTokens(row.totals), locale)}</td>
          <td>${renderAlignedTokenCount(row.totals.outputTokens, locale)}</td>
          <td>${renderAlignedTokenCount(row.totals.cachedInputTokens, locale)}</td>
          <td>${renderAlignedTokenCount(row.totals.cacheCreationInputTokens, locale)}</td>
          <td>${renderAlignedTokenCount(row.totals.reasoningOutputTokens, locale)}</td>
          <td class="daily-detail-total-metric">${renderAlignedTokenCount(row.totals.totalTokens, locale)}</td>
          <td class="daily-detail-model-cost-cell">${formatCurrency(row.totals.costUSD, locale)}</td>
          ${
            row.showGroupCell
              ? `<td class="cost-cell daily-detail-total-cost-cell" rowspan="${row.rowSpan}">${formatCurrency(row.dailyCost, locale)}</td>`
              : ""
          }
        </tr>
      `
    )
    .join("");

  return `
    <section class="table-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h3>${title}</h3>
        </div>
      </div>
      <div class="table-scroll">
        <table class="usage-table daily-detail-table">
          <colgroup>
            <col class="daily-detail-col-date" />
            <col class="daily-detail-col-model" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-metric" />
            <col class="daily-detail-col-model-cost" />
            <col class="daily-detail-col-total-cost" />
          </colgroup>
          <thead>
            <tr>
              <th>${t(locale, "date")}</th>
              <th>${t(locale, "model")}</th>
              <th>${t(locale, "input")}</th>
              <th>${t(locale, "output")}</th>
              <th>${t(locale, "cachedInput")}</th>
              <th>${t(locale, "cacheCreationInput")}</th>
              <th>${t(locale, "reasoning")}</th>
              <th>${t(locale, "total")}</th>
              <th class="daily-detail-model-cost-header">${t(locale, "modelCost")}</th>
              <th class="daily-detail-total-cost-header">${t(locale, "totalCost")}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr class="summary-row">
              <td colspan="2">${t(locale, "totalLabel")}</td>
              <td>${renderAlignedTokenCount(nonCachedInputTokens(totals), locale)}</td>
              <td>${renderAlignedTokenCount(totals.outputTokens, locale)}</td>
              <td>${renderAlignedTokenCount(totals.cachedInputTokens, locale)}</td>
              <td>${renderAlignedTokenCount(totals.cacheCreationInputTokens, locale)}</td>
              <td>${renderAlignedTokenCount(totals.reasoningOutputTokens, locale)}</td>
              <td class="daily-detail-total-metric">${renderAlignedTokenCount(totals.totalTokens, locale)}</td>
              <td class="daily-detail-model-cost-cell">${formatCurrency(totals.costUSD, locale)}</td>
              <td class="cost-cell daily-detail-summary-total-cost">${formatCurrency(totals.costUSD, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

export function renderDailyDetailPagination(
  currentPage: number,
  totalRows: number,
  pageSize: number,
  locale: Locale
): string {
  const totalPages = dailyDetailPageCount(totalRows, pageSize);
  if (totalPages <= 1) {
    return "";
  }

  const clampedPage = clampDailyDetailPage(currentPage, totalRows, pageSize);
  const startDay = (clampedPage - 1) * pageSize + 1;
  const endDay = Math.min(clampedPage * pageSize, totalRows);

  return `
    <div class="detail-pagination" aria-label="${t(locale, "dailyUsagePaginationAria")}">
      <p class="detail-pagination-summary">
        ${t(locale, "dailyUsagePageSummary", {
          start: formatInteger(startDay, locale),
          end: formatInteger(endDay, locale),
          total: formatInteger(totalRows, locale)
        })}
      </p>
      <div class="detail-pagination-actions">
        <button
          class="action detail-pagination-button"
          type="button"
          data-daily-detail-page="${clampedPage - 1}"
          ${clampedPage <= 1 ? "disabled" : ""}
        >
          ${t(locale, "previousPage")}
        </button>
        <span class="detail-pagination-indicator">
          ${t(locale, "pageIndicator", {
            current: formatInteger(clampedPage, locale),
            total: formatInteger(totalPages, locale)
          })}
        </span>
        <button
          class="action detail-pagination-button"
          type="button"
          data-daily-detail-page="${clampedPage + 1}"
          ${clampedPage >= totalPages ? "disabled" : ""}
        >
          ${t(locale, "nextPage")}
        </button>
      </div>
    </div>
  `;
}
