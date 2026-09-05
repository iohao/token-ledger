import React from "react";
import { ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { AlignedTokenCount } from "./DailyDetailTable";
import type { DailyActualSpendDTO, PricingProviderDTO } from "../dto/dashboard";
import { formatCny, formatCurrency, formatDateLabel, formatInteger } from "../utils/format";
import { getProviderEffectiveCost } from "../views/RelayPricingView";

export function resolveActualSpendProviderPrice(
  item: {
    providerId?: string | null;
    providerName?: string;
    name?: string;
    codexProvider?: string;
    multiplier?: string | number | null;
    rechargeRatioUsdPerRmb?: string | number | null;
    effectiveCost?: number | null;
  },
  pricingProviders?: PricingProviderDTO[]
): number | null {
  if (pricingProviders && pricingProviders.length > 0) {
    const matched =
      (item.providerId ? pricingProviders.find((p) => p.id === item.providerId) : null) ??
      pricingProviders.find(
        (p) =>
          p.name.trim().toLowerCase() === (item.providerName ?? item.name ?? "").trim().toLowerCase()
      ) ??
      (item.codexProvider
        ? pricingProviders.find(
            (p) =>
              p.codexProviderId &&
              p.codexProviderId.trim().toLowerCase() === item.codexProvider!.trim().toLowerCase()
          )
        : null);

    if (matched) {
      return getProviderEffectiveCost(matched);
    }
  }

  if (item.effectiveCost !== undefined && item.effectiveCost !== null) {
    return Number.isFinite(item.effectiveCost) && item.effectiveCost > 0
      ? item.effectiveCost
      : null;
  }

  return getProviderEffectiveCost(item);
}

export function compareActualSpendProviders<
  T extends {
    providerId?: string | null;
    providerName?: string;
    name?: string;
    codexProvider?: string;
    multiplier?: string | number | null;
    rechargeRatioUsdPerRmb?: string | number | null;
    effectiveCost?: number | null;
  }
>(a: T, b: T, pricingProviders?: PricingProviderDTO[]): number {
  const priceA = resolveActualSpendProviderPrice(a, pricingProviders);
  const priceB = resolveActualSpendProviderPrice(b, pricingProviders);

  const nameA = a.providerName ?? a.name ?? "";
  const nameB = b.providerName ?? b.name ?? "";

  // 价格越高的越在后面 (升序: 便宜的在前端，价格越高的越在后面)
  if (priceA !== null && priceB !== null) {
    if (Math.abs(priceA - priceB) > 1e-9) {
      return priceA - priceB;
    }
    return nameA.localeCompare(nameB);
  }

  if (priceA !== null) {
    return -1;
  }
  if (priceB !== null) {
    return 1;
  }

  return nameA.localeCompare(nameB);
}

export interface ActualSpendLedgerProps {
  rows: DailyActualSpendDTO[];
  timeZone: string;
  pricingProviders?: PricingProviderDTO[];
}

export const ActualSpendLedger: React.FC<ActualSpendLedgerProps> = ({
  rows,
  timeZone,
  pricingProviders
}) => {
  const { t } = useTranslation();
  const { locale, dashboard } = useApp();
  const effectivePricingProviders = pricingProviders ?? dashboard?.meta.pricingProviders ?? [];

  const grandTotalCny = rows.reduce((acc, row) => acc + row.totalCostCny, 0);
  const grandTotalUsd = rows.reduce((acc, row) => acc + row.totalCostUsd, 0);
  const grandTotalTokens = rows.reduce((acc, row) => acc + row.totalTokens, 0);
  const grandTotalSessions = rows.reduce((acc, row) => acc + row.sessionCount, 0);

  const providerTotalsMap = new Map<
    string,
    {
      name: string;
      providerId: string | null;
      codexProvider: string;
      costCny: number | null;
      costUsd: number;
      tokens: number;
      sessionCount: number;
      multiplier?: number | null;
      rechargeRatioUsdPerRmb?: number | null;
      effectiveCost?: number | null;
    }
  >();

  for (const row of rows) {
    for (const p of row.providers) {
      const key = p.providerName || p.codexProvider;
      const existing = providerTotalsMap.get(key);
      if (existing) {
        if (p.costCny !== null) {
          existing.costCny = (existing.costCny ?? 0) + p.costCny;
        }
        existing.costUsd += p.costUsd;
        existing.tokens += p.totalTokens;
        existing.sessionCount += p.sessionCount;
        if (!existing.providerId && p.providerId) existing.providerId = p.providerId;
        if (p.effectiveCost !== undefined && p.effectiveCost !== null) existing.effectiveCost = p.effectiveCost;
        if (p.multiplier !== undefined && p.multiplier !== null) existing.multiplier = p.multiplier;
        if (p.rechargeRatioUsdPerRmb !== undefined && p.rechargeRatioUsdPerRmb !== null) existing.rechargeRatioUsdPerRmb = p.rechargeRatioUsdPerRmb;
      } else {
        providerTotalsMap.set(key, {
          name: p.providerName,
          providerId: p.providerId,
          codexProvider: p.codexProvider,
          costCny: p.costCny,
          costUsd: p.costUsd,
          tokens: p.totalTokens,
          sessionCount: p.sessionCount,
          multiplier: p.multiplier,
          rechargeRatioUsdPerRmb: p.rechargeRatioUsdPerRmb,
          effectiveCost: p.effectiveCost
        });
      }
    }
  }

  const providerTotals = Array.from(providerTotalsMap.values()).sort(
    (a, b) => compareActualSpendProviders(a, b, effectivePricingProviders)
  );

  return (
    <section className="table-panel panel actual-spend-section">
      <div className="section-head actual-spend-head">
        <div>
          <p className="eyebrow">{t("actualSpendEyebrow")}</p>
          <div className="actual-spend-title-row">
            <ReceiptText size={18} className="actual-spend-title-icon" />
            <h3>{t("actualSpendTitle")}</h3>
          </div>
          <p className="actual-spend-desc">{t("actualSpendDescription")}</p>
        </div>
      </div>

      {providerTotals.length > 0 && (
        <div className="actual-spend-summary-cards">
          <div className="actual-spend-summary-card actual-spend-summary-primary">
            <span className="actual-spend-card-label">{t("actualSpend7DayTotal")}</span>
            <strong className="actual-spend-card-val">{formatCny(grandTotalCny, locale)}</strong>
            <span className="actual-spend-card-sub">
              {t("actualSpend7DaySub", {
                sessions: formatInteger(grandTotalSessions, locale)
              })}{" "}
              · {t("actualSpendBackendSub", { amount: formatCurrency(grandTotalUsd, locale) })}
            </span>
          </div>
          <div className="actual-spend-chips-wrap">
            {providerTotals.map((pt) => (
              <div key={pt.name} className="actual-spend-chip">
                <span className="actual-spend-chip-name">{pt.name}</span>
                <strong className="actual-spend-chip-amount">
                  {pt.costCny !== null ? formatCny(pt.costCny, locale) : "—"}
                </strong>
                <div className="actual-spend-chip-backend">
                  <span className="actual-spend-chip-backend-tag">{t("actualSpendBackendShort")}</span>
                  <span className="actual-spend-chip-backend-val">{formatCurrency(pt.costUsd, locale)}</span>
                </div>
                <span className="actual-spend-chip-sub">
                  {formatInteger(pt.sessionCount, locale)} {t("sessionsUnit")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="usage-table actual-spend-table">
          <colgroup>
            <col style={{ width: "16%" }} />
            <col style={{ width: "46%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{t("date")}</th>
              <th>{t("actualSpendChannels")}</th>
              <th>{t("requests")}</th>
              <th>{t("totalTokens")}</th>
              <th className="actual-spend-header-right">{t("actualSpendDailyTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const dateLabel = formatDateLabel(row.dateKey, timeZone, locale);
              const hasActivity = row.sessionCount > 0;

              return (
                <tr key={row.dateKey} className={hasActivity ? "actual-spend-row-active" : "actual-spend-row-empty"}>
                  <td className="label-cell actual-spend-date-cell">{dateLabel}</td>
                  <td>
                    {hasActivity ? (
                      <div className="actual-spend-badges-wrap">
                        {[...row.providers]
                          .sort((a, b) => compareActualSpendProviders(a, b, effectivePricingProviders))
                          .map((p) => {
                          const tooltipText = t("actualSpendBadgeTooltip", {
                            provider: p.providerName,
                            cny: p.costCny !== null ? formatCny(p.costCny, locale) : "—",
                            usd: formatCurrency(p.costUsd, locale),
                            sessions: formatInteger(p.sessionCount, locale)
                          });

                          return (
                            <span
                              key={p.codexProvider}
                              className="actual-spend-channel-badge"
                              title={tooltipText}
                            >
                              <span className="channel-badge-name">{p.providerName}</span>
                              <span className="channel-badge-cost">
                                {p.costCny !== null ? formatCny(p.costCny, locale) : "—"}
                              </span>
                              <span className="channel-badge-backend">
                                <span className="channel-badge-backend-tag">{t("actualSpendBackendShort")}</span>
                                <span className="channel-badge-backend-val">{formatCurrency(p.costUsd, locale)}</span>
                              </span>
                              <span className="channel-badge-count">
                                ({formatInteger(p.sessionCount, locale)})
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="metric-align">
                      <span className="metric-num">{formatInteger(row.sessionCount, locale)}</span>
                      <span className="metric-unit" />
                    </span>
                  </td>
                  <td>
                    <AlignedTokenCount value={row.totalTokens} />
                  </td>
                  <td className="cost-cell actual-spend-cell-right">
                    {hasActivity ? (
                      <div className="actual-spend-total-wrap">
                        <strong className="actual-spend-cell-total">{formatCny(row.totalCostCny, locale)}</strong>
                        <span className="actual-spend-cell-backend">
                          {t("actualSpendBackendSub", { amount: formatCurrency(row.totalCostUsd, locale) })}
                        </span>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="summary-row">
              <td>{t("totalLabel")}</td>
              <td>
                <div className="actual-spend-footer-badges">
                  {providerTotals.map((pt) => (
                    <span key={pt.name} className="actual-spend-footer-chip">
                      <span className="actual-spend-footer-chip-name">{pt.name}:</span>{" "}
                      <strong>{pt.costCny !== null ? formatCny(pt.costCny, locale) : "—"}</strong>{" "}
                      <span className="actual-spend-footer-chip-backend">
                        ({t("actualSpendBackendShort")} {formatCurrency(pt.costUsd, locale)})
                      </span>
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <span className="metric-align">
                  <span className="metric-num">{formatInteger(grandTotalSessions, locale)}</span>
                  <span className="metric-unit" />
                </span>
              </td>
              <td>
                <AlignedTokenCount value={grandTotalTokens} />
              </td>
              <td className="cost-cell actual-spend-cell-right">
                <div className="actual-spend-total-wrap">
                  <strong className="actual-spend-grand-total">{formatCny(grandTotalCny, locale)}</strong>
                  <span className="actual-spend-cell-backend">
                    {t("actualSpendBackendSub", { amount: formatCurrency(grandTotalUsd, locale) })}
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
};
