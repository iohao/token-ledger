import type { DailyUsageSummaryDTO, DashboardPayloadDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
import {
  escapeHtml,
  formatCurrency,
  formatDateLabel,
  formatModelLabel,
  formatMonthLabel,
  formatTokenCount,
  nonCachedInputTokens,
  sumTotals
} from "../utils/format";

export function renderUsageTable(
  title: string,
  rows: DashboardPayloadDTO["dailyHistory"] | DashboardPayloadDTO["monthlyHistory"] | DailyUsageSummaryDTO[],
  timeZone: string,
  mode: "daily" | "monthly",
  locale: Locale
): string {
  const totals = sumTotals(rows);
  const isDaily = mode === "daily";
  const body = rows
    .map((row) => {
      const label = isDaily
        ? formatDateLabel((row as DailyUsageSummaryDTO).dateKey, timeZone, locale)
        : formatMonthLabel((row as DashboardPayloadDTO["monthlyHistory"][number]).monthKey, timeZone, locale);
      const models =
        row.models.length > 0
          ? `<ul class="model-list">${row.models
              .map(
                (model) =>
                  `<li>${escapeHtml(formatModelLabel(model.model, model.isFallback, locale))}</li>`
              )
              .join("")}</ul>`
          : `<span class="muted">${t(locale, "noData")}</span>`;

      return `
        <tr>
          <td class="label-cell">${label}</td>
          <td>${models}</td>
          <td>${formatTokenCount(nonCachedInputTokens(row.totals), locale)}</td>
          <td>${formatTokenCount(row.totals.outputTokens, locale)}</td>
          <td>${formatTokenCount(row.totals.reasoningOutputTokens, locale)}</td>
          <td>${formatTokenCount(row.totals.cachedInputTokens, locale)}</td>
          <td>${formatTokenCount(row.totals.cacheCreationInputTokens, locale)}</td>
          <td>${formatTokenCount(row.totals.totalTokens, locale)}</td>
          <td class="cost-cell">${formatCurrency(row.totals.costUSD, locale)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="table-panel panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${isDaily ? t(locale, "dailySummaryEyebrow") : t(locale, "historySummaryEyebrow")}</p>
          <h3>${title}</h3>
        </div>
      </div>
      <div class="table-scroll">
        <table class="usage-table">
          <thead>
            <tr>
              <th>${isDaily ? t(locale, "date") : t(locale, "month")}</th>
              <th>${t(locale, "model")}</th>
              <th>${t(locale, "input")}</th>
              <th>${t(locale, "output")}</th>
              <th>${t(locale, "reasoning")}</th>
              <th>${t(locale, "cachedInput")}</th>
              <th>${t(locale, "cacheCreationInput")}</th>
              <th>${t(locale, "total")}</th>
              <th>${t(locale, "cost")}</th>
            </tr>
          </thead>
          <tbody>
            ${body}
            <tr class="total-row">
              <td>${t(locale, "totalLabel")}</td>
              <td></td>
              <td>${formatTokenCount(nonCachedInputTokens(totals), locale)}</td>
              <td>${formatTokenCount(totals.outputTokens, locale)}</td>
              <td>${formatTokenCount(totals.reasoningOutputTokens, locale)}</td>
              <td>${formatTokenCount(totals.cachedInputTokens, locale)}</td>
              <td>${formatTokenCount(totals.cacheCreationInputTokens, locale)}</td>
              <td>${formatTokenCount(totals.totalTokens, locale)}</td>
              <td class="cost-cell">${formatCurrency(totals.costUSD, locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}
