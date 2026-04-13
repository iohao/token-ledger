import { invoke } from "@tauri-apps/api/core";
import {
  getDemoDailyUsage,
  getDemoDashboard,
  getDemoSyncPreview,
  getDemoSyncProgress,
  getDemoSyncRunning,
  isDemoMode,
  resetDemoDatabasePath,
  updateDemoDatabasePath
} from "./demo";

import type {
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  SyncPreviewDTO
} from "../dto/dashboard";

export function fetchDashboard(): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoDashboard());
  }

  return invoke<DashboardPayloadDTO>("get_dashboard");
}

export function fetchSyncPreview(): Promise<SyncPreviewDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncPreview());
  }

  return invoke<SyncPreviewDTO>("get_sync_preview");
}

export function startSync(forceFullRescan = false): Promise<boolean> {
  if (isDemoMode()) {
    void forceFullRescan;
    return Promise.resolve(false);
  }

  return invoke<boolean>("start_sync", {
    forceFullRescan
  });
}

export function isSyncRunning(): Promise<boolean> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncRunning());
  }

  return invoke<boolean>("is_sync_running");
}

export function fetchSyncStatus(): Promise<SyncStatusDTO> {
  return invoke<SyncStatusDTO>("get_sync_status");
}

export function fetchCurrentSyncProgress(): Promise<SyncProgressDTO | null> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoSyncProgress());
  }

  return invoke<SyncProgressDTO | null>("get_sync_progress");
}

export function fetchAppMeta(): Promise<DashboardMetaDTO> {
  if (isDemoMode()) {
    return Promise.resolve(getDemoDashboard().meta);
  }

  return invoke<DashboardMetaDTO>("get_app_meta");
}

export function updateDatabasePath(databasePath: string): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(updateDemoDatabasePath(databasePath));
  }

  return invoke<DashboardPayloadDTO>("set_database_path", {
    databasePath
  });
}

export function resetDatabasePath(): Promise<DashboardPayloadDTO> {
  if (isDemoMode()) {
    return Promise.resolve(resetDemoDatabasePath());
  }

  return invoke<DashboardPayloadDTO>("reset_database_path");
}

export function queryDailyUsage(startDate: string, endDate: string): Promise<DailyUsageSummaryDTO[]> {
  if (isDemoMode()) {
    void startDate;
    void endDate;
    return Promise.resolve(getDemoDailyUsage());
  }

  return invoke<DailyUsageSummaryDTO[]>("query_daily_usage", {
    startDate,
    endDate
  });
}
