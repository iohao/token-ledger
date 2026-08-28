import { isDemoMode } from "./demo";
import type { ElectronUpdateInfo } from "../types/electron";

export type PendingAppUpdate = ElectronUpdateInfo;

export type AppUpdateProgressEvent =
  | { kind: "started"; contentLength: number | null }
  | { kind: "progress"; chunkLength: number }
  | { kind: "finished" };

export async function fetchCurrentAppVersion(): Promise<string> {
  if (isDemoMode()) {
    return "demo";
  }

  if (typeof window !== "undefined" && window.electronAPI) {
    return window.electronAPI.getAppVersion();
  }

  return "1.0.0";
}

export async function checkForPendingAppUpdate(): Promise<PendingAppUpdate | null> {
  if (isDemoMode() || typeof window === "undefined" || !window.electronAPI) {
    return null;
  }

  return window.electronAPI.checkForUpdates();
}

export async function installPendingAppUpdate(
  _update: PendingAppUpdate,
  onProgress?: (event: AppUpdateProgressEvent) => void
): Promise<void> {
  if (isDemoMode() || typeof window === "undefined" || !window.electronAPI) {
    return;
  }

  let cleanup: (() => void) | undefined;
  if (onProgress) {
    cleanup = window.electronAPI.onUpdateProgress((event) => {
      onProgress({
        kind: event.kind,
        contentLength: event.contentLength ?? null,
        chunkLength: event.chunkLength ?? 0
      });
    });
  }

  try {
    await window.electronAPI.installUpdate();
  } finally {
    if (cleanup) cleanup();
  }
}
