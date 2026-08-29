import type {
  CodexPluginConfigDTO,
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  RelayPricingProviderDTO,
  SyncPreviewDTO,
  SyncProgressDTO,
  SyncStatusDTO
} from "../dto/dashboard";

export interface ElectronUpdateProgress {
  kind: "started" | "progress" | "finished";
  contentLength?: number | null;
  chunkLength?: number;
}

export interface ElectronUpdateInfo {
  version: string;
  date?: string;
  releaseDate?: string;
  releaseNotes?: string;
  body?: string;
}

export interface ElectronAPI {
  ping: () => Promise<string>;
  getDashboard: () => Promise<DashboardPayloadDTO>;
  getSyncPreview: () => Promise<SyncPreviewDTO>;
  startSync: (forceFullRescan?: boolean) => Promise<boolean>;
  isSyncRunning: () => Promise<boolean>;
  getSyncStatus: () => Promise<SyncStatusDTO>;
  getSyncProgress: () => Promise<SyncProgressDTO | null>;
  getAppMeta: () => Promise<DashboardMetaDTO>;
  openSourceRepository: () => Promise<void>;
  queryDailyUsage: (startDate: string, endDate: string) => Promise<DailyUsageSummaryDTO[]>;
  setDatabasePath: (databasePath: string) => Promise<DashboardPayloadDTO>;
  resetDatabasePath: () => Promise<DashboardPayloadDTO>;
  setPricingProviders: (
    relayPricingProviders: RelayPricingProviderDTO[],
    openaiUsdPerRmb: number
  ) => Promise<DashboardPayloadDTO>;
  getPluginConfig: () => Promise<CodexPluginConfigDTO>;
  setPluginConfig: (
    enabled: boolean,
    selectedProviderId: string
  ) => Promise<CodexPluginConfigDTO>;
  setUiPreferences: (preferences: {
    locale?: string | null;
    themeMode?: string | null;
    showPageSourceIds?: boolean | null;
    relayPricingShowOfficial?: boolean | null;
    relayPricingVisibleModels?: string[] | null;
  }) => Promise<{
    locale: string | null;
    themeMode: string | null;
    showPageSourceIds: boolean | null;
    relayPricingShowOfficial?: boolean | null;
    relayPricingVisibleModels?: string[] | null;
  }>;

  // Window control
  maximizeWindow: () => Promise<void>;
  showWindow: () => Promise<void>;

  // App & Updates
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<ElectronUpdateInfo | null>;
  installUpdate: () => Promise<void>;

  // Event Subscriptions
  onSyncProgress: (callback: (progress: SyncProgressDTO) => void) => () => void;
  onNavigateTab: (callback: (tab: string) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onUpdateProgress: (callback: (event: ElectronUpdateProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
