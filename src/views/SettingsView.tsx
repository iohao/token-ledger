import React, { useEffect, useRef, useState } from "react";
import {
  Database,
  ExternalLink,
  Gauge,
  Info,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun
} from "lucide-react";
import { useTranslation } from "react-i18next";
import appIconUrl from "../../icons/128x128.png";
import { useApp } from "../context/AppContext";
import { PageHeader } from "../components/PageHeader";
import {
  SOURCE_REPOSITORY_URL,
  type PageSourceId,
  type ThemeMode
} from "../types";
import { formatInteger, formatTimestamp } from "../utils/format";
import { type Locale } from "../i18n";
import type { DashboardPayloadDTO } from "../dto/dashboard";

export const SETTINGS_PAGE_SOURCE_ID: PageSourceId = "src/views/SettingsView.tsx";

export function databasePathSourceLabel(
  source: DashboardPayloadDTO["meta"]["databasePathSource"] | undefined,
  t: (key: any) => string
): string {
  switch (source) {
    case "env":
      return t("databasePathSourceEnv");
    case "config":
      return t("databasePathSourceConfig");
    case "default":
      return t("databasePathSourceDefault");
    default:
      return "-";
  }
}

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const {
    dashboard,
    locale,
    setLocale,
    themeMode,
    setThemeMode,
    showPageSourceIds,
    setShowPageSourceIds,
    databasePathDraft,
    setDatabasePathDraft,
    databasePathNotice,
    isUpdatingDatabasePath,
    saveDatabasePathOverride,
    resetDatabasePathOverride,
    currentAppVersion,
    openSourceRepositoryInBrowser,
    isLoading,
    isSyncing
  } = useApp();

  const [activeSection, setActiveSection] = useState<string>("general");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const databasePathEditable = dashboard?.meta.databasePathEditable ?? false;
  const databasePathDisabled = isLoading || isSyncing || isUpdatingDatabasePath || !databasePathEditable;
  const settingsSections = [
    { id: "general", label: t("settingsGeneral"), icon: <SlidersHorizontal size={18} />, desc: t("settingsGeneralDescription") },
    { id: "data", label: t("settingsData"), icon: <Database size={18} />, desc: t("settingsDataDescription") },
    { id: "about", label: t("settingsAbout"), icon: <Info size={18} />, desc: t("settingsAboutDescription") }
  ];

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
    { value: "dark", label: t("themeDark"), icon: <Moon size={16} /> },
    { value: "light", label: t("themeLight"), icon: <Sun size={16} /> },
    { value: "system", label: t("themeSystem"), icon: <Monitor size={16} /> }
  ];

  // IntersectionObserver for active section highlighting on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];
        if (visible) {
          const id = visible.target.getAttribute("data-settings-section");
          if (id) {
            setActiveSection(id);
          }
        }
      },
      { rootMargin: "-12% 0px -68% 0px", threshold: 0 }
    );

    const sectionElements = document.querySelectorAll("[data-settings-section]");
    sectionElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const target = document.getElementById(`settings-${id}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleDatabasePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void saveDatabasePathOverride();
  };

  return (
    <div className="page-stack settings-page">
      <PageHeader
        icon={<SlidersHorizontal size={18} />}
        eyebrow={t("settingsEyebrow")}
        title={t("settingsTitle")}
        description={t("settingsDescription")}
        pageSourceId={SETTINGS_PAGE_SOURCE_ID}
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settingsSectionNavAria")}>
          {settingsSections.map((section) => (
            <button
              key={section.id}
              className={`settings-nav-item ${activeSection === section.id ? "is-active" : ""}`}
              type="button"
              onClick={() => scrollToSection(section.id)}
            >
              <span className="settings-nav-icon">{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content" ref={scrollContainerRef}>
          {/* 1. General */}
          <section className="settings-section panel" id="settings-general" data-settings-section="general">
            <div className="settings-section-head">
              <span className="settings-section-icon">
                <SlidersHorizontal size={20} />
              </span>
              <div className="settings-section-title-wrap">
                <h2>{t("settingsGeneral")}</h2>
                <p>{t("settingsGeneralDescription")}</p>
              </div>
            </div>

            <div className="settings-group">
              {/* Language */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>{t("settingsLanguageTitle")}</strong>
                  <span>{t("settingsLanguageDescription")}</span>
                </div>
                <div className="settings-row-control">
                  <select
                    className="settings-select"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as Locale)}
                    aria-label={t("languageSwitcherAria")}
                  >
                    <option value="zh-CN">{t("languageChinese")}</option>
                    <option value="en-US">{t("languageEnglish")}</option>
                  </select>
                </div>
              </div>

              {/* Theme Mode */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>{t("themeModeTitle")}</strong>
                  <span>{t("themeModeDescription")}</span>
                </div>
                <div className="settings-row-control">
                  <div className="theme-segmented" role="group" aria-label={t("themeSelectAria")}>
                    {themeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        className={`theme-option ${themeMode === opt.value ? "is-active" : ""}`}
                        type="button"
                        onClick={() => setThemeMode(opt.value)}
                        aria-pressed={themeMode === opt.value}
                      >
                        <span className="theme-option-icon">{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Show Page IDs */}
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>{t("showPageSourceIds")}</strong>
                  <span id="page-source-ids-description">{t("showPageSourceIdsDescription")}</span>
                </div>
                <div className="settings-row-control">
                  <label className="settings-switch">
                    <input
                      className="settings-switch-input"
                      type="checkbox"
                      checked={showPageSourceIds}
                      onChange={(e) => setShowPageSourceIds(e.target.checked)}
                      aria-label={t("showPageSourceIds")}
                      aria-describedby="page-source-ids-description"
                    />
                    <span className="settings-switch-track" aria-hidden="true" />
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Data Storage */}
          <section className="settings-section panel" id="settings-data" data-settings-section="data">
            <div className="settings-section-head">
              <span className="settings-section-icon">
                <Database size={20} />
              </span>
              <div className="settings-section-title-wrap">
                <h2>{t("settingsData")}</h2>
                <p>{t("settingsDataDescription")}</p>
              </div>
            </div>

            <div className="settings-data-block">
              <form className="config-form settings-db-form" onSubmit={handleDatabasePathSubmit}>
                <div className="settings-field-head">
                  <label className="settings-field-label" htmlFor="settings-sqlite-path-input">
                    <strong>{t("sqlitePath")}</strong>
                  </label>
                  <span
                    className="settings-pill is-source"
                    title={t("databasePathSource", {
                      source: databasePathSourceLabel(dashboard?.meta.databasePathSource, t)
                    })}
                  >
                    {t("databasePathSource", {
                      source: databasePathSourceLabel(dashboard?.meta.databasePathSource, t)
                    })}
                  </span>
                </div>
                <div className="settings-path-input-wrap">
                  <input
                    id="settings-sqlite-path-input"
                    type="text"
                    value={databasePathDraft}
                    onChange={(e) => setDatabasePathDraft(e.target.value)}
                    className="settings-path-input"
                    disabled={databasePathDisabled}
                  />
                </div>
                <div className="config-actions">
                  <button className="action primary" type="submit" disabled={databasePathDisabled}>
                    <Save className="action-icon" size={16} />
                    <span>{isUpdatingDatabasePath ? t("savingPath") : t("savePath")}</span>
                  </button>
                  <button
                    className="action"
                    type="button"
                    onClick={() => void resetDatabasePathOverride()}
                    disabled={databasePathDisabled}
                  >
                    <RotateCcw className="action-icon" size={16} />
                    <span>{t("resetDefaultPath")}</span>
                  </button>
                </div>
                <p className="config-hint">{t("sqlitePathHint")}</p>
                {dashboard && !dashboard.meta.databasePathEditable && (
                  <p className="config-note config-note--lock">
                    <Info className="inline-icon" size={14} /> {t("sqlitePathLockedByEnv")}
                  </p>
                )}
                {databasePathNotice && (
                  <p className={`config-feedback ${databasePathNotice.tone}`} role="status">
                    {databasePathNotice.text}
                  </p>
                )}
              </form>

              <div className="settings-stats-card">
                <h4 className="settings-subcard-title">
                  <Gauge className="subcard-icon" size={16} /> {t("diagnosticsTitle")}
                </h4>
                <div className="settings-stats-grid">
                  <div className="settings-stat-item">
                    <span className="stat-label">{t("codexDirectory")}</span>
                    <strong className="stat-value stat-mono">{dashboard?.meta.codexHomePath ?? "-"}</strong>
                  </div>
                  <div className="settings-stat-item">
                    <span className="stat-label">{t("affectedSessions")}</span>
                    <strong className="stat-value">
                      {formatInteger(dashboard?.status.sessionCount ?? 0, locale)}
                    </strong>
                  </div>
                  <div className="settings-stat-item">
                    <span className="stat-label">{t("scannedFiles")}</span>
                    <strong className="stat-value">
                      {formatInteger(dashboard?.status.scannedFiles ?? 0, locale)}
                    </strong>
                  </div>
                  <div className="settings-stat-item">
                    <span className="stat-label">{t("coverageThrough")}</span>
                    <strong className="stat-value stat-mono">
                      {formatTimestamp(dashboard?.status.coverageThrough ?? null, timeZone, locale)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* About */}
          <section className="settings-section panel" id="settings-about" data-settings-section="about">
            <div className="settings-section-head">
              <span className="settings-section-icon">
                <Info size={20} />
              </span>
              <div className="settings-section-title-wrap">
                <h2>{t("settingsAbout")}</h2>
                <p>{t("settingsAboutDescription")}</p>
              </div>
            </div>

            <div className="about-product-card">
              <img src={appIconUrl} alt="TokenLedger" className="about-icon" width="60" height="60" />
              <div className="about-product-info">
                <div className="about-title-row">
                  <h3 className="about-app-name">TokenLedger</h3>
                  <span className="settings-pill is-primary">{currentAppVersion ?? "-"}</span>
                </div>
                <p className="about-app-desc">{t("appPurpose")}</p>
              </div>
            </div>

            <div className="about-details-grid">
              <div className="about-detail-item">
                <span className="about-detail-label">{t("applicationId")}</span>
                <span className="about-detail-val stat-mono">me.ionet.tokenledger</span>
              </div>
              <div className="about-detail-item">
                <span className="about-detail-label">{t("sourceRepository")}</span>
                <a
                  className="meta-link about-repo-link"
                  href={SOURCE_REPOSITORY_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    void openSourceRepositoryInBrowser();
                  }}
                >
                  <span>{SOURCE_REPOSITORY_URL}</span>
                  <ExternalLink className="inline-icon" size={14} />
                </a>
              </div>
              <div className="about-detail-item about-privacy-item">
                <span className="about-detail-label">{t("appPrivacyTitle")}</span>
                <span className="about-privacy-desc">{t("appPrivacyDesc")}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
