import React from "react";
import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  LayoutDashboard,
  Settings
} from "lucide-react";
import { useTranslation } from "react-i18next";
import appIconUrl from "../../src-tauri/icons/128x128.png";
import { useApp } from "../context/AppContext";
import type { AppTab } from "../types";

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { activeTab, setActiveTab, availableUpdate } = useApp();

  const isMac =
    typeof navigator !== "undefined" &&
    (/Mac|iPod|iPhone|iPad/.test(navigator.userAgent) || /Mac/i.test(navigator.platform || ""));
  const modKey = isMac ? "⌘" : "Ctrl+";

  const usageTabs: Array<{ value: AppTab; label: string; icon: React.ReactNode; shortcut: string }> = [
    { value: "dailyDetail", label: t("navDailyDetail"), icon: <CalendarDays size={18} />, shortcut: "2" },
    { value: "monthlyHistory", label: t("navMonthlyHistory"), icon: <ChartNoAxesCombined size={18} />, shortcut: "3" },
    { value: "monthlyDetail", label: t("navMonthlyDetail"), icon: <CalendarRange size={18} />, shortcut: "4" }
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="sidebar-brand-icon" src={appIconUrl} alt="" width="36" height="36" />
        <div className="sidebar-brand-copy">
          <strong>TokenLedger</strong>
          <span>{t("appTagline")}</span>
        </div>
      </div>
      <nav className="menu-shell" aria-label={t("dashboardViewsAria")}>
        <div className="menu-group">
          <p className="menu-group-label">{t("navMain")}</p>
          <button
            className={`menu-item ${activeTab === "overview" ? "is-active" : ""}`}
            type="button"
            title={`${t("navOverview")} (${modKey}1)`}
            aria-current={activeTab === "overview" ? "page" : "false"}
            onClick={() => setActiveTab("overview")}
          >
            <span className="menu-item-icon">
              <LayoutDashboard size={18} />
            </span>
            <span className="menu-item-label">{t("navOverview")}</span>
            <kbd className="menu-item-shortcut">{modKey}1</kbd>
          </button>
        </div>
        <div className="menu-group">
          <p className="menu-group-label">{t("navUsage")}</p>
          {usageTabs.map((tab) => (
            <button
              key={tab.value}
              className={`menu-item ${activeTab === tab.value ? "is-active" : ""}`}
              type="button"
              title={`${tab.label} (${modKey}${tab.shortcut})`}
              aria-current={activeTab === tab.value ? "page" : "false"}
              onClick={() => setActiveTab(tab.value)}
            >
              <span className="menu-item-icon">{tab.icon}</span>
              <span className="menu-item-label">{tab.label}</span>
              <kbd className="menu-item-shortcut">{modKey}{tab.shortcut}</kbd>
            </button>
          ))}
        </div>
      </nav>
      <div className="sidebar-footer">
        <button
          className={`menu-item ${activeTab === "settings" ? "is-active" : ""}`}
          type="button"
          title={`${t("navSettings")} (${modKey},)`}
          aria-current={activeTab === "settings" ? "page" : "false"}
          onClick={() => setActiveTab("settings")}
        >
          <span className="menu-item-icon">
            <Settings size={18} />
          </span>
          <span className="menu-item-label">{t("navSettings")}</span>
          <div className="menu-item-trailing">
            {availableUpdate && (
              <span
                className="menu-status-dot"
                aria-label={t("updateAvailableStatus", { version: availableUpdate.version })}
              />
            )}
            <kbd className="menu-item-shortcut">{modKey},</kbd>
          </div>
        </button>
      </div>
    </aside>
  );
};
