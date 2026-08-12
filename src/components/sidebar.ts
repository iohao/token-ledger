import appIconUrl from "../../src-tauri/icons/128x128.png";
import type { PendingAppUpdate } from "../api/updater";
import { t, type Locale } from "../i18n";
import type { AppTab } from "../types";
import { escapeHtml, iconMarkup } from "../utils/format";

export function renderSidebarNav(
  activeTab: AppTab,
  locale: Locale,
  availableUpdate: PendingAppUpdate | null
): string {
  const usageTabs: Array<{ value: AppTab; label: string; icon: string }> = [
    { value: "dailyDetail", label: t(locale, "navDailyDetail"), icon: "calendar-days" },
    { value: "monthlyHistory", label: t(locale, "navMonthlyHistory"), icon: "chart-no-axes-combined" },
    { value: "monthlyDetail", label: t(locale, "navMonthlyDetail"), icon: "calendar-range" }
  ];
  const renderNavItem = (tab: { value: AppTab; label: string; icon: string }): string => `
    <button
      class="menu-item ${activeTab === tab.value ? "is-active" : ""}"
      type="button"
      title="${escapeHtml(tab.label)}"
      aria-current="${activeTab === tab.value ? "page" : "false"}"
      data-tab-trigger="${tab.value}"
    >
      ${iconMarkup(tab.icon, "menu-item-icon")}
      <span class="menu-item-label">${tab.label}</span>
    </button>
  `;
  const settingsLabel = t(locale, "navSettings");

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <img class="sidebar-brand-icon" src="${appIconUrl}" alt="" width="36" height="36" />
        <div class="sidebar-brand-copy">
          <strong>TokenLedger</strong>
          <span>${t(locale, "appTagline")}</span>
        </div>
      </div>
      <nav class="menu-shell" aria-label="${t(locale, "dashboardViewsAria")}">
        <div class="menu-group">
          <p class="menu-group-label">${t(locale, "navMain")}</p>
          ${renderNavItem({ value: "overview", label: t(locale, "navOverview"), icon: "layout-dashboard" })}
        </div>
        <div class="menu-group">
          <p class="menu-group-label">${t(locale, "navUsage")}</p>
          ${usageTabs.map(renderNavItem).join("")}
        </div>
      </nav>
      <div class="sidebar-footer">
        <button
          class="menu-item ${activeTab === "settings" ? "is-active" : ""}"
          type="button"
          title="${escapeHtml(settingsLabel)}"
          aria-current="${activeTab === "settings" ? "page" : "false"}"
          data-tab-trigger="settings"
        >
          ${iconMarkup("settings", "menu-item-icon")}
          <span class="menu-item-label">${settingsLabel}</span>
          ${availableUpdate ? `<span class="menu-status-dot" aria-label="${escapeHtml(t(locale, "updateAvailableStatus", { version: availableUpdate.version }))}"></span>` : ""}
        </button>
      </div>
    </aside>
  `;
}
