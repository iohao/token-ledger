import React from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "./context/AppContext";
import { Sidebar } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { OverviewView } from "./views/OverviewView";
import { MonthlyHistoryView } from "./views/MonthlyHistoryView";
import { MonthlyDetailView } from "./views/MonthlyDetailView";
import { DailyDetailView } from "./views/DailyDetailView";
import { SettingsView } from "./views/SettingsView";
import { RelayPricingView } from "./views/RelayPricingView";
import { statusLabel } from "./utils/format";

export const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const {
    activeTab,
    errorMessage,
    isLoading,
    isSyncing,
    dashboard,
    updateStatus,
    availableUpdate,
    locale
  } = useApp();

  const liveRegionText = errorMessage
    ? errorMessage
    : isSyncing
      ? t("syncingShort")
      : updateStatus === "available" && availableUpdate
        ? t("updateAvailableBanner", { version: availableUpdate.version })
        : updateStatus === "installing"
          ? t("installingUpdate")
          : isLoading
            ? t("loadingDashboard")
            : dashboard
              ? t("currentStatus", { status: statusLabel(dashboard.status.state, locale) })
              : t("dashboardNotLoaded");

  return (
    <>
      <a className="skip-link" href="#dashboard-main">
        {t("skipToMainContent")}
      </a>
      <main className="app-shell" id="dashboard-main">
        <div className="sr-only" aria-live="polite">
          {liveRegionText}
        </div>
        <section className="dashboard-layout">
          <Sidebar />
          <div className="dashboard-content">
            <UpdateBanner />
            {errorMessage && <section className="banner bad">{errorMessage}</section>}
            {isLoading && !dashboard && <section className="banner">{t("loadingPage")}</section>}

            {activeTab === "overview" && <OverviewView />}
            {activeTab === "monthlyHistory" && <MonthlyHistoryView />}
            {activeTab === "monthlyDetail" && <MonthlyDetailView />}
            {activeTab === "dailyDetail" && <DailyDetailView />}
            {activeTab === "relayPricing" && <RelayPricingView />}
            {activeTab === "settings" && <SettingsView />}
          </div>
        </section>
      </main>
    </>
  );
};
