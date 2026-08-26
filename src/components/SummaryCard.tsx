import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
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
        {summary.totals.cacheCreationInputTokens > 0 && (
          <span>
            {t("cacheCreationInput")}:{" "}
            <AnimatedNumber
              value={summary.totals.cacheCreationInputTokens}
              formatter={(val) => formatTokenCount(Math.round(val), locale)}
            />
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
                      <>
                        <strong
                          className={`summary-provider-cny${isLowest ? " is-lowest" : ""}`}
                        >
                          <AnimatedNumber
                            value={row.costCny}
                            formatter={(val) => formatCny(val, locale)}
                          />
                        </strong>
                        {diffPercent !== null && (
                          <span className="summary-provider-diff">
                            {diffPercent}
                          </span>
                        )}
                      </>
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
