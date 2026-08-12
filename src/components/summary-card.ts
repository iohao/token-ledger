import type { UsageSummaryDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
import { formatCurrency, formatTokenCount, nonCachedInputTokens, periodLabel } from "../utils/format";

export function renderSummaryCard(summary: UsageSummaryDTO, timeZone: string, locale: Locale): string {
  void timeZone;
  return `
    <article class="summary-card panel">
      <p class="summary-kicker">${periodLabel(summary.period, locale)}</p>
      <div class="summary-total">
        <span>${t(locale, "summaryTotal")}</span>
        <strong>${formatTokenCount(summary.totals.totalTokens, locale)}</strong>
      </div>
      <div class="summary-inline">
        <span>${t(locale, "input")}: ${formatTokenCount(nonCachedInputTokens(summary.totals), locale)}</span>
        <span>${t(locale, "output")}: ${formatTokenCount(summary.totals.outputTokens, locale)}</span>
        <span>${t(locale, "cachedInput")}: ${formatTokenCount(summary.totals.cachedInputTokens, locale)}</span>
        <span>${t(locale, "reasoning")}: ${formatTokenCount(summary.totals.reasoningOutputTokens, locale)}</span>
        <span class="summary-cost-inline">${t(locale, "cost")}: ${formatCurrency(summary.totals.costUSD, locale)}</span>
      </div>
    </article>
  `;
}
