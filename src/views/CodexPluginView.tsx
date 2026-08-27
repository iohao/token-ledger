import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  CircleAlert,
  FileCode,
  FileText,
  Save,
  Terminal,
  XCircle
} from "lucide-react";
import { fetchCodexPluginConfig, updateCodexPluginConfig } from "../api/tauri";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type { CodexPluginConfigDTO, PricingProviderDTO } from "../dto/dashboard";
import type { PageSourceId } from "../types";

export const CODEX_PLUGIN_PAGE_SOURCE_ID: PageSourceId = "src/views/CodexPluginView.tsx";

export const CodexPluginView: React.FC = () => {
  const { t } = useTranslation();
  const { dashboard, isLoading, isSyncing } = useApp();

  const [pluginConfig, setPluginConfig] = useState<CodexPluginConfigDTO | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("openai-official");
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchCodexPluginConfig()
      .then((cfg) => {
        if (isMounted) {
          setPluginConfig(cfg);
          setEnabled(cfg.enabled);
          setSelectedProviderId(cfg.selectedProviderId || "openai-official");
        }
      })
      .catch((err) => {
        if (isMounted) {
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const providers: PricingProviderDTO[] = dashboard?.meta.pricingProviders ?? [
    {
      id: "openai-official",
      kind: "official",
      name: "OpenAI 官方",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 1.0
    }
  ];

  const selectedProvider =
    providers.find((p) => p.id === selectedProviderId) ||
    providers.find((p) => p.id === "openai-official") ||
    providers[0];

  const handleToggleEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setIsDirty(true);
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setIsDirty(true);
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleSave = async (
    targetEnabled = enabled,
    targetProviderId = selectedProviderId
  ) => {
    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const updated = await updateCodexPluginConfig(targetEnabled, targetProviderId);
      setPluginConfig(updated);
      setEnabled(updated.enabled);
      setSelectedProviderId(updated.selectedProviderId);
      setIsDirty(false);
      setSaveNotice(t("codexPluginSaved"));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const controlsDisabled = isLoading || isSyncing || isSaving;

  return (
    <div className="page-stack codex-plugin-page">
      <PageHeader
        icon={<Terminal size={18} />}
        eyebrow={t("codexPluginEyebrow")}
        title={t("codexPluginTitle")}
        description={t("codexPluginDescription")}
        pageSourceId={CODEX_PLUGIN_PAGE_SOURCE_ID}
        actions={
          <div className="header-actions-group">
            <label className="settings-switch-label">
              <span className="settings-switch-text">{t("codexPluginSwitchLabel")}</span>
              <span className="settings-switch">
                <input
                  className="settings-switch-input"
                  type="checkbox"
                  checked={enabled}
                  disabled={controlsDisabled}
                  onChange={(e) => handleToggleEnabled(e.target.checked)}
                />
                <span className="settings-switch-track" aria-hidden="true" />
              </span>
            </label>
            {isDirty && (
              <button
                className="action primary"
                type="button"
                disabled={controlsDisabled}
                onClick={() => void handleSave()}
              >
                <Save size={16} />
                <span>{isSaving ? t("codexPluginSaving") : t("codexPluginSave")}</span>
              </button>
            )}
          </div>
        }
      />

      {saveError && (
        <div className="relay-error-summary" role="alert">
          <CircleAlert size={17} /> {saveError}
        </div>
      )}
      {saveNotice && (
        <p className="config-feedback good" role="status">
          {saveNotice}
        </p>
      )}

      {/* Terminal Output Preview & Status Card */}
      <section className="panel codex-terminal-preview-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{t("codexPluginPreviewTitle")}</h2>
            <p className="panel-description">{t("codexPluginPreviewDesc")}</p>
          </div>
          <div className="terminal-status-badge">
            {enabled && pluginConfig?.hookInstalled ? (
              <span className="status-pill active">
                <CheckCircle2 size={14} />
                {t("codexPluginStatusActive")}
              </span>
            ) : (
              <span className="status-pill inactive">
                <XCircle size={14} />
                {t("codexPluginStatusInactive")}
              </span>
            )}
          </div>
        </div>

        <div className="terminal-window">
          <div className="terminal-window-header">
            <div className="terminal-traffic-lights">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="terminal-window-title">Codex CLI Terminal</span>
          </div>
          <div className="terminal-window-body">
            <div className="terminal-line prompt-line">
              <span className="terminal-prompt">$</span> codex
            </div>
            <div className="terminal-line response-line">
              <span className="terminal-agent">Codex:</span> All requested changes have been applied.
            </div>
            <div className="terminal-line cost-highlight-line">
              <span className="terminal-provider-tag">
                [{selectedProvider?.name ?? "OpenAI 官方"}]
              </span>{" "}
              {t("codexPluginPreviewSample")}
            </div>
          </div>
        </div>

        {pluginConfig && (
          <div className="plugin-paths-grid">
            <div className="plugin-path-item">
              <span className="plugin-path-label">
                <FileCode size={14} /> {t("codexPluginPathLabel")}
              </span>
              <code className="plugin-path-value" title={pluginConfig.pluginPath}>
                {pluginConfig.pluginPath}
              </code>
            </div>
            <div className="plugin-path-item">
              <span className="plugin-path-label">
                <FileText size={14} /> {t("codexPluginPricingPathLabel")}
              </span>
              <code className="plugin-path-value" title={pluginConfig.pricingPath}>
                {pluginConfig.pricingPath}
              </code>
            </div>
          </div>
        )}
      </section>

      {/* Provider Radio Table Card */}
      <section className="panel codex-providers-table-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{t("codexPluginSelectProviderTitle")}</h2>
            <p className="panel-description">{t("codexPluginSelectProviderDesc")}</p>
          </div>
          {isDirty && (
            <button
              className="action primary"
              type="button"
              disabled={controlsDisabled}
              onClick={() => void handleSave()}
            >
              <Save size={16} />
              <span>{isSaving ? t("codexPluginSaving") : t("codexPluginSave")}</span>
            </button>
          )}
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 48, textAlign: "center" }}>{t("codexPluginTableSelect")}</th>
                <th>{t("codexPluginTableName")}</th>
                <th>{t("codexPluginTableType")}</th>
                <th>{t("codexPluginTableMultiplier")}</th>
                <th>{t("codexPluginTableRatio")}</th>
                <th>{t("codexPluginTableCompareStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const isSelected = selectedProviderId === provider.id;
                const isOfficial = provider.kind === "official";
                const multiplier =
                  provider.multiplier !== undefined && provider.multiplier !== null
                    ? `${Number(provider.multiplier).toFixed(4)}x`
                    : "1.0000x";
                const ratio =
                  provider.rechargeRatioUsdPerRmb !== null &&
                  provider.rechargeRatioUsdPerRmb !== undefined
                    ? `${Number(provider.rechargeRatioUsdPerRmb).toFixed(4)}`
                    : "-";

                return (
                  <tr
                    key={provider.id}
                    className={`selectable-row ${isSelected ? "is-selected" : ""}`}
                    onClick={() => handleSelectProvider(provider.id)}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="radio"
                        name="active-pricing-provider"
                        checked={isSelected}
                        onChange={() => handleSelectProvider(provider.id)}
                        disabled={controlsDisabled}
                        aria-label={provider.name}
                      />
                    </td>
                    <td>
                      <div className="provider-name-cell">
                        <strong>{provider.name}</strong>
                        {isSelected && <span className="active-badge">Active</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`provider-kind-tag ${provider.kind}`}>
                        {isOfficial ? t("codexPluginOfficial") : t("codexPluginRelay")}
                      </span>
                    </td>
                    <td>
                      <code>{multiplier}</code>
                    </td>
                    <td>
                      <code>{ratio}</code>
                    </td>
                    <td>
                      <span
                        className={`compare-status-badge ${
                          provider.enabled ? "enabled" : "disabled"
                        }`}
                      >
                        {provider.enabled
                          ? t("codexPluginTableCompareEnabled")
                          : t("codexPluginTableCompareDisabled")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {providers.length <= 1 && (
          <p className="no-relays-hint">{t("codexPluginNoRelaysNotice")}</p>
        )}
      </section>
    </div>
  );
};
