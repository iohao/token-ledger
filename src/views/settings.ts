import appIconUrl from "../../src-tauri/icons/128x128.png";
import { renderPageHeader } from "../components/page-header";
import {
  renderUpdateNotes,
  updatePlatformSupportNote,
  updateStatusMessage,
  updateStatusTone
} from "../components/update-banner";
import type { DashboardPayloadDTO } from "../dto/dashboard";
import { t, translatePricingNote, type Locale } from "../i18n";
import {
  PRICING_RATE_FIELDS,
  SOURCE_REPOSITORY_URL,
  type AppState,
  type PageSourceId,
  type PricingRateField,
  type ThemeMode
} from "../types";
import { escapeHtml, formatInteger, formatPricingInput, formatTimestamp, iconMarkup } from "../utils/format";

export const SETTINGS_PAGE_SOURCE_ID: PageSourceId = "src/views/settings.ts";

export function pricingFieldLabel(field: PricingRateField, locale: Locale): string {
  switch (field) {
    case "inputUsdPerMillion":
      return t(locale, "pricingInput");
    case "outputUsdPerMillion":
      return t(locale, "pricingOutput");
    case "cacheReadUsdPerMillion":
      return t(locale, "pricingCacheRead");
    case "cacheCreationUsdPerMillion":
      return t(locale, "pricingCacheCreation");
  }
}

export function pricingErrorKey(model: string, field: PricingRateField): string {
  return `${model}:${field}`;
}

export function databasePathSourceLabel(
  source: DashboardPayloadDTO["meta"]["databasePathSource"],
  locale: Locale
): string {
  switch (source) {
    case "env":
      return t(locale, "databasePathSourceEnv");
    case "config":
      return t(locale, "databasePathSourceConfig");
    case "default":
      return t(locale, "databasePathSourceDefault");
  }
}

export function renderModelPricingBlock(state: AppState, dashboard: DashboardPayloadDTO | null): string {
  const settings = dashboard?.meta.modelPricingSettings ?? [];
  const disabled = state.isLoading || state.isSyncing || state.isUpdatingModelPricing;
  const pricingNotes = (dashboard?.meta.pricingNotes ?? []).map((note) => translatePricingNote(state.locale, note));

  const rows = state.modelPricingDraft
    .map((draft) => {
      const setting = settings.find((candidate) => candidate.model === draft.model);
      if (!setting) {
        return "";
      }

      const modelId = draft.model.replaceAll(".", "-");
      const fields = PRICING_RATE_FIELDS.map((field) => {
        const errorKey = pricingErrorKey(draft.model, field);
        const error = state.modelPricingErrors[errorKey];
        const inputId = `pricing-${modelId}-${field}`;
        const errorId = `${inputId}-error`;
        const officialRate = formatPricingInput(setting.officialRates[field]);

        return `
          <div class="pricing-rate-item ${!draft.enabled ? "is-disabled" : ""}">
            <div class="pricing-rate-header">
              <label for="${inputId}">${pricingFieldLabel(field, state.locale)}</label>
              <span class="pricing-benchmark" title="${t(state.locale, "officialPricingReference")}">
                ${t(state.locale, "officialBenchmarkRate")}: $${officialRate}
              </span>
            </div>
            <div class="pricing-input-wrap ${error ? "has-error" : ""}">
              <span class="pricing-currency-symbol" aria-hidden="true">$</span>
              <input
                id="${inputId}"
                type="number"
                min="0"
                step="0.0001"
                inputmode="decimal"
                value="${escapeHtml(draft.rates[field])}"
                data-pricing-rate="${field}"
                data-pricing-model="${escapeHtml(draft.model)}"
                ${error ? `aria-invalid="true" aria-describedby="${errorId}"` : ""}
                ${disabled || !draft.enabled ? "disabled" : ""}
              />
              <span class="pricing-unit">${t(state.locale, "perMillionTokens")}</span>
            </div>
            ${error ? `<small class="field-error" id="${errorId}" role="alert">${escapeHtml(error)}</small>` : ""}
          </div>
        `;
      }).join("");

      return `
        <div class="pricing-model-card ${draft.enabled ? "is-relay-enabled" : ""}">
          <div class="pricing-model-top">
            <div class="pricing-model-title-group">
              <strong class="pricing-model-name">${escapeHtml(draft.model)}</strong>
              ${
                draft.enabled
                  ? `<span class="settings-pill is-primary">${t(state.locale, "relayPricingActive")}</span>`
                  : `<span class="settings-pill is-muted">${t(state.locale, "officialPricingActive")}</span>`
              }
            </div>
            <label class="settings-switch-label">
              <span class="settings-switch-text">${t(state.locale, "useRelayPricing")}</span>
              <span class="settings-switch">
                <input
                  class="settings-switch-input"
                  type="checkbox"
                  data-pricing-enabled
                  data-pricing-model="${escapeHtml(draft.model)}"
                  ${draft.enabled ? "checked" : ""}
                  ${disabled ? "disabled" : ""}
                />
                <span class="settings-switch-track" aria-hidden="true"></span>
              </span>
            </label>
          </div>
          <div class="pricing-rate-grid">${fields}</div>
        </div>
      `;
    })
    .join("");

  const feedback = state.modelPricingNotice
    ? `<p class="config-feedback ${state.modelPricingNotice.tone}" role="status">${escapeHtml(state.modelPricingNotice.text)}</p>`
    : "";

  const notesMarkup = pricingNotes.length > 0
    ? `
      <div class="settings-subcard pricing-notes-card">
        <h4 class="settings-subcard-title">${iconMarkup("info", "subcard-icon")} ${t(state.locale, "pricingNotesTitle")}</h4>
        <ul class="pricing-notes-list">
          ${pricingNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
          <li>${t(state.locale, "cacheCreationAvailabilityNote")}</li>
        </ul>
      </div>
    `
    : `
      <p class="config-note">${t(state.locale, "cacheCreationAvailabilityNote")}</p>
    `;

  return `
    <div class="pricing-config-block">
      <p class="config-hint pricing-intro">${t(state.locale, "modelPricingHint")}</p>
      <form class="config-form pricing-form" data-model-pricing-form novalidate>
        <div class="pricing-model-list">${rows}</div>
        <div class="config-actions">
          <button class="action primary" type="submit" ${disabled || rows.length === 0 ? "disabled" : ""}>
            ${iconMarkup("save", "action-icon")}
            <span>${state.isUpdatingModelPricing ? t(state.locale, "savingPricing") : t(state.locale, "savePricing")}</span>
          </button>
          <button class="action" type="button" data-pricing-reset ${disabled || rows.length === 0 ? "disabled" : ""}>
            ${iconMarkup("rotate-ccw", "action-icon")}
            <span>${t(state.locale, "restoreRelayPreset")}</span>
          </button>
        </div>
        ${feedback}
      </form>
      ${notesMarkup}
    </div>
  `;
}

export function renderSettingsView(
  state: AppState,
  timeZone: string,
  _notes: string,
  dashboard: DashboardPayloadDTO | null
): string {
  const databasePathEditable = dashboard?.meta.databasePathEditable ?? false;
  const databasePathDisabled = state.isLoading || state.isSyncing || state.isUpdatingDatabasePath || !databasePathEditable;
  const databasePathSource = dashboard ? databasePathSourceLabel(dashboard.meta.databasePathSource, state.locale) : "-";
  const databasePathFeedback = state.databasePathNotice
    ? `<p class="config-feedback ${state.databasePathNotice.tone}">${escapeHtml(state.databasePathNotice.text)}</p>`
    : "";
  const databasePathLockNote =
    dashboard && !dashboard.meta.databasePathEditable
      ? `<p class="config-note config-note--lock">${iconMarkup("info", "inline-icon")} ${t(state.locale, "sqlitePathLockedByEnv")}</p>`
      : "";

  const installDisabled =
    !state.availableUpdate || state.isInstallingUpdate || state.updateStatus === "checking" || state.isLoading || state.isSyncing;
  const checkDisabled = state.updateStatus === "checking" || state.isInstallingUpdate;
  const availableVersion = state.availableUpdate?.version ?? "-";
  const publishedAt = state.availableUpdate?.date ? formatTimestamp(state.availableUpdate.date, timeZone, state.locale) : "-";
  const updateTone = updateStatusTone(state.updateStatus);
  const updateFeedbackClass = updateTone ? `config-feedback ${updateTone}` : "config-note";
  const updateFeedbackMarkup =
    state.updateStatus === "idle" ? "" : `<p class="${updateFeedbackClass}">${escapeHtml(updateStatusMessage(state))}</p>`;
  const updatePlatformNote = updatePlatformSupportNote(state.locale);

  const settingsSections = [
    { id: "general", label: t(state.locale, "settingsGeneral"), icon: "sliders-horizontal", desc: t(state.locale, "settingsGeneralDescription") },
    { id: "data", label: t(state.locale, "settingsData"), icon: "database", desc: t(state.locale, "settingsDataDescription") },
    { id: "pricing", label: t(state.locale, "settingsPricing"), icon: "circle-dollar-sign", desc: t(state.locale, "settingsPricingDescription") },
    { id: "updates", label: t(state.locale, "settingsUpdates"), icon: "refresh-cw", desc: t(state.locale, "settingsUpdatesDescription") },
    { id: "about", label: t(state.locale, "settingsAbout"), icon: "info", desc: t(state.locale, "settingsAboutDescription") }
  ];

  const sectionHeader = (icon: string, title: string, description: string): string => `
    <div class="settings-section-head">
      <span class="settings-section-icon">${iconMarkup(icon)}</span>
      <div class="settings-section-title-wrap">
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
    </div>
  `;

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: string }> = [
    { value: "dark", label: t(state.locale, "themeDark"), icon: "moon" },
    { value: "light", label: t(state.locale, "themeLight"), icon: "sun" },
    { value: "system", label: t(state.locale, "themeSystem"), icon: "monitor" }
  ];

  return `
    <div class="page-stack settings-page">
      ${renderPageHeader(
        "settings",
        t(state.locale, "settingsEyebrow"),
        t(state.locale, "settingsTitle"),
        t(state.locale, "settingsDescription"),
        SETTINGS_PAGE_SOURCE_ID,
        state.showPageSourceIds,
        state.copiedPageSourceId,
        state.locale
      )}
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="${t(state.locale, "settingsSectionNavAria")}">
          ${settingsSections
            .map(
              (section, index) => `
                <a class="settings-nav-item ${index === 0 ? "is-active" : ""}" href="#settings-${section.id}" data-settings-nav="${section.id}">
                  ${iconMarkup(section.icon, "settings-nav-icon")}
                  <span>${section.label}</span>
                  ${section.id === "updates" && state.availableUpdate ? `<span class="settings-nav-dot" aria-hidden="true"></span>` : ""}
                </a>
              `
            )
            .join("")}
        </nav>

        <div class="settings-content">
          <!-- 1. 通用设置 -->
          <section class="settings-section panel" id="settings-general" data-settings-section="general">
            ${sectionHeader("sliders-horizontal", t(state.locale, "settingsGeneral"), t(state.locale, "settingsGeneralDescription"))}
            <div class="settings-group">
              <div class="settings-row">
                <div class="settings-row-text">
                  <strong>${t(state.locale, "settingsLanguageTitle")}</strong>
                  <span>${t(state.locale, "settingsLanguageDescription")}</span>
                </div>
                <div class="settings-row-control">
                  <select class="settings-select" data-locale-select aria-label="${t(state.locale, "languageSwitcherAria")}">
                    <option value="zh-CN" ${state.locale === "zh-CN" ? "selected" : ""}>${t(state.locale, "languageChinese")}</option>
                    <option value="en-US" ${state.locale === "en-US" ? "selected" : ""}>${t(state.locale, "languageEnglish")}</option>
                  </select>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-text">
                  <strong>${t(state.locale, "themeModeTitle")}</strong>
                  <span>${t(state.locale, "themeModeDescription")}</span>
                </div>
                <div class="settings-row-control">
                  <div class="theme-segmented" role="group" aria-label="${t(state.locale, "themeSelectAria")}">
                    ${themeOptions
                      .map(
                        (option) => `
                          <button class="theme-option ${state.themeMode === option.value ? "is-active" : ""}" type="button" data-theme-mode="${option.value}" aria-pressed="${state.themeMode === option.value}">
                            ${iconMarkup(option.icon, "theme-option-icon")}<span>${option.label}</span>
                          </button>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-text">
                  <strong>${t(state.locale, "showPageSourceIds")}</strong>
                  <span id="page-source-ids-description">${t(state.locale, "showPageSourceIdsDescription")}</span>
                </div>
                <div class="settings-row-control">
                  <label class="settings-switch">
                    <input
                      class="settings-switch-input"
                      type="checkbox"
                      data-page-source-visible
                      aria-label="${t(state.locale, "showPageSourceIds")}" 
                      aria-describedby="page-source-ids-description"
                      ${state.showPageSourceIds ? "checked" : ""}
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <!-- 2. 数据存储 -->
          <section class="settings-section panel" id="settings-data" data-settings-section="data">
            ${sectionHeader("database", t(state.locale, "settingsData"), t(state.locale, "settingsDataDescription"))}
            
            <div class="settings-data-block">
              <form class="config-form settings-db-form" data-database-path-form>
                <div class="settings-field-head">
                  <label class="settings-field-label" for="settings-sqlite-path-input">
                    <strong>${t(state.locale, "sqlitePath")}</strong>
                  </label>
                  <span class="settings-pill is-source" title="${t(state.locale, "databasePathSource", { source: databasePathSource })}">
                    ${t(state.locale, "databasePathSource", { source: databasePathSource })}
                  </span>
                </div>
                <div class="settings-path-input-wrap">
                  <input
                    id="settings-sqlite-path-input"
                    type="text"
                    value="${escapeHtml(state.databasePathDraft)}"
                    data-database-path-input
                    class="settings-path-input"
                    ${databasePathDisabled ? "disabled" : ""}
                  />
                </div>
                <div class="config-actions">
                  <button class="action primary" type="submit" ${databasePathDisabled ? "disabled" : ""}>
                    ${iconMarkup("save", "action-icon")}
                    <span>${state.isUpdatingDatabasePath ? t(state.locale, "savingPath") : t(state.locale, "savePath")}</span>
                  </button>
                  <button class="action" type="button" data-database-path-reset ${databasePathDisabled ? "disabled" : ""}>
                    ${iconMarkup("rotate-ccw", "action-icon")}
                    <span>${t(state.locale, "resetDefaultPath")}</span>
                  </button>
                </div>
                <p class="config-hint">${t(state.locale, "sqlitePathHint")}</p>
                ${databasePathLockNote}${databasePathFeedback}
              </form>

              <div class="settings-stats-card">
                <h4 class="settings-subcard-title">${iconMarkup("gauge", "subcard-icon")} ${t(state.locale, "diagnosticsTitle")}</h4>
                <div class="settings-stats-grid">
                  <div class="settings-stat-item">
                    <span class="stat-label">${t(state.locale, "codexDirectory")}</span>
                    <strong class="stat-value stat-mono">${escapeHtml(dashboard?.meta.codexHomePath ?? "-")}</strong>
                  </div>
                  <div class="settings-stat-item">
                    <span class="stat-label">${t(state.locale, "affectedSessions")}</span>
                    <strong class="stat-value">${formatInteger(dashboard?.status.sessionCount ?? 0, state.locale)}</strong>
                  </div>
                  <div class="settings-stat-item">
                    <span class="stat-label">${t(state.locale, "scannedFiles")}</span>
                    <strong class="stat-value">${formatInteger(dashboard?.status.scannedFiles ?? 0, state.locale)}</strong>
                  </div>
                  <div class="settings-stat-item">
                    <span class="stat-label">${t(state.locale, "coverageThrough")}</span>
                    <strong class="stat-value stat-mono">${formatTimestamp(dashboard?.status.coverageThrough ?? null, timeZone, state.locale)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 3. 模型计价 -->
          <section class="settings-section panel" id="settings-pricing" data-settings-section="pricing">
            ${sectionHeader("circle-dollar-sign", t(state.locale, "settingsPricing"), t(state.locale, "settingsPricingDescription"))}
            ${renderModelPricingBlock(state, dashboard)}
          </section>

          <!-- 4. 软件更新 -->
          <section class="settings-section panel" id="settings-updates" data-settings-section="updates">
            ${sectionHeader("refresh-cw", t(state.locale, "settingsUpdates"), t(state.locale, "settingsUpdatesDescription"))}
            
            <div class="update-meta-grid">
              <div class="update-meta-item">
                <span>${t(state.locale, "currentVersion")}</span>
                <strong>${escapeHtml(state.currentAppVersion ?? "-")}</strong>
              </div>
              <div class="update-meta-item">
                <span>${t(state.locale, "availableVersion")}</span>
                <strong>${escapeHtml(availableVersion)}</strong>
              </div>
              <div class="update-meta-item">
                <span>${t(state.locale, "updatePublishedAtLabel")}</span>
                <strong>${escapeHtml(publishedAt)}</strong>
              </div>
            </div>

            <div class="config-actions settings-update-actions">
              <button class="action" type="button" data-check-updates ${checkDisabled ? "disabled" : ""}>
                ${iconMarkup("refresh-cw", "action-icon")}
                <span>${state.updateStatus === "checking" ? t(state.locale, "checkingForUpdates") : t(state.locale, "checkForUpdates")}</span>
              </button>
              <button class="action primary" type="button" data-install-update ${installDisabled ? "disabled" : ""}>
                ${iconMarkup("download", "action-icon")}
                <span>${state.isInstallingUpdate ? t(state.locale, "installingUpdate") : t(state.locale, "downloadAndInstallUpdate")}</span>
              </button>
            </div>
            
            <p class="config-hint">${t(state.locale, "updateChecksRunOnLaunch")}</p>
            ${updateFeedbackMarkup}
            ${updatePlatformNote ? `<p class="config-note">${escapeHtml(updatePlatformNote)}</p>` : ""}
            ${renderUpdateNotes(state.availableUpdate?.body, state.locale)}
          </section>

          <!-- 5. 关于应用 -->
          <section class="settings-section panel" id="settings-about" data-settings-section="about">
            ${sectionHeader("info", t(state.locale, "settingsAbout"), t(state.locale, "settingsAboutDescription"))}
            
            <div class="about-product-card">
              <img src="${appIconUrl}" alt="TokenLedger" class="about-icon" width="60" height="60" />
              <div class="about-product-info">
                <div class="about-title-row">
                  <h3 class="about-app-name">TokenLedger</h3>
                  <span class="settings-pill is-primary">${escapeHtml(state.currentAppVersion ?? "-")}</span>
                </div>
                <p class="about-app-desc">${t(state.locale, "appPurpose")}</p>
              </div>
            </div>

            <div class="about-details-grid">
              <div class="about-detail-item">
                <span class="about-detail-label">${t(state.locale, "applicationId")}</span>
                <span class="about-detail-val stat-mono">me.ionet.tokenledger</span>
              </div>
              <div class="about-detail-item">
                <span class="about-detail-label">${t(state.locale, "sourceRepository")}</span>
                <a class="meta-link about-repo-link" href="${SOURCE_REPOSITORY_URL}" target="_blank" rel="noreferrer" data-open-source-repository>
                  <span>${escapeHtml(SOURCE_REPOSITORY_URL)}</span>
                  ${iconMarkup("external-link", "inline-icon")}
                </a>
              </div>
              <div class="about-detail-item about-privacy-item">
                <span class="about-detail-label">${t(state.locale, "appPrivacyTitle")}</span>
                <span class="about-privacy-desc">${t(state.locale, "appPrivacyDesc")}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
}
