import { contextBridge, ipcRenderer } from "electron";
import type {
  CodexPluginConfigDTO,
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  RelayPricingProviderDTO,
  SyncPreviewDTO,
  SyncProgressDTO,
  SyncStatusDTO
} from "../src/dto/dashboard";
import type { ElectronAPI, ElectronUpdateInfo, ElectronUpdateProgress } from "../src/types/electron";

const api: ElectronAPI = {
  ping: () => ipcRenderer.invoke("ping"),
  getDashboard: () => ipcRenderer.invoke("get_dashboard"),
  getSyncPreview: () => ipcRenderer.invoke("get_sync_preview"),
  startSync: (forceFullRescan = false) => ipcRenderer.invoke("start_sync", forceFullRescan),
  isSyncRunning: () => ipcRenderer.invoke("is_sync_running"),
  getSyncStatus: () => ipcRenderer.invoke("get_sync_status"),
  getSyncProgress: () => ipcRenderer.invoke("get_sync_progress"),
  getAppMeta: () => ipcRenderer.invoke("get_app_meta"),
  openSourceRepository: () => ipcRenderer.invoke("open_source_repository"),
  queryDailyUsage: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("query_daily_usage", startDate, endDate),
  setDatabasePath: (databasePath: string) =>
    ipcRenderer.invoke("set_database_path", databasePath),
  resetDatabasePath: () => ipcRenderer.invoke("reset_database_path"),
  setPricingProviders: (
    relayPricingProviders: RelayPricingProviderDTO[],
    openaiUsdPerRmb: number
  ) => ipcRenderer.invoke("set_pricing_providers", relayPricingProviders, openaiUsdPerRmb),
  getPluginConfig: () => ipcRenderer.invoke("get_plugin_config"),
  setPluginConfig: (enabled: boolean, selectedProviderId: string) =>
    ipcRenderer.invoke("set_plugin_config", enabled, selectedProviderId),
  setUiPreferences: (preferences: {
    locale?: string | null;
    themeMode?: string | null;
    showPageSourceIds?: boolean | null;
    relayPricingShowOfficial?: boolean | null;
    relayPricingVisibleModels?: string[] | null;
  }) => ipcRenderer.invoke("set_ui_preferences", preferences),

  maximizeWindow: () => ipcRenderer.invoke("maximize_window"),
  showWindow: () => ipcRenderer.invoke("show_window"),

  getAppVersion: () => ipcRenderer.invoke("get_app_version"),
  checkForUpdates: () => ipcRenderer.invoke("check_for_updates"),
  installUpdate: () => ipcRenderer.invoke("install_update"),

  onSyncProgress: (callback: (progress: SyncProgressDTO) => void) => {
    const handler = (_event: any, progress: SyncProgressDTO) => callback(progress);
    ipcRenderer.on("sync-progress", handler);
    return () => {
      ipcRenderer.removeListener("sync-progress", handler);
    };
  },

  onNavigateTab: (callback: (tab: string) => void) => {
    const handler = (_event: any, tab: string) => callback(tab);
    ipcRenderer.on("navigate-tab", handler);
    return () => {
      ipcRenderer.removeListener("navigate-tab", handler);
    };
  },

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("open-settings", handler);
    return () => {
      ipcRenderer.removeListener("open-settings", handler);
    };
  },

  onUpdateProgress: (callback: (event: ElectronUpdateProgress) => void) => {
    const handler = (_event: any, progress: ElectronUpdateProgress) => callback(progress);
    ipcRenderer.on("update-progress", handler);
    return () => {
      ipcRenderer.removeListener("update-progress", handler);
    };
  }
};

contextBridge.exposeInMainWorld("electronAPI", api);
