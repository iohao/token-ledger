import {
  getDemoCodexPluginConfig,
  getDemoDailyUsage,
  getDemoDashboard,
  getDemoSyncPreview,
  getDemoSyncProgress,
  getDemoSyncRunning,
  isDemoMode,
  resetDemoDatabasePath,
  updateDemoCodexPluginConfig,
  updateDemoDatabasePath,
  updateDemoPricingProviders
} from "./demo";

import type {
  CodexPluginConfigDTO,
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  RelayPricingProviderDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  SyncPreviewDTO
} from "../dto/dashboard";

function getElectronAPI() {
  if (typeof window !== "undefined" && window.electronAPI) {
    return window.electronAPI;
  }
  throw new Error("Electron API is not available in the current window context");
}

export function fetchDashboard(): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoDashboard());
  }

  return getElectronAPI().getDashboard();
}

export function fetchSyncPreview(): Promise<SyncPreviewDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncPreview());
  }

  return getElectronAPI().getSyncPreview();
}

export function startSync(forceFullRescan = false): Promise<boolean> {
  if (isDemoMode()) {
    void forceFullRescan;
    return Promise.resolve(false);
  }

  return getElectronAPI().startSync(forceFullRescan);
}

export function isSyncRunning(): Promise<boolean> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncRunning());
  }

  return getElectronAPI().isSyncRunning();
}

export function fetchSyncStatus(): Promise<SyncStatusDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoDashboard().status);
  }

  return getElectronAPI().getSyncStatus();
}

export function fetchCurrentSyncProgress(): Promise<SyncProgressDTO | null> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncProgress());
  }

  return getElectronAPI().getSyncProgress();
}

export function fetchAppMeta(): Promise<DashboardMetaDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoDashboard().meta);
  }

  return getElectronAPI().getAppMeta();
}

export function updateDatabasePath(databasePath: string): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(updateDemoDatabasePath(databasePath));
  }

  return getElectronAPI().setDatabasePath(databasePath);
}

export function resetDatabasePath(): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(resetDemoDatabasePath());
  }

  return getElectronAPI().resetDatabasePath();
}

export function updatePricingProviders(
  relayPricingProviders: RelayPricingProviderDTO[],
  openaiUsdPerRmb: number
): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(updateDemoPricingProviders(relayPricingProviders, openaiUsdPerRmb));
  }

  return getElectronAPI().setPricingProviders(relayPricingProviders, openaiUsdPerRmb);
}

export function openSourceRepository(): Promise<void> {
  if (isDemoMode()) {
    return Promise.resolve();
  }

  return getElectronAPI().openSourceRepository();
}

export function queryDailyUsage(startDate: string, endDate: string): Promise<DailyUsageSummaryDTO[]> {
  if (isDemoMode()) {
    void startDate;
    void endDate;
    return Promise.resolve(getDemoDailyUsage());
  }

  return getElectronAPI().queryDailyUsage(startDate, endDate);
}

export function fetchCodexPluginConfig(): Promise<CodexPluginConfigDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoCodexPluginConfig());
  }

  return getElectronAPI().getPluginConfig();
}

export function updateCodexPluginConfig(
  enabled: boolean,
  selectedProviderId: string
): Promise<CodexPluginConfigDTO> {
  if (isDemoMode()) {
    return Promise.resolve(updateDemoCodexPluginConfig(enabled, selectedProviderId));
  }

  return getElectronAPI().setPluginConfig(enabled, selectedProviderId);
}

export function updateUiPreferences(preferences: {
  locale?: string | null;
  themeMode?: string | null;
  showPageSourceIds?: boolean | null;
  relayPricingShowOfficial?: boolean | null;
  relayPricingVisibleModels?: string[] | null;
}): Promise<{
  locale: string | null;
  themeMode: string | null;
  showPageSourceIds: boolean | null;
  relayPricingShowOfficial?: boolean | null;
  relayPricingVisibleModels?: string[] | null;
}> {
  if (isDemoMode()) {
    return Promise.resolve({
      locale: preferences.locale ?? null,
      themeMode: preferences.themeMode ?? null,
      showPageSourceIds: preferences.showPageSourceIds ?? null,
      relayPricingShowOfficial: preferences.relayPricingShowOfficial ?? null,
      relayPricingVisibleModels: preferences.relayPricingVisibleModels ?? null
    });
  }

  return getElectronAPI().setUiPreferences(preferences);
}
