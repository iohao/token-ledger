import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { DailyUsageSummaryDTO } from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import type { ActivityWallCell } from "../types";
import {
  activityMonthLabel,
  dateFromDateKey,
  formatCalendarDate,
  formatInteger,
  formatTokenCount
} from "../utils/format";
import type { Locale } from "../i18n";

export function activityLevelThresholds(rows: DailyUsageSummaryDTO[]): [number, number, number] {
  const positiveTotals = rows
    .map((row) => row.totals.totalTokens)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (positiveTotals.length === 0) {
    return [0, 0, 0];
  }

  const pick = (ratio: number): number =>
    positiveTotals[Math.max(Math.ceil(positiveTotals.length * ratio) - 1, 0)];
  return [pick(0.25), pick(0.5), pick(0.75)];
}

export function activityLevel(
  totalTokens: number,
  thresholds: [number, number, number]
): 0 | 1 | 2 | 3 | 4 {
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
  const trailingBlankCount = Math.max(
    6 - dateFromDateKey(ordered[ordered.length - 1].dateKey).getUTCDay(),
    0
  );
  const cells: ActivityWallCell[] = [];

  for (let index = 0; index < leadingBlankCount; index += 1) {
    cells.push({ dateKey: null, totalTokens: 0, level: 0, title: "" });
  }

  for (const row of ordered) {
    const totalTokens = row.totals.totalTokens;
    const label =
      totalTokens > 0
        ? `${formatCalendarDate(row.dateKey, locale)} · ${locale === "zh-CN" ? "总量" : "Total"} ${formatTokenCount(totalTokens, locale)}`
        : `${formatCalendarDate(row.dateKey, locale)} · ${locale === "zh-CN" ? "无活动" : "No activity"}`;
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

export interface ActivityWallProps {
  rows: DailyUsageSummaryDTO[];
  timeZone: string;
}

export const ActivityWall: React.FC<ActivityWallProps> = ({ rows }) => {
  const { t } = useTranslation();
  const { locale } = useApp();
  const [tooltipState, setTooltipState] = useState<{
    text: string;
    top: number;
    left: number;
    placement: string;
    visible: boolean;
  }>({
    text: "",
    top: 0,
    left: 0,
    placement: "top",
    visible: false
  });

  const { activeDays, totalTokens, monthLabels, weeks } = buildActivityWall(rows, locale);
  const weekdayLabels = ["", t("weekdayMonShort"), "", t("weekdayWedShort"), "", t("weekdayFriShort"), ""];

  const handleMouseEnter = (event: React.SyntheticEvent<HTMLElement>, text: string) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const gap = 10;
    const viewportPadding = 8;
    let top = rect.top - 36 - gap;
    let placement = "top";

    if (top < viewportPadding) {
      top = rect.bottom + gap;
      placement = "bottom";
    }

    let left = rect.left + rect.width / 2 - 120;
    left = Math.min(Math.max(left, viewportPadding), window.innerWidth - 240 - viewportPadding);

    setTooltipState({
      text,
      top,
      left,
      placement,
      visible: true
    });
  };

  const handleMouseLeave = () => {
    setTooltipState((prev) => ({ ...prev, visible: false }));
  };

  useEffect(() => {
    const handleScroll = () => {
      setTooltipState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, []);

  return (
    <section className="activity-wall panel">
      <div className="section-head activity-wall-head">
        <div>
          <p className="eyebrow">{t("activityWallEyebrow")}</p>
        </div>
        <p className="activity-wall-summary">
          {t("activityWallSummary", {
            count: formatInteger(activeDays, locale),
            total: formatTokenCount(totalTokens, locale)
          })}
        </p>
      </div>
      <div className="activity-wall-scroll">
        <div
          className="activity-wall-chart"
          role="img"
          aria-label={t("activityWallAria", {
            count: formatInteger(activeDays, locale),
            total: formatTokenCount(totalTokens, locale)
          })}
        >
          <div className="activity-wall-months">
            <span className="activity-wall-month activity-wall-month--legend-spacer" />
            {monthLabels.map((label, idx) => (
              <span key={idx} className="activity-wall-month">
                {label}
              </span>
            ))}
          </div>
          <div className="activity-wall-grid">
            <div className="activity-wall-weekdays" aria-hidden="true">
              {weekdayLabels.map((label, idx) => (
                <span key={idx}>{label}</span>
              ))}
            </div>
            <div className="activity-wall-columns">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="activity-wall-week">
                  {week.map((cell, cIdx) => {
                    if (!cell.dateKey) {
                      return (
                        <span
                          key={cIdx}
                          className="activity-wall-cell activity-wall-cell--empty"
                          aria-hidden="true"
                        />
                      );
                    }

                    const tooltipText = t("activityWallTooltipUsage", {
                      date: formatCalendarDate(cell.dateKey, locale),
                      total: formatInteger(cell.totalTokens, locale),
                      compact: formatTokenCount(cell.totalTokens, locale)
                    });

                    return (
                      <span
                        key={cIdx}
                        className="activity-wall-day"
                        tabIndex={0}
                        aria-label={cell.title}
                        onMouseEnter={(e) => handleMouseEnter(e, tooltipText)}
                        onMouseLeave={handleMouseLeave}
                        onFocus={(e) => handleMouseEnter(e, tooltipText)}
                        onBlur={handleMouseLeave}
                      >
                        <span className={`activity-wall-cell activity-wall-cell--level-${cell.level}`} />
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="activity-wall-footer">
        <p className="activity-wall-copy">{t("activityWallDescription")}</p>
        <div className="activity-wall-legend" aria-hidden="true">
          <span>{t("activityWallLegendLess")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`activity-wall-cell activity-wall-cell--level-${level}`} aria-hidden="true" />
          ))}
          <span>{t("activityWallLegendMore")}</span>
        </div>
      </div>

      {tooltipState.visible && (
        <div
          className="activity-hover-tooltip"
          data-placement={tooltipState.placement}
          style={{
            position: "fixed",
            top: `${tooltipState.top}px`,
            left: `${tooltipState.left}px`,
            zIndex: 9999
          }}
        >
          {tooltipState.text}
        </div>
      )}
    </section>
  );
};
