import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, CalendarDays, CalendarRange, Coins, TrendingUp } from "lucide-react";
import type {
  PricingComparisonDTO,
  PricingProviderDTO,
  UsageSummaryDTO
} from "../dto/dashboard";
import { useApp } from "../context/AppContext";
import { AnimatedNumber } from "./AnimatedNumber";
import {
  formatCny,
  formatInteger,
  formatPriceDiffPercent,
  formatTokenCount,
  nonCachedInputTokens,
  periodLabel
} from "../utils/format";

export interface SummaryCardProps {
  summary: UsageSummaryDTO;
  pricingProviders?: PricingProviderDTO[];
  comparison?: PricingComparisonDTO;
}

const renderPeriodIcon = (period: UsageSummaryDTO["period"]) => {
  switch (period) {
    case "today":
      return <Calendar size={13} className="summary-kicker-icon" aria-hidden="true" />;
    case "last7Days":
      return <CalendarDays size={13} className="summary-kicker-icon" aria-hidden="true" />;
    case "monthToDate":
      return <CalendarRange size={13} className="summary-kicker-icon" aria-hidden="true" />;
  }
};

export const SummaryCard: React.FC<SummaryCardProps> = ({
  summary,
  pricingProviders,
  comparison
}) => {
  const { t } = useTranslation();
  const { dashboard, locale, isSyncing, setActiveTab } = useApp();

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

  const providers = pricingProviders ?? dashboard?.meta.pricingProviders ?? [];
  const activeComparison =
    comparison ??
    dashboard?.providerCostComparisons.find((item) => item.period === summary.period);

  const comparisonRows = useMemo(() => {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    return (activeComparison?.providers ?? [])
      .map((row) => ({ ...row, provider: byId.get(row.providerId) }))
      .filter(
        (row): row is typeof row & { provider: PricingProviderDTO } =>
          row.provider !== undefined && row.provider.kind === "relay"
      )
      .sort((left, right) => {
        if (left.isComplete !== right.isComplete) {
          return left.isComplete ? -1 : 1;
        }
        return (
          (left.costCny ?? Number.POSITIVE_INFINITY) -
          (right.costCny ?? Number.POSITIVE_INFINITY)
        );
      });
  }, [activeComparison?.providers, providers]);

  const completeRows = comparisonRows.filter(
    (row) => row.isComplete && row.costCny !== null
  );
  const lowestProviderId =
    completeRows.length > 1 ? completeRows[0]?.providerId : null;
  const lowestCost =
    completeRows.length > 1 ? (completeRows[0]?.costCny ?? null) : null;

  return (
    <article className={`summary-card panel${isHighlighting ? " is-updated" : ""}`}>
      <div className="summary-header">
        <div className="summary-kicker">
          {renderPeriodIcon(summary.period)}
          <span>{periodLabel(summary.period, locale)}</span>
        </div>
        <div className="summary-total">
          <span className="summary-total-label">{t("summaryTotal")}</span>
          <strong className="summary-total-value">
            <AnimatedNumber
              value={summary.totals.totalTokens}
              formatter={(val) => formatTokenCount(Math.round(val), locale)}
            />
          </strong>
        </div>
      </div>
      <div className="summary-inline">
        {/* Row 1: 左(2字) 输入 / 右(4字) 请求次数 */}
        <span className="summary-inline-item">
          <span className="summary-inline-label">{t("input")}:</span>{" "}
          <span className="summary-inline-value">
            <AnimatedNumber
              value={nonCachedInputTokens(summary.totals)}
              formatter={(val) => formatTokenCount(Math.round(val), locale)}
            />
          </span>
        </span>
        <span className="summary-inline-item">
          <span className="summary-inline-label">{t("requests")}:</span>{" "}
          <span className="summary-inline-value">
            <AnimatedNumber
              value={summary.totals.requestCount}
              formatter={(val) => formatInteger(Math.round(val), locale)}
            />
          </span>
        </span>

        {/* Row 2: 左(2字) 输出 / 右(4字) 缓存读取 */}
        <span className="summary-inline-item">
          <span className="summary-inline-label">{t("output")}:</span>{" "}
          <span className="summary-inline-value">
            <AnimatedNumber
              value={summary.totals.outputTokens}
              formatter={(val) => formatTokenCount(Math.round(val), locale)}
            />
          </span>
        </span>
        <span className="summary-inline-item">
          <span className="summary-inline-label">{t("cachedInput")}:</span>{" "}
          <span className="summary-inline-value">
            <AnimatedNumber
              value={summary.totals.cachedInputTokens}
              formatter={(val) => formatTokenCount(Math.round(val), locale)}
            />
          </span>
        </span>

        {/* Row 3 (optional): 缓存创建 (4字) */}
        {summary.totals.cacheCreationInputTokens > 0 && (
          <span className="summary-inline-item summary-inline-extra">
            <span className="summary-inline-label">{t("cacheCreationInput")}:</span>{" "}
            <span className="summary-inline-value">
              <AnimatedNumber
                value={summary.totals.cacheCreationInputTokens}
                formatter={(val) => formatTokenCount(Math.round(val), locale)}
              />
            </span>
          </span>
        )}
      </div>

      <div className="summary-providers-section">
        <div className="summary-providers-header">
          <div className="summary-providers-title-group">
            <Coins size={12} className="summary-providers-icon" />
            <span className="summary-providers-title">{t("providerCosts")}</span>
            {comparisonRows.length > 0 && (
              <span className="summary-providers-count">
                {comparisonRows.length}
              </span>
            )}
          </div>
        </div>

        <div className="summary-provider-list">
          {comparisonRows.length === 0 ? (
            <div
              className="summary-provider-empty"
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("relayPricing")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setActiveTab("relayPricing");
                }
              }}
            >
              <span>{t("noRelayProvidersConfigured")}</span>
              <span className="summary-provider-empty-action">
                {t("manageRelayProviders")} &rarr;
              </span>
            </div>
          ) : (
            comparisonRows.map((row) => {
              const isLowest = row.providerId === lowestProviderId;
              const diffPercent =
                !isLowest && lowestCost !== null && row.costCny !== null
                  ? formatPriceDiffPercent(row.costCny, lowestCost)
                  : null;

              return (
                <div
                  key={row.providerId}
                  className="summary-provider-row"
                >
                  <div className="summary-provider-identity">
                    <span
                      className={`summary-provider-dot${isLowest ? " is-lowest" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="summary-provider-name" title={row.provider.name}>
                      {row.provider.name}
                    </span>
                    {isLowest && (
                      <span className="summary-provider-badge is-lowest">
                        {t("lowestTag")}
                      </span>
                    )}
                  </div>
                  <div className="summary-provider-cost">
                    {row.isComplete && row.costCny !== null ? (
                      <strong
                        className={`summary-provider-cny${isLowest ? " is-lowest" : ""}`}
                      >
                        <AnimatedNumber
                          value={row.costCny}
                          formatter={(val) => formatCny(val, locale)}
                        />
                      </strong>
                    ) : (
                      <span
                        className="summary-provider-incomplete"
                        title={
                          row.unpricedModels.length > 0
                            ? t("relayPricingUnpriced", {
                                models: row.unpricedModels.join(", ")
                              })
                            : t("relayPricingIncomplete")
                        }
                      >
                        —
                      </span>
                    )}
                    {diffPercent !== null ? (
                      <span className="summary-provider-diff">
                        <TrendingUp size={10} className="summary-provider-diff-icon" aria-hidden="true" />
                        <span>{diffPercent}</span>
                      </span>
                    ) : (
                      <span className="summary-provider-diff is-empty" aria-hidden="true" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
};
