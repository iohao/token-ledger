import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { isDemoMode } from "./demo";

export type PendingAppUpdate = Update;

export type AppUpdateProgressEvent =
  | { kind: "started"; contentLength: number | null }
  | { kind: "progress"; chunkLength: number }
  | { kind: "finished" };

export async function fetchCurrentAppVersion(): Promise<string> {
  if (isDemoMode()) {
    return "demo";
  }

  return getVersion();
}

export async function checkForPendingAppUpdate(): Promise<PendingAppUpdate | null> {
  if (isDemoMode()) {
    return null;
  }

  return check();
}

export async function installPendingAppUpdate(
  update: PendingAppUpdate,
  onProgress?: (event: AppUpdateProgressEvent) => void
): Promise<void> {
  if (isDemoMode()) {
    return;
  }

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        onProgress?.({
          kind: "started",
          contentLength: event.data.contentLength ?? null
        });
        break;
      case "Progress":
        onProgress?.({
          kind: "progress",
          chunkLength: event.data.chunkLength
        });
        break;
      case "Finished":
        onProgress?.({ kind: "finished" });
        break;
    }
  });

  await relaunch();
}
