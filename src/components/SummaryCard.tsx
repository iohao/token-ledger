import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageSummaryDTO } from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import { AnimatedNumber } from "./AnimatedNumber";
import {
  formatCurrency,
  formatInteger,
  formatTokenCount,
  nonCachedInputTokens,
  periodLabel
} from "../utils/format";

export interface SummaryCardProps {
  summary: UsageSummaryDTO;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ summary }) => {
  const { t } = useTranslation();
  const { locale, isSyncing } = useApp();

  const prevSyncingRef = useRef(isSyncing);
  const [isHighlighting, setIsHighlighting] = useState(false);

  useEffect(() => {
    if (prevSyncingRef.current && !isSyncing) {
      setIsHighlighting(true);
      const timer = window.setTimeout(() => setIsHighlighting(false), 1200);
      return () => window.clearTimeout(timer);
    }
    prevSyncingRef.current = isSyncing;
  }, [isSyncing]);

  return (
    <article className={`summary-card panel${isHighlighting ? " is-updated" : ""}`}>
      <p className="summary-kicker">{periodLabel(summary.period, locale)}</p>
      <div className="summary-total">
        <span>{t("summaryTotal")}</span>
        <strong>
          <AnimatedNumber
            value={summary.totals.totalTokens}
            formatter={(val) => formatTokenCount(Math.round(val), locale)}
          />
        </strong>
      </div>
      <div className="summary-inline">
        <span>
          {t("requests")}:{" "}
          <AnimatedNumber
            value={summary.totals.requestCount}
            formatter={(val) => formatInteger(Math.round(val), locale)}
          />
        </span>
        <span>
          {t("input")}:{" "}
          <AnimatedNumber
            value={nonCachedInputTokens(summary.totals)}
            formatter={(val) => formatTokenCount(Math.round(val), locale)}
          />
        </span>
        <span>
          {t("output")}:{" "}
          <AnimatedNumber
            value={summary.totals.outputTokens}
            formatter={(val) => formatTokenCount(Math.round(val), locale)}
          />
        </span>
        <span>
          {t("cachedInput")}:{" "}
          <AnimatedNumber
            value={summary.totals.cachedInputTokens}
            formatter={(val) => formatTokenCount(Math.round(val), locale)}
          />
        </span>
        <span>
          {t("reasoning")}:{" "}
          <AnimatedNumber
            value={summary.totals.reasoningOutputTokens}
            formatter={(val) => formatTokenCount(Math.round(val), locale)}
          />
        </span>
        <span className="summary-cost-inline">
          {t("cost")}:{" "}
          <AnimatedNumber
            value={summary.totals.costUSD}
            formatter={(val) => formatCurrency(val, locale)}
          />
        </span>
      </div>
    </article>
  );
};
