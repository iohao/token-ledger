import type { DailyUsageSummaryDTO, DashboardPayloadDTO, UsageSummaryDTO, UsageTotalsDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
import { ENGLISH_MONTH_LABELS } from "../types";

const numberFormatterCache = new Map<Locale, Intl.NumberFormat>();
const currencyFormatterCache = new Map<Locale, Intl.NumberFormat>();
const cnyCurrencyFormatterCache = new Map<Locale, Intl.NumberFormat>();
const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateInputFormatterCache = new Map<string, Intl.DateTimeFormat>();
const calendarDateFormatterCache = new Map<Locale, Intl.DateTimeFormat>();

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function iconMarkup(name: string, className = "ui-icon"): string {
  return `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
}

export function localeNumberFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = numberFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatterCache.set(locale, formatter);
  }
  return formatter;
}

export function localeCurrencyFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = currencyFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      currencyDisplay: locale === "zh-CN" ? "narrowSymbol" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    currencyFormatterCache.set(locale, formatter);
  }
  return formatter;
}

export function localeCnyFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = cnyCurrencyFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CNY",
      currencyDisplay: locale === "zh-CN" ? "narrowSymbol" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    cnyCurrencyFormatterCache.set(locale, formatter);
  }
  return formatter;
}

export function formatCny(value: number, locale: Locale): string {
  return localeCnyFormatter(locale).format(value);
}

export function formatPriceDiffPercent(cost: number, lowestCost: number): string | null {
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(lowestCost) ||
    lowestCost <= 0 ||
    cost <= 0 ||
    cost <= lowestCost
  ) {
    return null;
  }
  const diffPercent = ((cost - lowestCost) / lowestCost) * 100;
  const rounded = Number(diffPercent.toFixed(1));
  if (rounded <= 0) {
    return null;
  }
  if (rounded % 1 === 0) {
    return `${rounded.toFixed(0)}%`;
  }
  return `${rounded.toFixed(1)}%`;
}

export function formatInteger(value: number, locale: Locale): string {
  return localeNumberFormatter(locale).format(value);
}

export function formatTokenCount(value: number, locale: Locale): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    const scaled = value / 1_000_000_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}B`;
  }

  if (absolute >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)}K`;
  }

  return formatInteger(value, locale);
}

export function renderAlignedTokenCount(value: number, locale: Locale): string {
  const formatted = formatTokenCount(value, locale);
  const match = formatted.match(/^(-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)([KMB])?$/);

  if (!match) {
    return `<span class="metric-align"><span class="metric-num">${escapeHtml(formatted)}</span><span class="metric-unit"></span></span>`;
  }

  const [, numberPart, unitPart = ""] = match;
  return `<span class="metric-align"><span class="metric-num">${numberPart}</span><span class="metric-unit">${unitPart}</span></span>`;
}

export function nonCachedInputTokens(totals: UsageTotalsDTO): number {
  return Math.max(totals.inputTokens - totals.cachedInputTokens - totals.cacheCreationInputTokens, 0);
}

export function formatPricingInput(value: number): string {
  return value.toFixed(4);
}

export function formatCurrency(value: number, locale: Locale): string {
  return localeCurrencyFormatter(locale).format(value);
}

export function formatByteCount(value: number, locale: Locale): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} GB`;
  }

  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} MB`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)} KB`;
  }

  return `${formatInteger(value, locale)} B`;
}

export function formatDateLabel(dateKey: string, timeZone: string, locale: Locale): string {
  void timeZone;
  const [, month = "01", day = "01"] = dateKey.split("-");
  return locale === "en-US" ? `${month}/${day}` : `${month}-${day}`;
}

export function formatMonthLabel(monthKey: string, timeZone: string, locale: Locale): string {
  void timeZone;
  if (locale === "en-US") {
    const [year = "0000", month = "01"] = monthKey.split("-");
    return `${month}/${year}`;
  }

  return monthKey;
}

export function dateFromDateKey(dateKey: string): Date {
  const [year = "0000", month = "01", day = "01"] = dateKey.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

export function formatCalendarDate(dateKey: string, locale: Locale): string {
  let formatter = calendarDateFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    calendarDateFormatterCache.set(locale, formatter);
  }

  return formatter.format(dateFromDateKey(dateKey));
}

export function activityMonthLabel(dateKey: string, locale: Locale): string {
  const month = Number(dateKey.slice(5, 7));
  return locale === "en-US" ? ENGLISH_MONTH_LABELS[month - 1] : `${month}月`;
}

export function formatTimestamp(value: string | null, timeZone: string, locale: Locale): string {
  if (!value) {
    return t(locale, "notSyncedYet");
  }

  const cacheKey = `${locale}:${timeZone}`;
  let formatter = timestampFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    timestampFormatterCache.set(cacheKey, formatter);
  }

  return formatter.format(new Date(value));
}

export function formatDateInputValue(date: Date, timeZone: string): string {
  let formatter = dateInputFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dateInputFormatterCache.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatCountdown(valueMs: number): string {
  const totalSeconds = Math.max(Math.ceil(valueMs / 1_000), 0);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function dateRangeDayCount(startDate: string, endDate: string): number {
  const startValue = new Date(`${startDate}T00:00:00Z`).getTime();
  const endValue = new Date(`${endDate}T00:00:00Z`).getTime();
  const dayMs = 24 * 60 * 60 * 1_000;
  return Math.floor((endValue - startValue) / dayMs) + 1;
}

export function formatModelLabel(model: string, isFallback: boolean, locale: Locale): string {
  return `${model}${isFallback ? t(locale, "fallbackSuffix") : ""}`;
}

export function sumTotals(rows: Array<{ totals: UsageTotalsDTO }>): UsageTotalsDTO {
  return rows.reduce<UsageTotalsDTO>(
    (totals, row) => ({
      inputTokens: totals.inputTokens + row.totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + row.totals.cachedInputTokens,
      cacheCreationInputTokens:
        totals.cacheCreationInputTokens + row.totals.cacheCreationInputTokens,
      outputTokens: totals.outputTokens + row.totals.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens + row.totals.reasoningOutputTokens,
      totalTokens: totals.totalTokens + row.totals.totalTokens,
      requestCount: totals.requestCount + (row.totals.requestCount ?? 0),
      costUSD: totals.costUSD + row.totals.costUSD
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      costUSD: 0
    }
  );
}

export function periodLabel(period: UsageSummaryDTO["period"], locale: Locale): string {
  switch (period) {
    case "today":
      return t(locale, "periodToday");
    case "last7Days":
      return t(locale, "periodLast7Days");
    case "monthToDate":
      return t(locale, "periodMonthToDate");
  }
}

export function statusLabel(value: DashboardPayloadDTO["status"]["state"], locale: Locale): string {
  switch (value) {
    case "idle":
      return t(locale, "statusIdle");
    case "syncing":
      return t(locale, "statusSyncing");
    case "success":
      return t(locale, "statusSuccess");
    case "failed":
      return t(locale, "statusFailed");
  }
}

export function statusTone(value: DashboardPayloadDTO["status"]["state"]): string {
  switch (value) {
    case "success":
      return "good";
    case "failed":
      return "bad";
    case "syncing":
      return "warm";
    case "idle":
      return "neutral";
  }
}
