import React from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import { UsageTable } from "../components/UsageTable";
import type { PageSourceId } from "../types";

export const MONTHLY_HISTORY_PAGE_SOURCE_ID: PageSourceId = "src/views/MonthlyHistoryView.tsx";

export const MonthlyHistoryView: React.FC = () => {
  const { t } = useTranslation();
  const { dashboard } = useApp();
  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const relayProviders = dashboard?.meta.pricingProviders?.filter(
    (provider) => provider.kind === "relay" && provider.enabled
  ) ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        icon={<ChartNoAxesCombined size={18} />}
        eyebrow={t("navUsage")}
        title={t("navMonthlyHistory")}
        description={t("monthlyHistoryDescription")}
        pageSourceId={MONTHLY_HISTORY_PAGE_SOURCE_ID}
      />
      <UsageTable
        title={t("navMonthlyHistory")}
        rows={dashboard?.monthlyHistory ?? []}
        timeZone={timeZone}
        mode="monthly"
        relayProviders={relayProviders}
      />
    </div>
  );
};
