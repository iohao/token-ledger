import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Coins,
  Copy,
  Cpu,
  FileCode,
  FileText,
  LayoutGrid,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Table as TableIcon,
  Terminal,
  Undo2,
  XCircle,
  Zap
} from "lucide-react";
import { fetchCodexPluginConfig, updateCodexPluginConfig } from "../api/tauri";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type { CodexPluginConfigDTO, PricingProviderDTO } from "../dto/dashboard";
import type { PageSourceId } from "../types";

export const CODEX_PLUGIN_PAGE_SOURCE_ID: PageSourceId = "src/views/CodexPluginView.tsx";

type TerminalTab = "turn" | "multi" | "detail";
type ViewMode = "grid" | "table";
type CopiedTarget = "plugin" | "pricing" | "terminal" | null;

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

  // Interactive UI state
  const [terminalTab, setTerminalTab] = useState<TerminalTab>("turn");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

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

  const handleSimulateRun = useCallback(() => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
    }, 450);
  }, []);

  // Dynamic cost estimates based on active provider
  const multiplier = Number(selectedProvider?.multiplier ?? 1.0);
  const ratio = Number(selectedProvider?.rechargeRatioUsdPerRmb ?? 0.14) || 0.14;

  const sampleTurnCostUsd = (0.03303 * (multiplier > 0 ? multiplier : 1.0)).toFixed(6);
  const sampleTotalCostUsd = (0.072785 * (multiplier > 0 ? multiplier : 1.0)).toFixed(6);
  const sampleTurnCostCny = (Number(sampleTurnCostUsd) / ratio).toFixed(4);
  const sampleTotalCostCny = (Number(sampleTotalCostUsd) / ratio).toFixed(4);

  const controlsDisabled = isLoading || isSyncing || isSaving;
  const isHookActive = enabled && Boolean(pluginConfig?.hookInstalled);

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
            <label className="plugin-master-toggle-label">
              <span className="plugin-master-toggle-text">
                {enabled ? t("codexPluginTableCompareEnabled") : t("codexPluginTableCompareDisabled")}
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

      {/* Overview Status Grid */}
      <section className="plugin-status-banner-grid" aria-label={t("codexPluginStatusCardTitle")}>
        {/* Card 1: Runtime Status */}
        <div className="plugin-status-card">
          <div className="plugin-status-card-header">
            <span className="plugin-status-card-title">{t("codexPluginStatusCardTitle")}</span>
            <div className={`plugin-status-icon-wrap ${isHookActive ? "active" : ""}`}>
              {isHookActive ? <Zap size={16} /> : <Terminal size={16} />}
            </div>
          </div>
          <div className="plugin-status-value-group">
            <span className={`pulse-dot ${isHookActive ? "active" : "inactive"}`} />
            <span className="plugin-status-card-value">
              {isHookActive ? t("codexPluginStatusActive") : t("codexPluginStatusInactive")}
            </span>
          </div>
          <p className="plugin-status-card-sub">{t("codexPluginStatusSubtitle")}</p>
        </div>

        {/* Card 2: Active Pricing Engine */}
        <div className="plugin-status-card">
          <div className="plugin-status-card-header">
            <span className="plugin-status-card-title">{t("codexPluginPricingRuleCardTitle")}</span>
            <div className="plugin-status-icon-wrap cost">
              <Coins size={16} />
            </div>
          </div>
          <div className="plugin-status-value-group">
            <span className="plugin-status-card-value">{selectedProvider?.name ?? "OpenAI 官方"}</span>
            <span className={`provider-kind-tag ${selectedProvider?.kind ?? "official"}`}>
              {selectedProvider?.kind === "official"
                ? t("codexPluginOfficial")
                : t("codexPluginRelay")}
            </span>
          </div>
          <p className="plugin-status-card-sub">
            {multiplier !== 1.0
              ? `${t("codexPluginTableMultiplier")}: ${multiplier.toFixed(4)}x`
              : t("codexPluginOfficialBenchmark")}
            {" · "}
            {t("codexPluginTableRatio")}: {ratio.toFixed(4)}
          </p>
        </div>

        {/* Card 3: Metrics Monitored */}
        <div className="plugin-status-card">
          <div className="plugin-status-card-header">
            <span className="plugin-status-card-title">{t("codexPluginMetricsCardTitle")}</span>
            <div className="plugin-status-icon-wrap info">
              <ShieldCheck size={16} />
            </div>
          </div>
          <div className="plugin-status-value-group">
            <span className="plugin-status-card-value">Token / Cost / Turn</span>
          </div>
          <p className="plugin-status-card-sub">
            {t("codexPluginMetricTokens")} · {t("codexPluginMetricCost")} · {t("codexPluginMetricRequests")}
          </p>
        </div>
      </section>

      {/* Terminal Output Preview & Sandbox Card */}
      <section className="codex-terminal-preview-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{t("codexPluginPreviewTitle")}</h2>
            <p className="panel-description">{t("codexPluginPreviewDesc")}</p>
          </div>
          <div className="terminal-status-badge">
            {isHookActive ? (
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

        <div className="terminal-window" role="region" aria-label="Terminal Preview">
          <div className="terminal-window-header">
            <div className="terminal-header-left">
              <div className="terminal-traffic-lights" aria-hidden="true">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <span className="terminal-window-title">codex-cli ~ token-ledger hook</span>
            </div>

            <div className="terminal-tabs">
              <button
                type="button"
                className={`terminal-tab-btn ${terminalTab === "turn" ? "is-active" : ""}`}
                onClick={() => setTerminalTab("turn")}
              >
                {t("codexPluginTabSingleTurn")}
              </button>
              <button
                type="button"
                className={`terminal-tab-btn ${terminalTab === "multi" ? "is-active" : ""}`}
                onClick={() => setTerminalTab("multi")}
              >
                {t("codexPluginTabMultiTurn")}
              </button>
              <button
                type="button"
                className={`terminal-tab-btn ${terminalTab === "detail" ? "is-active" : ""}`}
                onClick={() => setTerminalTab("detail")}
              >
                {t("codexPluginTabDetail")}
              </button>
            </div>

            <div className="terminal-header-actions">
              <button
                type="button"
                className={`terminal-action-btn ${isSimulating ? "active" : ""}`}
                onClick={handleSimulateRun}
                title={t("codexPluginSimulate")}
              >
                <RotateCcw size={12} className={isSimulating ? "animate-spin" : ""} />
                <span>{t("codexPluginSimulate")}</span>
              </button>
              <button
                type="button"
                className={`terminal-action-btn ${copiedTarget === "terminal" ? "active" : ""}`}
                onClick={() => {
                  const sampleText = `[${selectedProvider?.name ?? "OpenAI 官方"}] 本轮 [花费：$${sampleTurnCostUsd} (约¥${sampleTurnCostCny})，请求 2 次] | 总计 [花费：$${sampleTotalCostUsd} (约¥${sampleTotalCostCny})，请求 5 次]`;
                  handleCopyText(sampleText, "terminal");
                }}
                title={t("codexPluginCopyTerminal")}
              >
                {copiedTarget === "terminal" ? <Check size={12} /> : <Copy size={12} />}
                <span>
                  {copiedTarget === "terminal" ? t("codexPluginCopied") : t("codexPluginCopyTerminal")}
                </span>
              </button>
            </div>
          </div>

          <div className="terminal-window-body">
            {terminalTab === "turn" && (
              <>
                <div className="terminal-line prompt-line">
                  <span className="terminal-prompt">$</span>
                  <span className="terminal-cmd">codex "Implement token caching optimization"</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="terminal-agent">Codex:</span>
                  <span>
                    Optimization applied. 3 files modified, 12 test assertions passing.
                  </span>
                </div>
                <div className={`terminal-line cost-highlight-line ${isSimulating ? "animate-pulse" : ""}`}>
                  <span className="terminal-provider-tag">
                    <Coins size={12} />
                    {selectedProvider?.name ?? "OpenAI 官方"}
                  </span>
                  <span>
                    本轮 [花费：${sampleTurnCostUsd} (约¥{sampleTurnCostCny})，请求 2 次] | 总计 [花费：${sampleTotalCostUsd} (约¥{sampleTotalCostCny})，请求 5 次]
                  </span>
                </div>
                <div className="terminal-line" style={{ marginTop: 8 }}>
                  <span className="terminal-prompt">$</span>
                  <span className="terminal-cursor" aria-hidden="true" />
                </div>
              </>
            )}

            {terminalTab === "multi" && (
              <>
                <div className="terminal-line prompt-line">
                  <span className="terminal-prompt">$</span>
                  <span className="terminal-cmd">codex "Review diff against main branch"</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="terminal-agent">Codex:</span>
                  <span>Summary: 4 changes verified, no regressions found.</span>
                </div>
                <div className="terminal-line cost-highlight-line">
                  <span className="terminal-provider-tag">{selectedProvider?.name ?? "OpenAI 官方"}</span>
                  <span>
                    本轮 [花费：${(Number(sampleTurnCostUsd) * 0.6).toFixed(6)}，请求 1 次] | 总计 [花费：${(Number(sampleTotalCostUsd) - Number(sampleTurnCostUsd)).toFixed(6)}，请求 3 次]
                  </span>
                </div>
                <div className="terminal-line prompt-line" style={{ marginTop: 10 }}>
                  <span className="terminal-prompt">$</span>
                  <span className="terminal-cmd">codex "Run full benchmark suite"</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="terminal-agent">Codex:</span>
                  <span>All benchmarks finished in 1.4s.</span>
                </div>
                <div className="terminal-line cost-highlight-line">
                  <span className="terminal-provider-tag">{selectedProvider?.name ?? "OpenAI 官方"}</span>
                  <span>
                    本轮 [花费：${sampleTurnCostUsd}，请求 2 次] | 总计 [花费：${sampleTotalCostUsd}，请求 5 次]
                  </span>
                </div>
              </>
            )}

            {terminalTab === "detail" && (
              <>
                <div className="terminal-line prompt-line">
                  <span className="terminal-prompt">$</span>
                  <span className="terminal-cmd">codex --verbose "Analyze database query performance"</span>
                </div>
                <div className="terminal-line response-line">
                  <span className="terminal-agent">Codex:</span>
                  <span>Query planner verified with indexes on 3 tables.</span>
                </div>
                <div className="terminal-token-detail-box">
                  <div>• Prompt Tokens: <strong>1,450</strong> (Cached: 896)</div>
                  <div>• Completion Tokens: <strong>520</strong></div>
                  <div>• Active Model: <strong>gpt-4o</strong> (or configured relay)</div>
                  <div>• Multiplier Applied: <strong>{multiplier.toFixed(4)}x</strong></div>
                </div>
                <div className="terminal-line cost-highlight-line" style={{ marginTop: 8 }}>
                  <span className="terminal-provider-tag">{selectedProvider?.name ?? "OpenAI 官方"}</span>
                  <span>
                    本轮 [花费：${sampleTurnCostUsd} · ¥{sampleTurnCostCny}] | 总计 [花费：${sampleTotalCostUsd} · ¥{sampleTotalCostCny}]
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* System Integration File Paths Bar */}
        {pluginConfig && (
          <div className="terminal-paths-bar">
            <div className="plugin-path-chip">
              <div className="plugin-path-chip-left">
                <FileCode size={14} className="text-muted" />
                <span className="plugin-path-chip-label">{t("codexPluginPathLabel")}:</span>
                <code className="plugin-path-chip-code" title={pluginConfig.pluginPath}>
                  {pluginConfig.pluginPath}
                </code>
              </div>
              <button
                type="button"
                className={`plugin-copy-btn ${copiedTarget === "plugin" ? "copied" : ""}`}
                onClick={() => handleCopyText(pluginConfig.pluginPath, "plugin")}
                title={t("codexPluginCopyPath")}
                aria-label={t("codexPluginCopyPath")}
              >
                {copiedTarget === "plugin" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="plugin-path-chip">
              <div className="plugin-path-chip-left">
                <FileText size={14} className="text-muted" />
                <span className="plugin-path-chip-label">{t("codexPluginPricingPathLabel")}:</span>
                <code className="plugin-path-chip-code" title={pluginConfig.pricingPath}>
                  {pluginConfig.pricingPath}
                </code>
              </div>
              <button
                type="button"
                className={`plugin-copy-btn ${copiedTarget === "pricing" ? "copied" : ""}`}
                onClick={() => handleCopyText(pluginConfig.pricingPath, "pricing")}
                title={t("codexPluginCopyPath")}
                aria-label={t("codexPluginCopyPath")}
              >
                {copiedTarget === "pricing" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Provider Selection Section */}
      <section className="codex-providers-section">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{t("codexPluginSelectProviderTitle")}</h2>
            <p className="panel-description">{t("codexPluginSelectProviderDesc")}</p>
          </div>

          <div className="providers-header-actions">
            {/* View Mode Switcher */}
            <div className="view-mode-toggle" role="group" aria-label="View Mode">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === "grid" ? "is-active" : ""}`}
                onClick={() => setViewMode("grid")}
                title={t("codexPluginViewModeGrid")}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === "table" ? "is-active" : ""}`}
                onClick={() => setViewMode("table")}
                title={t("codexPluginViewModeTable")}
              >
                <TableIcon size={15} />
              </button>
            </div>

            <button
              type="button"
              className="action secondary"
              onClick={() => setActiveTab("relayPricing")}
            >
              <Sliders size={14} />
              <span>{t("codexPluginManageRelays")}</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Card Grid View */}
        {viewMode === "grid" && (
          <div className="provider-cards-grid" role="radiogroup" aria-label={t("codexPluginSelectProviderTitle")}>
            {providers.map((provider) => {
              const isSelected = selectedProviderId === provider.id;
              const isOfficial = provider.kind === "official";
              const pMultiplier =
                provider.multiplier !== undefined && provider.multiplier !== null
                  ? `${Number(provider.multiplier).toFixed(4)}x`
                  : "1.0000x";
              const pRatio =
                provider.rechargeRatioUsdPerRmb !== null &&
                provider.rechargeRatioUsdPerRmb !== undefined
                  ? `${Number(provider.rechargeRatioUsdPerRmb).toFixed(4)}`
                  : "0.1400";

              const effectiveRate =
                provider.multiplier && provider.rechargeRatioUsdPerRmb
                  ? (Number(provider.multiplier) / (Number(provider.rechargeRatioUsdPerRmb) / 0.14)).toFixed(2)
                  : "1.00";

              return (
                <div
                  key={provider.id}
                  className={`plugin-provider-card ${isSelected ? "is-selected" : ""}`}
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
                  <div className="provider-card-top">
                    <div className="provider-card-name-group">
                      <div className="provider-radio-custom" aria-hidden="true">
                        <div className="provider-radio-dot" />
                      </div>
                      <div className="provider-card-title-wrap">
                        <strong className="provider-card-name">{provider.name}</strong>
                        <div className="provider-card-badges">
                          <span className={`provider-kind-tag ${provider.kind}`}>
                            {isOfficial ? t("codexPluginOfficial") : t("codexPluginRelay")}
                          </span>
                        </div>
                      </div>
                    </div>
                    {isSelected && <span className="active-badge">Active</span>}
                  </div>

                  <div className="provider-card-stats">
                    <div className="provider-stat-item">
                      <span className="provider-stat-label">{t("codexPluginTableMultiplier")}</span>
                      <span className="provider-stat-value">{pMultiplier}</span>
                    </div>
                    <div className="provider-stat-item">
                      <span className="provider-stat-label">{t("codexPluginTableRatio")}</span>
                      <span className="provider-stat-value">{pRatio}</span>
                    </div>
                  </div>

                  <div className="provider-card-footer">
                    <span
                      className={`provider-effective-rate-pill ${
                        !isOfficial && Number(effectiveRate) < 1.0 ? "highlight" : ""
                      }`}
                    >
                      {isOfficial
                        ? t("codexPluginBaseline")
                        : `${effectiveRate}x ${t("codexPluginEffectiveRateDesc")}`}
                    </span>
                    <span
                      className={`compare-status-badge ${
                        provider.enabled ? "enabled" : "disabled"
                      }`}
                    >
                      {provider.enabled
                        ? t("codexPluginTableCompareEnabled")
                        : t("codexPluginTableCompareDisabled")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Table View */}
        {viewMode === "table" && (
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
                  const pMultiplier =
                    provider.multiplier !== undefined && provider.multiplier !== null
                      ? `${Number(provider.multiplier).toFixed(4)}x`
                      : "1.0000x";
                  const pRatio =
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
                        <code>{pMultiplier}</code>
                      </td>
                      <td>
                        <code>{pRatio}</code>
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
        )}

        {providers.length <= 1 && (
          <div className="plugin-no-relays-card">
            <span className="plugin-no-relays-text">{t("codexPluginNoRelaysNotice")}</span>
            <button
              type="button"
              className="action secondary"
              onClick={() => setActiveTab("relayPricing")}
            >
              <span>{t("codexPluginManageRelays")}</span>
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>

      {/* How it Works / Architecture Lifecycle Panel */}
      <section className="plugin-lifecycle-panel">
        <h3 className="panel-title">{t("codexPluginHowItWorks")}</h3>
        <div className="plugin-lifecycle-grid">
          <div className="plugin-lifecycle-step">
            <div className="plugin-lifecycle-step-icon">
              <Terminal size={16} />
            </div>
            <div className="plugin-lifecycle-step-body">
              <strong className="plugin-lifecycle-step-title">{t("codexPluginStep1Title")}</strong>
              <span className="plugin-lifecycle-step-desc">{t("codexPluginStep1Desc")}</span>
            </div>
          </div>

          <div className="plugin-lifecycle-step">
            <div className="plugin-lifecycle-step-icon">
              <Cpu size={16} />
            </div>
            <div className="plugin-lifecycle-step-body">
              <strong className="plugin-lifecycle-step-title">{t("codexPluginStep2Title")}</strong>
              <span className="plugin-lifecycle-step-desc">{t("codexPluginStep2Desc")}</span>
            </div>
          </div>

          <div className="plugin-lifecycle-step">
            <div className="plugin-lifecycle-step-icon">
              <Coins size={16} />
            </div>
            <div className="plugin-lifecycle-step-body">
              <strong className="plugin-lifecycle-step-title">{t("codexPluginStep3Title")}</strong>
              <span className="plugin-lifecycle-step-desc">{t("codexPluginStep3Desc")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Sticky Floating Save Bar on changes */}
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
