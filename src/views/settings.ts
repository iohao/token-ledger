import appIconUrl from "../../src-tauri/icons/128x128.png";
import { renderPageHeader } from "../components/page-header";
import {
  renderUpdateNotes,
  updatePlatformSupportNote,
  updateStatusMessage,
  updateStatusTone
} from "../components/update-banner";
import type { DashboardPayloadDTO } from "../dto/dashboard";
import { t, type Locale } from "../i18n";
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
  const rows = state.modelPricingDraft
    .map((draft) => {
      const setting = settings.find((candidate) => candidate.model === draft.model);
      if (!setting) {
        return "";
      }

      const modelId = draft.model.replaceAll(".", "-");
      const officialValues = PRICING_RATE_FIELDS.map(
        (field) => `
          <span>
            <small>${pricingFieldLabel(field, state.locale)}</small>
            <strong>$${formatPricingInput(setting.officialRates[field])}</strong>
          </span>
        `
      ).join("");
      const fields = PRICING_RATE_FIELDS.map((field) => {
        const errorKey = pricingErrorKey(draft.model, field);
        const error = state.modelPricingErrors[errorKey];
        const inputId = `pricing-${modelId}-${field}`;
        const errorId = `${inputId}-error`;
        return `
          <label class="pricing-field" for="${inputId}">
            <span>${pricingFieldLabel(field, state.locale)}</span>
            <div class="pricing-input-wrap">
              <span aria-hidden="true">$</span>
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
              <span>${t(state.locale, "perMillionTokens")}</span>
            </div>
            ${error ? `<small class="field-error" id="${errorId}" role="alert">${escapeHtml(error)}</small>` : ""}
          </label>
        `;
      }).join("");

      return `
        <fieldset class="pricing-model-group">
          <legend class="sr-only">${escapeHtml(draft.model)}</legend>
          <div class="pricing-model-head">
            <div>
              <strong>${escapeHtml(draft.model)}</strong>
              <span>${draft.enabled ? t(state.locale, "relayPricingActive") : t(state.locale, "officialPricingActive")}</span>
            </div>
            <label class="pricing-toggle">
              <input
                type="checkbox"
                data-pricing-enabled
                data-pricing-model="${escapeHtml(draft.model)}"
                ${draft.enabled ? "checked" : ""}
                ${disabled ? "disabled" : ""}
              />
              <span>${t(state.locale, "useRelayPricing")}</span>
            </label>
          </div>
          <div class="pricing-official" aria-label="${t(state.locale, "officialPricingReference")}">
            <p>${t(state.locale, "officialPricingReference")}</p>
            <div>${officialValues}</div>
          </div>
          <div class="pricing-rate-grid">${fields}</div>
        </fieldset>
      `;
    })
    .join("");
  const feedback = state.modelPricingNotice
    ? `<p class="config-feedback ${state.modelPricingNotice.tone}" role="status">${escapeHtml(state.modelPricingNotice.text)}</p>`
    : "";

  return `
    <div class="config-block pricing-config-block">
      <div class="section-head">
        <div>
          <p class="eyebrow">${t(state.locale, "pricingSection")}</p>
          <h3>${t(state.locale, "modelPricingTitle")}</h3>
        </div>
      </div>
      <p class="config-hint pricing-intro">${t(state.locale, "modelPricingHint")}</p>
      <form class="config-form pricing-form" data-model-pricing-form novalidate>
        <div class="pricing-model-list">${rows}</div>
        <div class="config-actions">
          <button class="action primary" type="submit" ${disabled || rows.length === 0 ? "disabled" : ""}>
            ${state.isUpdatingModelPricing ? t(state.locale, "savingPricing") : t(state.locale, "savePricing")}
          </button>
          <button class="action" type="button" data-pricing-reset ${disabled || rows.length === 0 ? "disabled" : ""}>
            ${t(state.locale, "restoreRelayPreset")}
          </button>
        </div>
      </form>
      <p class="config-note">${t(state.locale, "cacheCreationAvailabilityNote")}</p>
      ${feedback}
    </div>
  `;
}

export function renderSettingsView(
  state: AppState,
  timeZone: string,
  notes: string,
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
      ? `<p class="config-note">${t(state.locale, "sqlitePathLockedByEnv")}</p>`
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
    { id: "general", label: t(state.locale, "settingsGeneral"), icon: "languages" },
    { id: "appearance", label: t(state.locale, "settingsAppearance"), icon: "palette" },
    { id: "data", label: t(state.locale, "settingsData"), icon: "database" },
    { id: "pricing", label: t(state.locale, "settingsPricing"), icon: "circle-dollar-sign" },
    { id: "updates", label: t(state.locale, "settingsUpdates"), icon: "refresh-cw" },
    { id: "about", label: t(state.locale, "settingsAbout"), icon: "info" },
    { id: "dev", label: "tab:dev", icon: "sliders-horizontal" }
  ];
  const sectionHeader = (icon: string, title: string, description: string): string => `
    <div class="settings-section-head">
      <span class="settings-section-icon">${iconMarkup(icon)}</span>
      <div><h2>${title}</h2><p>${description}</p></div>
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
          <section class="settings-section panel" id="settings-general" data-settings-section="general">
            ${sectionHeader("languages", t(state.locale, "settingsGeneral"), t(state.locale, "settingsGeneralDescription"))}
            <div class="settings-control-row">
              <div><strong>${t(state.locale, "settingsLanguageTitle")}</strong><span>${t(state.locale, "settingsLanguageDescription")}</span></div>
              <select class="settings-select" data-locale-select aria-label="${t(state.locale, "languageSwitcherAria")}">
                <option value="zh-CN" ${state.locale === "zh-CN" ? "selected" : ""}>${t(state.locale, "languageChinese")}</option>
                <option value="en-US" ${state.locale === "en-US" ? "selected" : ""}>${t(state.locale, "languageEnglish")}</option>
              </select>
            </div>
          </section>

          <section class="settings-section panel" id="settings-appearance" data-settings-section="appearance">
            ${sectionHeader("palette", t(state.locale, "settingsAppearance"), t(state.locale, "settingsAppearanceDescription"))}
            <div class="settings-control-row settings-control-row--stack">
              <div><strong>${t(state.locale, "themeModeTitle")}</strong><span>${t(state.locale, "themeModeDescription")}</span></div>
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
          </section>

          <section class="settings-section panel" id="settings-data" data-settings-section="data">
            ${sectionHeader("database", t(state.locale, "settingsData"), t(state.locale, "settingsDataDescription"))}
            <h3 class="settings-subtitle">${t(state.locale, "diagnosticsTitle")}</h3>
            <dl class="meta-list settings-meta-list">
              <div><dt>${t(state.locale, "codexDirectory")}</dt><dd>${escapeHtml(dashboard?.meta.codexHomePath ?? "-")}</dd></div>
              <div><dt>${t(state.locale, "sqlite")}</dt><dd>${escapeHtml(dashboard?.meta.databasePath ?? "-")}</dd></div>
              <div><dt>${t(state.locale, "parseVersion")}</dt><dd>${dashboard?.meta.parseVersion ?? "-"}</dd></div>
              <div><dt>${t(state.locale, "coverageThrough")}</dt><dd>${formatTimestamp(dashboard?.status.coverageThrough ?? null, timeZone, state.locale)}</dd></div>
              <div><dt>${t(state.locale, "scannedFiles")}</dt><dd>${formatInteger(dashboard?.status.scannedFiles ?? 0, state.locale)}</dd></div>
              <div><dt>${t(state.locale, "affectedSessions")}</dt><dd>${formatInteger(dashboard?.status.sessionCount ?? 0, state.locale)}</dd></div>
            </dl>
            <div class="settings-divider"></div>
            <h3 class="settings-subtitle">${t(state.locale, "sqlitePath")}</h3>
            <form class="config-form" data-database-path-form>
              <label class="config-field">
                <span>${t(state.locale, "sqlitePath")}</span>
                <input type="text" value="${escapeHtml(state.databasePathDraft)}" data-database-path-input ${databasePathDisabled ? "disabled" : ""} />
              </label>
              <div class="config-actions">
                <button class="action primary" type="submit" ${databasePathDisabled ? "disabled" : ""}>
                  ${iconMarkup("save", "action-icon")}<span>${state.isUpdatingDatabasePath ? t(state.locale, "savingPath") : t(state.locale, "savePath")}</span>
                </button>
                <button class="action" type="button" data-database-path-reset ${databasePathDisabled ? "disabled" : ""}>
                  ${iconMarkup("rotate-ccw", "action-icon")}<span>${t(state.locale, "resetDefaultPath")}</span>
                </button>
              </div>
            </form>
            <p class="config-hint">${t(state.locale, "sqlitePathHint")}</p>
            <p class="config-note">${t(state.locale, "databasePathSource", { source: databasePathSource })}</p>
            ${databasePathLockNote}${databasePathFeedback}
            ${notes ? `<div class="note-stack settings-note-stack">${notes}</div>` : ""}
          </section>

          <section class="settings-section panel" id="settings-pricing" data-settings-section="pricing">
            ${sectionHeader("circle-dollar-sign", t(state.locale, "settingsPricing"), t(state.locale, "settingsPricingDescription"))}
            ${renderModelPricingBlock(state, dashboard)}
          </section>

          <section class="settings-section panel" id="settings-updates" data-settings-section="updates">
            ${sectionHeader("refresh-cw", t(state.locale, "settingsUpdates"), t(state.locale, "settingsUpdatesDescription"))}
            <div class="update-meta-grid">
              <div class="update-meta-item"><span>${t(state.locale, "currentVersion")}</span><strong>${escapeHtml(state.currentAppVersion ?? "-")}</strong></div>
              <div class="update-meta-item"><span>${t(state.locale, "availableVersion")}</span><strong>${escapeHtml(availableVersion)}</strong></div>
              <div class="update-meta-item"><span>${t(state.locale, "updatePublishedAtLabel")}</span><strong>${escapeHtml(publishedAt)}</strong></div>
            </div>
            <div class="config-actions">
              <button class="action" type="button" data-check-updates ${checkDisabled ? "disabled" : ""}>
                ${iconMarkup("refresh-cw", "action-icon")}<span>${state.updateStatus === "checking" ? t(state.locale, "checkingForUpdates") : t(state.locale, "checkForUpdates")}</span>
              </button>
              <button class="action primary" type="button" data-install-update ${installDisabled ? "disabled" : ""}>
                ${iconMarkup("download", "action-icon")}<span>${state.isInstallingUpdate ? t(state.locale, "installingUpdate") : t(state.locale, "downloadAndInstallUpdate")}</span>
              </button>
            </div>
            <p class="config-hint">${t(state.locale, "updateChecksRunOnLaunch")}</p>
            ${updateFeedbackMarkup}
            ${updatePlatformNote ? `<p class="config-note">${escapeHtml(updatePlatformNote)}</p>` : ""}
            ${renderUpdateNotes(state.availableUpdate?.body, state.locale)}
          </section>

          <section class="settings-section panel" id="settings-about" data-settings-section="about">
            ${sectionHeader("info", t(state.locale, "settingsAbout"), t(state.locale, "settingsAboutDescription"))}
            <div class="about-product">
              <img src="${appIconUrl}" alt="TokenLedger" width="64" height="64" />
              <div><strong>TokenLedger</strong><span>${t(state.locale, "appPurpose")}</span></div>
            </div>
            <dl class="meta-list settings-meta-list about-meta-list">
              <div><dt>${t(state.locale, "currentVersion")}</dt><dd>${escapeHtml(state.currentAppVersion ?? "-")}</dd></div>
              <div><dt>${t(state.locale, "applicationId")}</dt><dd>me.ionet.tokenledger</dd></div>
              <div><dt>${t(state.locale, "sourceRepository")}</dt><dd><a class="meta-link" href="${SOURCE_REPOSITORY_URL}" target="_blank" rel="noreferrer" data-open-source-repository>${escapeHtml(SOURCE_REPOSITORY_URL)} ${iconMarkup("external-link", "inline-icon")}</a></dd></div>
            </dl>
          </section>

          <section class="settings-section panel" id="settings-dev" data-settings-section="dev">
            ${sectionHeader("sliders-horizontal", t(state.locale, "settingsDeveloper"), t(state.locale, "settingsDeveloperDescription"))}
            <div class="settings-control-row">
              <div>
                <strong>${t(state.locale, "showPageSourceIds")}</strong>
                <span id="page-source-ids-description">${t(state.locale, "showPageSourceIdsDescription")}</span>
              </div>
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
          </section>
        </div>
      </div>
    </div>
  `;
}
