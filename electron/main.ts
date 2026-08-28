import { app, BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, shell, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoUpdater } from "electron-updater";
import { AppState } from "./services/appState";
import type { RelayPricingProviderDTO, SyncProgressDTO } from "../src/dto/dashboard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_REPOSITORY_URL = "https://github.com/iohao/token-ledger";

app.name = "TokenLedger";

let mainWindow: BrowserWindow | null = null;
let appState: AppState | null = null;

function getAppIcon(): Electron.NativeImage | undefined {
  const candidates = [
    path.join(__dirname, "../icons/icon.png"),
    path.join(__dirname, "../../icons/icon.png"),
    path.join(process.resourcesPath, "icons/icon.png")
  ];

  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        return image;
      }
    }
  }

  return undefined;
}

function getAppState(): AppState {
  if (!appState) {
    appState = AppState.detect();
  }
  return appState;
}

function buildAppMenu(window: BrowserWindow): Menu {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "TokenLedger",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  window.webContents.send("open-settings");
                }
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]
      : [
          {
            label: "File",
            submenu: [
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  window.webContents.send("open-settings");
                }
              },
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]),
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Overview",
          accelerator: "CmdOrCtrl+1",
          click: () => {
            window.webContents.send("navigate-tab", "overview");
          }
        },
        {
          label: "Daily Detail",
          accelerator: "CmdOrCtrl+2",
          click: () => {
            window.webContents.send("navigate-tab", "dailyDetail");
          }
        },
        {
          label: "Monthly History",
          accelerator: "CmdOrCtrl+3",
          click: () => {
            window.webContents.send("navigate-tab", "monthlyHistory");
          }
        },
        {
          label: "Monthly Detail",
          accelerator: "CmdOrCtrl+4",
          click: () => {
            window.webContents.send("navigate-tab", "monthlyDetail");
          }
        },
        {
          label: "Relay Pricing",
          accelerator: "CmdOrCtrl+5",
          click: () => {
            window.webContents.send("navigate-tab", "relayPricing");
          }
        },
        {
          label: "Codex Plugin",
          accelerator: "CmdOrCtrl+6",
          click: () => {
            window.webContents.send("navigate-tab", "codexPlugin");
          }
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { type: "separator" as const },
        { role: "close" as const }
      ]
    },
    ...(!isMac
      ? [
          {
            label: "Help",
            submenu: [{ role: "about" as const }]
          }
        ]
      : [])
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "TokenLedger",
    icon: getAppIcon(),
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      contextIsolation: true
    }
  });

  const menu = buildAppMenu(win);
  Menu.setApplicationMenu(menu);

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle("ping", () => "pong");

  ipcMain.handle("get_dashboard", async () => {
    const state = getAppState();
    const repo = state.repository();
    const payload = await repo.buildDashboardPayload(false);
    state.populateDashboardMeta(payload.meta);
    return payload;
  });

  ipcMain.handle("get_sync_preview", async () => {
    const state = getAppState();
    return state.syncPreview();
  });

  ipcMain.handle("start_sync", async (_event, forceFullRescan = false) => {
    const state = getAppState();
    const started = state.tryBeginSync();
    if (!started) {
      return false;
    }

    // Run sync asynchronously in background
    (async () => {
      try {
        const repo = state.repository();
        const publishProgress = (progress: SyncProgressDTO) => {
          state.updateSyncProgress(progress);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("sync-progress", progress);
          }
        };

        await repo.syncWithProgress(forceFullRescan, publishProgress);
      } catch (error) {
        console.error("Background sync failed:", error);
      } finally {
        state.finishSync();
      }
    })();

    return true;
  });

  ipcMain.handle("is_sync_running", () => {
    const state = getAppState();
    return state.isSyncing();
  });

  ipcMain.handle("get_sync_status", () => {
    const state = getAppState();
    return state.repository().currentSyncStatus();
  });

  ipcMain.handle("get_sync_progress", () => {
    const state = getAppState();
    return state.currentSyncProgress();
  });

  ipcMain.handle("get_app_meta", () => {
    const state = getAppState();
    const meta = state.repository().buildDashboardMeta();
    state.populateDashboardMeta(meta);
    return meta;
  });

  ipcMain.handle("open_source_repository", async () => {
    await shell.openExternal(SOURCE_REPOSITORY_URL);
  });

  ipcMain.handle("query_daily_usage", (_event, startDate: string, endDate: string) => {
    const state = getAppState();
    return state.repository().dailyHistoryBetween(startDate, endDate);
  });

  ipcMain.handle("set_database_path", async (_event, databasePath: string) => {
    const state = getAppState();
    state.setDatabasePath(databasePath);
    const repo = state.repository();
    const payload = await repo.buildDashboardPayload(false);
    state.populateDashboardMeta(payload.meta);
    return payload;
  });

  ipcMain.handle("reset_database_path", async () => {
    const state = getAppState();
    state.resetDatabasePath();
    const repo = state.repository();
    const payload = await repo.buildDashboardPayload(false);
    state.populateDashboardMeta(payload.meta);
    return payload;
  });

  ipcMain.handle(
    "set_pricing_providers",
    async (
      _event,
      relayPricingProviders: RelayPricingProviderDTO[],
      openaiUsdPerRmb: number
    ) => {
      const state = getAppState();
      state.setPricingProviders(relayPricingProviders, openaiUsdPerRmb);
      const repo = state.repository();
      const payload = await repo.buildDashboardPayload(false);
      state.populateDashboardMeta(payload.meta);
      return payload;
    }
  );

  ipcMain.handle("get_plugin_config", () => {
    const state = getAppState();
    return state.getPluginConfig();
  });

  ipcMain.handle(
    "set_plugin_config",
    (_event, enabled: boolean, selectedProviderId: string) => {
      const state = getAppState();
      return state.setPluginConfig(enabled, selectedProviderId);
    }
  );

  ipcMain.handle(
    "set_ui_preferences",
    (
      _event,
      preferences: {
        locale?: "zh-CN" | "en-US" | null;
        themeMode?: "dark" | "light" | "system" | null;
        showPageSourceIds?: boolean | null;
      }
    ) => {
      const state = getAppState();
      return state.setUiPreferences(preferences);
    }
  );

  ipcMain.handle("maximize_window", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle("show_window", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  ipcMain.handle("get_app_version", () => {
    return app.getVersion();
  });

  ipcMain.handle("check_for_updates", async () => {
    try {
      if (app.isPackaged) {
        const result = await autoUpdater.checkForUpdates();
        if (result && result.updateInfo) {
          return {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            releaseNotes:
              typeof result.updateInfo.releaseNotes === "string"
                ? result.updateInfo.releaseNotes
                : undefined
          };
        }
      }
    } catch (error) {
      console.warn("Check for updates error:", error);
    }
    return null;
  });

  ipcMain.handle("install_update", async () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
    }
  });
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("download-progress", (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", {
        kind: "progress",
        chunkLength: progressObj.bytesPerSecond,
        contentLength: progressObj.total
      });
    }
  });

  autoUpdater.on("update-downloaded", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", {
        kind: "finished"
      });
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    const appIcon = getAppIcon();
    if (appIcon) {
      app.dock.setIcon(appIcon);
    }
  }

  registerIpcHandlers();
  setupAutoUpdater();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
