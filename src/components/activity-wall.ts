import type { DailyUsageSummaryDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
import type { ActivityWallCell } from "../types";
import {
  activityMonthLabel,
  dateFromDateKey,
  escapeHtml,
  formatCalendarDate,
  formatInteger,
  formatTokenCount
} from "../utils/format";

export function activityLevelThresholds(rows: DailyUsageSummaryDTO[]): [number, number, number] {
  const positiveTotals = rows
    .map((row) => row.totals.totalTokens)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (positiveTotals.length === 0) {
    return [0, 0, 0];
  }

  const pick = (ratio: number): number => positiveTotals[Math.max(Math.ceil(positiveTotals.length * ratio) - 1, 0)];
  return [pick(0.25), pick(0.5), pick(0.75)];
}

export function activityLevel(totalTokens: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (totalTokens <= 0) {
    return 0;
  }

  if (totalTokens <= thresholds[0]) {
    return 1;
  }

  if (totalTokens <= thresholds[1]) {
    return 2;
  }

  if (totalTokens <= thresholds[2]) {
    return 3;
  }

  return 4;
}

export function buildActivityWall(
  rows: DailyUsageSummaryDTO[],
  locale: Locale
): {
  activeDays: number;
  totalTokens: number;
  monthLabels: string[];
  weeks: ActivityWallCell[][];
} {
  const ordered = [...rows].sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  if (ordered.length === 0) {
    return {
      activeDays: 0,
      totalTokens: 0,
      monthLabels: [],
      weeks: []
    };
  }

  const thresholds = activityLevelThresholds(ordered);
  const leadingBlankCount = dateFromDateKey(ordered[0].dateKey).getUTCDay();
  const trailingBlankCount = Math.max(6 - dateFromDateKey(ordered[ordered.length - 1].dateKey).getUTCDay(), 0);
  const cells: ActivityWallCell[] = [];

  for (let index = 0; index < leadingBlankCount; index += 1) {
    cells.push({ dateKey: null, totalTokens: 0, level: 0, title: "" });
  }

  for (const row of ordered) {
    const totalTokens = row.totals.totalTokens;
    const label =
      totalTokens > 0
        ? `${formatCalendarDate(row.dateKey, locale)} · ${t(locale, "total")} ${formatTokenCount(totalTokens, locale)}`
        : `${formatCalendarDate(row.dateKey, locale)} · ${t(locale, "activityWallNoActivity")}`;
    cells.push({
      dateKey: row.dateKey,
      totalTokens,
      level: activityLevel(totalTokens, thresholds),
      title: label
    });
  }

  for (let index = 0; index < trailingBlankCount; index += 1) {
    cells.push({ dateKey: null, totalTokens: 0, level: 0, title: "" });
  }

  const weeks: ActivityWallCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const monthLabels: string[] = [];
  let previousMonthKey = "";
  for (const week of weeks) {
    const firstDatedCell = week.find((cell) => cell.dateKey !== null);
    if (!firstDatedCell?.dateKey) {
      monthLabels.push("");
      continue;
    }

    const monthKey = firstDatedCell.dateKey.slice(0, 7);
    if (monthKey !== previousMonthKey) {
      monthLabels.push(activityMonthLabel(firstDatedCell.dateKey, locale));
      previousMonthKey = monthKey;
    } else {
      monthLabels.push("");
    }
  }

  return {
    activeDays: ordered.filter((row) => row.totals.totalTokens > 0).length,
    totalTokens: ordered.reduce((sum, row) => sum + row.totals.totalTokens, 0),
    monthLabels,
    weeks
  };
}

export function renderActivityWall(timeZone: string, rows: DailyUsageSummaryDTO[], locale: Locale): string {
  void timeZone;
  const { activeDays, totalTokens, monthLabels, weeks } = buildActivityWall(rows, locale);
  const weekdayLabels = ["", t(locale, "weekdayMonShort"), "", t(locale, "weekdayWedShort"), "", t(locale, "weekdayFriShort"), ""];
  const legendMarkup = [0, 1, 2, 3, 4]
    .map((level) => `<span class="activity-wall-cell activity-wall-cell--level-${level}" aria-hidden="true"></span>`)
    .join("");
  const monthMarkup = monthLabels
    .map((label) => `<span class="activity-wall-month">${escapeHtml(label)}</span>`)
    .join("");
  const weekMarkup = weeks
    .map(
      (week) => `
        <div class="activity-wall-week">
          ${week
            .map((cell) =>
              cell.dateKey
                ? `
                    <span
                      class="activity-wall-day"
                      tabindex="0"
                      data-activity-wall-day
                      data-activity-tooltip="${escapeHtml(
                        t(locale, "activityWallTooltipUsage", {
                          date: formatCalendarDate(cell.dateKey, locale),
                          total: formatInteger(cell.totalTokens, locale),
                          compact: formatTokenCount(cell.totalTokens, locale)
                        })
                      )}"
                      aria-label="${escapeHtml(cell.title)}"
                    >
                      <span class="activity-wall-cell activity-wall-cell--level-${cell.level}"></span>
                    </span>
                  `
                : `<span class="activity-wall-cell activity-wall-cell--empty" aria-hidden="true"></span>`
            )
            .join("")}
        </div>
      `
    )
    .join("");

  return `
    <section class="activity-wall panel">
      <div class="section-head activity-wall-head">
        <div>
          <p class="eyebrow">${t(locale, "activityWallEyebrow")}</p>
        </div>
        <p class="activity-wall-summary">${t(locale, "activityWallSummary", {
          count: formatInteger(activeDays, locale),
          total: formatTokenCount(totalTokens, locale)
        })}</p>
      </div>
      <div class="activity-wall-scroll">
        <div
          class="activity-wall-chart"
          role="img"
          aria-label="${escapeHtml(
            t(locale, "activityWallAria", {
              count: formatInteger(activeDays, locale),
              total: formatTokenCount(totalTokens, locale)
            })
          )}"
        >
          <div class="activity-wall-months">
            <span class="activity-wall-month activity-wall-month--legend-spacer"></span>
            ${monthMarkup}
          </div>
          <div class="activity-wall-grid">
            <div class="activity-wall-weekdays" aria-hidden="true">
              ${weekdayLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
            </div>
            <div class="activity-wall-columns">${weekMarkup}</div>
          </div>
        </div>
      </div>
      <div class="activity-wall-footer">
        <p class="activity-wall-copy">${t(locale, "activityWallDescription")}</p>
        <div class="activity-wall-legend" aria-hidden="true">
          <span>${t(locale, "activityWallLegendLess")}</span>
          ${legendMarkup}
          <span>${t(locale, "activityWallLegendMore")}</span>
        </div>
      </div>
    </section>
  `;
}
