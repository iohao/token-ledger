import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleHelp,
  Copy,
  Save,
  Sliders,
  Sparkles,
  Terminal,
  Undo2,
  Zap
} from "lucide-react";
import { fetchCodexPluginConfig, updateCodexPluginConfig } from "../api/tauri";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type { CodexPluginConfigDTO, PricingProviderDTO } from "../dto/dashboard";
import type { PageSourceId } from "../types";

export const CODEX_PLUGIN_PAGE_SOURCE_ID: PageSourceId = "src/views/CodexPluginView.tsx";

type CopiedTarget = "terminal" | null;

export const CodexPluginView: React.FC = () => {
  const { t } = useTranslation();
  const { dashboard, isLoading, isSyncing, setActiveTab } = useApp();

  const [pluginConfig, setPluginConfig] = useState<CodexPluginConfigDTO | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("openai-official");
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget>(null);

  useEffect(() => {
    let isMounted = true;
    fetchCodexPluginConfig()
      .then((cfg) => {
        if (isMounted) {
          setPluginConfig(cfg);
          setEnabled(cfg.enabled);
          setSelectedProviderId(cfg.selectedProviderId || "openai-official");
          setIsDirty(false);
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

  const providers: PricingProviderDTO[] = useMemo(() => {
    return (
      dashboard?.meta.pricingProviders ?? [
        {
          id: "openai-official",
          kind: "official",
          name: "OpenAI 官方",
          enabled: true,
          rechargeRatioUsdPerRmb: 0.14,
          multiplier: 1.0
        }
      ]
    );
  }, [dashboard?.meta.pricingProviders]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((p) => p.id === selectedProviderId) ||
      providers.find((p) => p.id === "openai-official") ||
      providers[0]
    );
  }, [providers, selectedProviderId]);

  const handleToggleEnabled = useCallback(
    (nextEnabled: boolean) => {
      setEnabled(nextEnabled);
      const dirty =
        nextEnabled !== pluginConfig?.enabled ||
        selectedProviderId !== (pluginConfig?.selectedProviderId || "openai-official");
      setIsDirty(dirty);
      setSaveError(null);
      setSaveNotice(null);
    },
    [pluginConfig, selectedProviderId]
  );

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      const dirty =
        enabled !== (pluginConfig?.enabled ?? false) ||
        providerId !== (pluginConfig?.selectedProviderId || "openai-official");
      setIsDirty(dirty);
      setSaveError(null);
      setSaveNotice(null);
    },
    [enabled, pluginConfig]
  );

  const handleDiscard = useCallback(() => {
    if (!pluginConfig) return;
    setEnabled(pluginConfig.enabled);
    setSelectedProviderId(pluginConfig.selectedProviderId || "openai-official");
    setIsDirty(false);
    setSaveError(null);
    setSaveNotice(null);
  }, [pluginConfig]);

  const handleSave = useCallback(
    async (targetEnabled = enabled, targetProviderId = selectedProviderId) => {
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
    },
    [enabled, selectedProviderId, t]
  );

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (isDirty && !isLoading && !isSyncing && !isSaving) {
          e.preventDefault();
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, isLoading, isSyncing, isSaving, handleSave]);

  const handleCopyText = useCallback((text: string, target: CopiedTarget) => {
    if (!text) return;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedTarget(target);
        setTimeout(() => {
          setCopiedTarget(null);
        }, 2000);
      })
      .catch(() => {
        // Fallback for clipboard
      });
  }, []);

  // Dynamic cost estimates based on active provider
  const multiplier = Number(selectedProvider?.multiplier ?? 1.0);
  const ratio = Number(selectedProvider?.rechargeRatioUsdPerRmb ?? 0.14) || 0.14;

  const sampleTurnCostUsd = (0.03303 * (multiplier > 0 ? multiplier : 1.0)).toFixed(6);
  const sampleTotalCostUsd = (0.072785 * (multiplier > 0 ? multiplier : 1.0)).toFixed(6);
  const sampleTurnCostCny = (Number(sampleTurnCostUsd) / ratio).toFixed(4);
  const sampleTotalCostCny = (Number(sampleTotalCostUsd) / ratio).toFixed(4);

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
          isDirty ? (
            <div className="header-actions-group">
              <button
                type="button"
                className="action secondary"
                disabled={controlsDisabled}
                onClick={handleDiscard}
              >
                <Undo2 size={15} />
                <span>{t("codexPluginDiscard")}</span>
              </button>
              <button
                type="button"
                className="action primary"
                disabled={controlsDisabled}
                onClick={() => void handleSave()}
              >
                <Save size={15} />
                <span>{isSaving ? t("codexPluginSaving") : t("codexPluginSave")}</span>
              </button>
            </div>
          ) : null
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

      {/* Active Pricing Provider Selector */}
      <section className="plugin-providers-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">{t("codexPluginSelectProviderTitle")}</h3>
            <p className="panel-description">{t("codexPluginSelectProviderDesc")}</p>
          </div>
          <button
            type="button"
            className="action secondary btn-sm plugin-manage-relays-btn"
            onClick={() => setActiveTab("relayPricing")}
          >
            <Sliders size={13} />
            <span>{t("codexPluginManageRelays")}</span>
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="plugin-provider-list" role="radiogroup" aria-label={t("codexPluginSelectProviderTitle")}>
          {providers.map((provider) => {
            const isSelected = selectedProviderId === provider.id;
            const isOfficial = provider.kind === "official";
            const pMultiplier =
              provider.multiplier !== undefined && provider.multiplier !== null
                ? Number(provider.multiplier).toFixed(4)
                : "1.0000";
            const pRatio =
              provider.rechargeRatioUsdPerRmb !== null && provider.rechargeRatioUsdPerRmb !== undefined
                ? Number(provider.rechargeRatioUsdPerRmb).toFixed(4)
                : "0.1400";
            const effectiveRate =
              provider.multiplier && provider.rechargeRatioUsdPerRmb
                ? (Number(provider.multiplier) / (Number(provider.rechargeRatioUsdPerRmb) / 0.14)).toFixed(2)
                : "1.00";

            return (
              <div
                key={provider.id}
                className={`plugin-provider-row ${isSelected ? "is-selected" : ""}`}
                onClick={() => handleSelectProvider(provider.id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectProvider(provider.id);
                  }
                }}
              >
                <div className="plugin-provider-radio-col" aria-hidden="true">
                  <div className="plugin-provider-radio-circle">
                    <div className="plugin-provider-radio-inner" />
                  </div>
                </div>

                <div className="plugin-provider-info-col">
                  <div className="plugin-provider-name-row">
                    <strong className="plugin-provider-name">{provider.name}</strong>
                    <span className={`provider-kind-tag ${provider.kind}`}>
                      {isOfficial ? t("codexPluginOfficial") : t("codexPluginRelay")}
                    </span>
                    {isSelected && <span className="plugin-selected-chip">{t("codexPluginActiveTag")}</span>}
                  </div>

                  <div className="plugin-provider-metrics-row">
                    <span className="plugin-provider-metric-tag">
                      {t("codexPluginTableMultiplier")}: <strong>{pMultiplier}x</strong>
                    </span>
                    <span className="plugin-provider-metric-dot">·</span>
                    <span className="plugin-provider-metric-tag">
                      {t("codexPluginTableRatio")}: <strong>{pRatio}</strong>
                    </span>
                    <span className="plugin-provider-metric-dot">·</span>
                    <span className={`plugin-provider-metric-tag ${!isOfficial && Number(effectiveRate) < 1.0 ? "text-moss" : ""}`}>
                      {isOfficial
                        ? t("codexPluginBaseline")
                        : `${effectiveRate}x ${t("codexPluginEffectiveRateDesc")}`}
                    </span>
                  </div>
                </div>

                <div className="plugin-provider-check-col" aria-hidden="true">
                  {isSelected && <Check size={16} className="text-moss" />}
                </div>
              </div>
            );
          })}
        </div>

        {providers.length <= 1 && (
          <div className="plugin-empty-relays-hint">
            <p>{t("codexPluginNoRelaysNotice")}</p>
          </div>
        )}
      </section>

      {/* 终端输出效果预览 Panel */}
      <section className="plugin-preview-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">{t("codexPluginPreviewTitle")}</h3>
            <p className="panel-description">{t("codexPluginPreviewDesc")}</p>
          </div>
          <div className="plugin-preview-header-actions">
            <div className="plugin-preview-switch-group">
              <label
                className="settings-switch-label"
                title={enabled ? t("relayPricingEnabled") : t("relayPricingDisabled")}
              >
                <span className="settings-switch-text">
                  {enabled ? t("relayPricingEnabled") : t("relayPricingDisabled")}
                </span>
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
              <div className="plugin-help-tooltip-wrap">
                <button
                  type="button"
                  className="plugin-help-tooltip-trigger"
                  aria-label={t("codexPluginTooltipTitle")}
                >
                  <CircleHelp size={15} className="plugin-help-icon" />
                </button>
                <div className="plugin-help-tooltip-popover" role="tooltip">
                  <div className="plugin-help-tooltip-title">
                    <CircleHelp size={14} className="text-moss" />
                    <span>{t("codexPluginTooltipTitle")}</span>
                  </div>
                  <div className="plugin-help-tooltip-content">
                    <p>{t("codexPluginTooltipDesc")}</p>
                    <p className="plugin-help-tooltip-secondary">{t("codexPluginTooltipRuleDesc")}</p>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              className={`plugin-mini-action-btn ${copiedTarget === "terminal" ? "copied" : ""}`}
              onClick={() => {
                const sampleText = `[${selectedProvider?.name ?? "OpenAI 官方"}] 本轮 [花费：$${sampleTurnCostUsd} (约¥${sampleTurnCostCny})，请求 2 次] | 总计 [花费：$${sampleTotalCostUsd} (约¥${sampleTotalCostCny})，请求 5 次]`;
                handleCopyText(sampleText, "terminal");
              }}
              title={t("codexPluginCopyTerminal")}
            >
              {copiedTarget === "terminal" ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedTarget === "terminal" ? t("codexPluginCopied") : t("codexPluginCopyTerminal")}</span>
            </button>
          </div>
        </div>

        <div className="compact-terminal-window" role="region" aria-label={t("codexPluginPreviewTitle")}>
          <div className="compact-terminal-header">
            <div className="terminal-traffic-lights" aria-hidden="true">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="compact-terminal-title">codex-cli session</span>
            <span className="compact-terminal-engine-tag">
              {selectedProvider?.name ?? "OpenAI 官方"}
            </span>
          </div>

          <div className="compact-terminal-body">
            <div className="terminal-line prompt-line">
              <span className="terminal-prompt">$</span>
              <span className="terminal-cmd">codex &quot;Optimize vector embeddings search&quot;</span>
            </div>
            <div className="terminal-line response-line">
              <span className="terminal-agent">Codex:</span>
              <span className="terminal-text-dim">Optimization applied. 3 files modified.</span>
            </div>

            <div className="compact-terminal-hook-box">
              <div className="compact-hook-header">
                <span className="compact-hook-tag">
                  <Zap size={12} />
                  {selectedProvider?.name ?? "OpenAI 官方"}
                </span>
                <span className="compact-hook-sub">{t("codexPluginHookOutput")}</span>
              </div>
              <div className="compact-hook-content">
                本轮 [花费：${sampleTurnCostUsd} (约¥${sampleTurnCostCny})，请求 2 次] | 总计 [花费：${sampleTotalCostUsd} (约¥${sampleTotalCostCny})，请求 5 次]
              </div>
            </div>
          </div>
        </div>

        {/* Minimalist Workflow Breadcrumb */}
        <div className="plugin-workflow-compact">
          <div className="plugin-workflow-step">
            <span className="plugin-workflow-num">1</span>
            <span>{t("codexPluginStep1")}</span>
          </div>
          <ArrowRight size={12} className="text-muted" />
          <div className="plugin-workflow-step">
            <span className="plugin-workflow-num">2</span>
            <span>{t("codexPluginStep2")}</span>
          </div>
          <ArrowRight size={12} className="text-muted" />
          <div className="plugin-workflow-step">
            <span className="plugin-workflow-num">3</span>
            <span>{t("codexPluginStep3")}</span>
          </div>
        </div>
      </section>

      {/* Sticky Floating Save Bar on unsaved changes */}
      {isDirty && (
        <div className="plugin-floating-save-bar" role="status" aria-live="polite">
          <div className="plugin-floating-save-left">
            <Sparkles size={16} className="text-gold" />
            <span>{t("codexPluginUnsavedChanges")}</span>
          </div>
          <div className="plugin-floating-save-actions">
            <button
              type="button"
              className="action secondary"
              disabled={controlsDisabled}
              onClick={handleDiscard}
            >
              <Undo2 size={14} />
              <span>{t("codexPluginDiscard")}</span>
            </button>
            <button
              type="button"
              className="action primary"
              disabled={controlsDisabled}
              onClick={() => void handleSave()}
            >
              <Save size={14} />
              <span>{isSaving ? t("codexPluginSaving") : t("codexPluginSave")}</span>
              <kbd className="kbd-shortcut">⌘S</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
