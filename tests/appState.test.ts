import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppState } from "../electron/services/appState";

function removeTempDir(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EBUSY") {
      throw error;
    }
  }
}

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
        showPageSourceIds: null,
        relayPricingShowOfficial: null,
        relayPricingVisibleModels: null
      });

      // Update UI preferences
      appState.setUiPreferences({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true,
        relayPricingShowOfficial: true,
        relayPricingVisibleModels: ["gpt-5.4", "gpt-5.5"]
      });

      expect(appState.getUiPreferences()).toEqual({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true,
        relayPricingShowOfficial: true,
        relayPricingVisibleModels: ["gpt-5.4", "gpt-5.5"]
      });

      // Check populateDashboardMeta
      const repository = appState.repository();
      const meta = repository.buildDashboardMeta();
      appState.populateDashboardMeta(meta);
      repository.store.close();
      expect(meta.locale).toBe("zh-CN");
      expect(meta.themeMode).toBe("dark");
      expect(meta.showPageSourceIds).toBe(true);
      expect(meta.relayPricingShowOfficial).toBe(true);
      expect(meta.relayPricingVisibleModels).toEqual(["gpt-5.4", "gpt-5.5"]);

      // Verify file written to disk
      const settingsPath = path.join(tempDir, ".tokenledger", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const fileData = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      expect(fileData.locale).toBe("zh-CN");
      expect(fileData.themeMode).toBe("dark");
      expect(fileData.showPageSourceIds).toBe(true);
      expect(fileData.relayPricingShowOfficial).toBe(true);
      expect(fileData.relayPricingVisibleModels).toEqual(["gpt-5.4", "gpt-5.5"]);

      // Re-instantiate AppState from same directory to verify persistence
      const reloadedAppState = AppState.detect();
      expect(reloadedAppState.getUiPreferences()).toEqual({
        locale: "zh-CN",
        themeMode: "dark",
        showPageSourceIds: true,
        relayPricingShowOfficial: true,
        relayPricingVisibleModels: ["gpt-5.4", "gpt-5.5"]
      });
    } finally {
      if (prevCodexHome !== undefined) {
        process.env.CODEX_HOME = prevCodexHome;
      } else {
        delete process.env.CODEX_HOME;
      }
      removeTempDir(tempDir);
    }
  });

  it("persists and restores pricing templates in settings.json", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "appstate-templates-test-"));
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    try {
      const appState = AppState.detect();
      const templates = [
        {
          id: "tpl-1",
          name: "Shared Template 1",
          modelPrices: [
            {
              model: "gpt-5.4",
              rates: {
                inputUsdPerMillion: 2.0,
                outputUsdPerMillion: 10.0,
                cacheReadUsdPerMillion: 0.2,
                cacheCreationUsdPerMillion: 2.0
              }
            }
          ]
        }
      ];

      const providers = [
        {
          id: "relay-1",
          name: "Relay 1",
          enabled: true,
          rechargeRatioUsdPerRmb: 0.14,
          multiplier: 1.0,
          templateId: "tpl-1",
          modelPrices: []
        }
      ];

      // Save via setPricingProviders
      appState.setPricingProviders(providers, 0.14, templates);

      // Check repository meta
      const repository = appState.repository();
      const meta = repository.buildDashboardMeta();
      appState.populateDashboardMeta(meta);
      repository.store.close();

      expect(meta.pricingTemplates).toHaveLength(1);
      expect(meta.pricingTemplates?.[0].id).toBe("tpl-1");
      expect(meta.pricingTemplates?.[0].name).toBe("Shared Template 1");

      // Verify file on disk
      const settingsPath = path.join(tempDir, ".tokenledger", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const fileData = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      expect(fileData.pricingTemplates).toHaveLength(1);
      expect(fileData.pricingTemplates[0].name).toBe("Shared Template 1");

      // Reload AppState from disk
      const reloadedAppState = AppState.detect();
      const reloadedRepo = reloadedAppState.repository();
      const reloadedMeta = reloadedRepo.buildDashboardMeta();
      reloadedAppState.populateDashboardMeta(reloadedMeta);
      reloadedRepo.store.close();

      expect(reloadedMeta.pricingTemplates).toHaveLength(1);
      expect(reloadedMeta.pricingTemplates?.[0].name).toBe("Shared Template 1");
    } finally {
      if (prevCodexHome !== undefined) {
        process.env.CODEX_HOME = prevCodexHome;
      } else {
        delete process.env.CODEX_HOME;
      }
      removeTempDir(tempDir);
    }
  });
});
