import React from "react";
import { useTranslation } from "react-i18next";
import type { UsageSummaryDTO } from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import { formatCurrency, formatTokenCount, nonCachedInputTokens, periodLabel } from "../utils/format";

export interface SummaryCardProps {
  summary: UsageSummaryDTO;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ summary }) => {
  const { t } = useTranslation();
  const { locale } = useApp();

  return (
    <article className="summary-card panel">
      <p className="summary-kicker">{periodLabel(summary.period, locale)}</p>
      <div className="summary-total">
        <span>{t("summaryTotal")}</span>
        <strong>{formatTokenCount(summary.totals.totalTokens, locale)}</strong>
      </div>
      <div className="summary-inline">
        <span>
          {t("input")}: {formatTokenCount(nonCachedInputTokens(summary.totals), locale)}
        </span>
        <span>
          {t("output")}: {formatTokenCount(summary.totals.outputTokens, locale)}
        </span>
        <span>
          {t("cachedInput")}: {formatTokenCount(summary.totals.cachedInputTokens, locale)}
        </span>
        <span>
          {t("reasoning")}: {formatTokenCount(summary.totals.reasoningOutputTokens, locale)}
        </span>
        <span className="summary-cost-inline">
          {t("cost")}: {formatCurrency(summary.totals.costUSD, locale)}
        </span>
      </div>
    </article>
  );
};
