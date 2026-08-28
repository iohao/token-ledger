import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppState } from "../electron/services/appState";

describe("appState service", () => {
  it("initializes and handles sync lifecycle", () => {
    const appState = AppState.detect();
    expect(appState.isSyncing()).toBe(false);

    const started = appState.tryBeginSync();
    expect(started).toBe(true);
    expect(appState.isSyncing()).toBe(true);
    expect(appState.currentSyncProgress()?.phase).toBe("preparing");

    // Cannot start sync twice
    const startedTwice = appState.tryBeginSync();
    expect(startedTwice).toBe(false);

    appState.finishSync();
    expect(appState.isSyncing()).toBe(false);
    expect(appState.currentSyncProgress()).toBeNull();
  });

  it("persists and restores UI preferences in settings.json", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "appstate-test-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    try {
      const appState = AppState.detect();
      expect(appState.getUiPreferences()).toEqual({
        locale: null,
        themeMode: null,
        showPageSourceIds: null
      });

      // Update UI preferences
      appState.setUiPreferences({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true
      });

      expect(appState.getUiPreferences()).toEqual({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true
      });

      // Check populateDashboardMeta
      const meta = appState.repository().buildDashboardMeta();
      appState.populateDashboardMeta(meta);
      expect(meta.locale).toBe("zh-CN");
      expect(meta.themeMode).toBe("dark");
      expect(meta.showPageSourceIds).toBe(true);

      // Verify file written to disk
      const settingsPath = path.join(tempDir, ".tokenledger", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const fileData = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      expect(fileData.locale).toBe("zh-CN");
      expect(fileData.themeMode).toBe("dark");
      expect(fileData.showPageSourceIds).toBe(true);

      // Re-instantiate AppState from same directory to verify persistence
      const reloadedAppState = AppState.detect();
      expect(reloadedAppState.getUiPreferences()).toEqual({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true
      });
    } finally {
      if (prevCodexHome !== undefined) {
        process.env.CODEX_HOME = prevCodexHome;
      } else {
        delete process.env.CODEX_HOME;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
