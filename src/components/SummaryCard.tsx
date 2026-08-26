import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
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
          <span className="summary-providers-title">{t("providerCosts")}</span>
          <button
            type="button"
            className="summary-providers-action"
            onClick={() => setActiveTab("relayPricing")}
            title={t("navRelayPricing")}
          >
            <span>{t("manageRelayProviders")}</span>
            <ChevronRight size={12} />
          </button>
        </div>

        <div className="summary-provider-list">
          {comparisonRows.length === 0 ? (
            <div className="summary-provider-empty">
              <span>{t("noRelayProvidersConfigured")}</span>
            </div>
          ) : (
            comparisonRows.map((row) => {
              const isLowest = row.providerId === lowestProviderId;

              return (
                <div key={row.providerId} className="summary-provider-row">
                  <div className="summary-provider-identity">
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
                      <strong className="summary-provider-cny">
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
