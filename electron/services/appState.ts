import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deployPluginFiles,
  isHookInstalled,
  pluginPricingPath,
  pluginScriptPath,
  updateHooksJson
} from "./pluginManager";
import {
  DEFAULT_OPENAI_USD_PER_RMB,
  MIGRATED_RELAY_PROVIDER_ID,
  OPENAI_OFFICIAL_PROVIDER_ID,
  validateOpenaiUsdPerRmb,
  validateRelayPricingProviders
} from "./pricing";
import {
  UsageRepository,
  type SessionFileEntry,
  type UsageRepositoryConfig
} from "./repository";
import type {
  CodexPluginConfigDTO,
  DashboardMetaDTO,
  RelayPricingProviderDTO,
  SyncPreviewDTO,
  SyncProgressDTO
} from "../../src/dto/dashboard";

const SYNC_PREVIEW_CACHE_TTL_MS = 5_000;
const SESSION_FILE_SCAN_CACHE_TTL_MS = 15_000;
const APP_SETTINGS_DIR = ".tokenledger";
const LEGACY_APP_SETTINGS_DIRS = [".tokenaccount", ".codex-usage-tauri"];

export interface UiPreferencesState {
  locale: "zh-CN" | "en-US" | null;
  themeMode: "dark" | "light" | "system" | null;
  showPageSourceIds: boolean | null;
  relayPricingShowOfficial: boolean | null;
  relayPricingVisibleModels: string[] | null;
}

export interface AppSettings {
  databasePath?: string | null;
  relayPricingProviders?: RelayPricingProviderDTO[];
  openaiUsdPerRmb?: number;
  modelPricingOverrides?: any[];
  pluginEnabled?: boolean;
  pluginSelectedProviderId?: string;
  locale?: "zh-CN" | "en-US" | null;
  themeMode?: "dark" | "light" | "system" | null;
  showPageSourceIds?: boolean | null;
  relayPricingShowOfficial?: boolean | null;
  relayPricingVisibleModels?: string[] | null;
}

export interface DatabaseConfigState {
  path: string;
  source: "env" | "config" | "default";
}

export class AppState {
  public readonly codexHomePath: string;
  public readonly settingsPath: string;
  public readonly timeZone: string;
  public readonly parseVersion: number = 8;
  public readonly databasePathLocked: boolean;

  private settings: AppSettings;
  private databaseConfig: DatabaseConfigState;
  private syncRunning: boolean = false;
  private syncProgress: SyncProgressDTO | null = null;
  private cachedSyncPreview: { value: SyncPreviewDTO; cachedAt: number } | null = null;
  private cachedSessionFileScan: { entries: SessionFileEntry[]; cachedAt: number } | null = null;

  constructor() {
    const codexHome =
      process.env.CODEX_HOME ||
      (process.env.HOME ? path.join(process.env.HOME, ".codex") : null) ||
      (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".codex") : null) ||
      path.resolve(".codex");

    this.codexHomePath = path.resolve(codexHome);
    this.settingsPath = path.join(this.codexHomePath, APP_SETTINGS_DIR, "settings.json");

    const envDatabasePath = process.env.CODEX_USAGE_DATABASE
      ? path.resolve(process.env.CODEX_USAGE_DATABASE)
      : null;
    this.databasePathLocked = envDatabasePath !== null;

    this.settings = this.loadAppSettings();
    this.migrateLegacyPricingOverrides();

    this.databaseConfig = this.resolveDatabaseConfig(envDatabasePath);

    this.timeZone =
      process.env.TZ?.trim() ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
  }

  public static detect(): AppState {
    return new AppState();
  }

  public repository(): UsageRepository {
    const { relayPricingProviders, openaiUsdPerRmb } = this.pricingConfiguration();
    return new UsageRepository({
      codexHomePath: this.codexHomePath,
      databasePath: this.databaseConfig.path,
      timeZone: this.timeZone,
      parseVersion: this.parseVersion,
      relayPricingProviders,
      openaiUsdPerRmb
    });
  }

  public populateDashboardMeta(meta: DashboardMetaDTO): void {
    meta.databasePath = this.databaseConfig.path;
    meta.databasePathSource = this.databaseConfig.source;
    meta.databasePathEditable = !this.databasePathLocked;
    meta.locale = this.settings.locale ?? null;
    meta.themeMode = this.settings.themeMode ?? null;
    meta.showPageSourceIds =
      typeof this.settings.showPageSourceIds === "boolean"
        ? this.settings.showPageSourceIds
        : null;
    meta.relayPricingShowOfficial =
      typeof this.settings.relayPricingShowOfficial === "boolean"
        ? this.settings.relayPricingShowOfficial
        : null;
    meta.relayPricingVisibleModels =
      Array.isArray(this.settings.relayPricingVisibleModels)
        ? this.settings.relayPricingVisibleModels
        : null;
  }

  public isSyncing(): boolean {
    return this.syncRunning;
  }

  public currentSyncProgress(): SyncProgressDTO | null {
    return this.syncProgress;
  }

  public async syncPreview(): Promise<SyncPreviewDTO> {
    const now = Date.now();
    if (
      this.cachedSyncPreview &&
      now - this.cachedSyncPreview.cachedAt < SYNC_PREVIEW_CACHE_TTL_MS
    ) {
      return this.cachedSyncPreview.value;
    }

    const repo = this.repository();
    let entries: SessionFileEntry[];

    if (
      this.cachedSessionFileScan &&
      now - this.cachedSessionFileScan.cachedAt < SESSION_FILE_SCAN_CACHE_TTL_MS
    ) {
      entries = this.cachedSessionFileScan.entries;
    } else {
      entries = repo.scanSessionFilesSnapshot();
      this.cachedSessionFileScan = { entries, cachedAt: now };
    }

    const preview = repo.computeSyncPreviewFromEntries(entries, false);
    if (!this.syncRunning) {
      this.cachedSyncPreview = { value: preview, cachedAt: now };
    }
    return preview;
  }

  public tryBeginSync(): boolean {
    if (this.syncRunning) {
      return false;
    }
    this.syncRunning = true;
    this.syncProgress = {
      phase: "preparing",
      totalSessionFiles: 0,
      filesToProcess: 0,
      processedFiles: 0,
      removedSessions: 0,
      newSessions: 0,
      changedSessions: 0,
      errorMessage: null
    };
    this.cachedSyncPreview = null;
    return true;
  }

  public updateSyncProgress(progress: SyncProgressDTO): void {
    this.syncProgress = progress;
  }

  public finishSync(): void {
    this.syncRunning = false;
    this.syncProgress = null;
    this.cachedSyncPreview = null;
    this.cachedSessionFileScan = null;
  }

  public setDatabasePath(databasePath: string): void {
    if (this.syncRunning) {
      throw new Error("sync is already running");
    }
    if (this.databasePathLocked) {
      throw new Error(
        "database path is managed by CODEX_USAGE_DATABASE and cannot be changed in the app"
      );
    }
    const trimmed = databasePath.trim();
    if (!trimmed) {
      throw new Error("database path cannot be empty");
    }

    const resolved = path.resolve(trimmed);
    this.settings.databasePath = resolved;
    this.saveSettings();

    this.databaseConfig = {
      path: resolved,
      source: "config"
    };
    this.cachedSyncPreview = null;
  }

  public resetDatabasePath(): void {
    if (this.syncRunning) {
      throw new Error("sync is already running");
    }
    if (this.databasePathLocked) {
      throw new Error(
        "database path is managed by CODEX_USAGE_DATABASE and cannot be changed in the app"
      );
    }

    const defaultPath = this.defaultDatabasePath();
    this.settings.databasePath = null;
    this.saveSettings();

    this.databaseConfig = {
      path: defaultPath,
      source: "default"
    };
    this.cachedSyncPreview = null;
  }

  public setPricingProviders(
    relayPricingProviders: RelayPricingProviderDTO[],
    openaiUsdPerRmb: number
  ): void {
    if (this.syncRunning) {
      throw new Error("sync is already running");
    }
    const validatedRelays = validateRelayPricingProviders(relayPricingProviders);
    const validatedUsdPerRmb = validateOpenaiUsdPerRmb(openaiUsdPerRmb);

    const selectedProviderId =
      this.settings.pluginSelectedProviderId || OPENAI_OFFICIAL_PROVIDER_ID;

    try {
      deployPluginFiles(
        this.codexHomePath,
        validatedRelays,
        selectedProviderId
      );
    } catch {}

    this.settings.relayPricingProviders = validatedRelays;
    this.settings.openaiUsdPerRmb = validatedUsdPerRmb;
    this.settings.modelPricingOverrides = [];
    this.saveSettings();
  }

  public getPluginConfig(): CodexPluginConfigDTO {
    const hookInstalled = isHookInstalled(this.codexHomePath);
    return {
      enabled: this.settings.pluginEnabled ?? false,
      selectedProviderId:
        this.settings.pluginSelectedProviderId || OPENAI_OFFICIAL_PROVIDER_ID,
      hookInstalled,
      pluginPath: pluginScriptPath(this.codexHomePath),
      pricingPath: pluginPricingPath(this.codexHomePath)
    };
  }

  public setPluginConfig(
    enabled: boolean,
    selectedProviderId: string
  ): CodexPluginConfigDTO {
    const { relayPricingProviders } = this.pricingConfiguration();

    deployPluginFiles(
      this.codexHomePath,
      relayPricingProviders,
      selectedProviderId
    );

    updateHooksJson(this.codexHomePath, enabled);

    this.settings.pluginEnabled = enabled;
    this.settings.pluginSelectedProviderId = selectedProviderId;
    this.saveSettings();

    return this.getPluginConfig();
  }

  public getUiPreferences(): UiPreferencesState {
    return {
      locale: this.settings.locale ?? null,
      themeMode: this.settings.themeMode ?? null,
      showPageSourceIds:
        typeof this.settings.showPageSourceIds === "boolean"
          ? this.settings.showPageSourceIds
          : null,
      relayPricingShowOfficial:
        typeof this.settings.relayPricingShowOfficial === "boolean"
          ? this.settings.relayPricingShowOfficial
          : null,
      relayPricingVisibleModels:
        Array.isArray(this.settings.relayPricingVisibleModels)
          ? this.settings.relayPricingVisibleModels
          : null
    };
  }

  public setUiPreferences(preferences: {
    locale?: "zh-CN" | "en-US" | null;
    themeMode?: "dark" | "light" | "system" | null;
    showPageSourceIds?: boolean | null;
    relayPricingShowOfficial?: boolean | null;
    relayPricingVisibleModels?: string[] | null;
  }): UiPreferencesState {
    let changed = false;

    if (preferences.locale !== undefined) {
      if (preferences.locale === "zh-CN" || preferences.locale === "en-US" || preferences.locale === null) {
        if (this.settings.locale !== preferences.locale) {
          this.settings.locale = preferences.locale;
          changed = true;
        }
      }
    }

    if (preferences.themeMode !== undefined) {
      if (
        preferences.themeMode === "dark" ||
        preferences.themeMode === "light" ||
        preferences.themeMode === "system" ||
        preferences.themeMode === null
      ) {
        if (this.settings.themeMode !== preferences.themeMode) {
          this.settings.themeMode = preferences.themeMode;
          changed = true;
        }
      }
    }

    if (preferences.showPageSourceIds !== undefined) {
      if (typeof preferences.showPageSourceIds === "boolean" || preferences.showPageSourceIds === null) {
        if (this.settings.showPageSourceIds !== preferences.showPageSourceIds) {
          this.settings.showPageSourceIds = preferences.showPageSourceIds;
          changed = true;
        }
      }
    }

    if (preferences.relayPricingShowOfficial !== undefined) {
      if (typeof preferences.relayPricingShowOfficial === "boolean" || preferences.relayPricingShowOfficial === null) {
        if (this.settings.relayPricingShowOfficial !== preferences.relayPricingShowOfficial) {
          this.settings.relayPricingShowOfficial = preferences.relayPricingShowOfficial;
          changed = true;
        }
      }
    }

    if (preferences.relayPricingVisibleModels !== undefined) {
      if (Array.isArray(preferences.relayPricingVisibleModels) || preferences.relayPricingVisibleModels === null) {
        const next =
          preferences.relayPricingVisibleModels === null
            ? null
            : preferences.relayPricingVisibleModels.map(String);
        const curr = this.settings.relayPricingVisibleModels ?? null;
        const isDifferent =
          next === null
            ? curr !== null
            : curr === null ||
              next.length !== curr.length ||
              next.some((val, i) => val !== curr[i]);
        if (isDifferent) {
          this.settings.relayPricingVisibleModels = next;
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveSettings();
    }

    return this.getUiPreferences();
  }

  private pricingConfiguration(): {
    relayPricingProviders: RelayPricingProviderDTO[];
    openaiUsdPerRmb: number;
  } {
    const ratio =
      typeof this.settings.openaiUsdPerRmb === "number" &&
      Number.isFinite(this.settings.openaiUsdPerRmb) &&
      this.settings.openaiUsdPerRmb > 0
        ? this.settings.openaiUsdPerRmb
        : DEFAULT_OPENAI_USD_PER_RMB;

    return {
      relayPricingProviders: this.settings.relayPricingProviders ?? [],
      openaiUsdPerRmb: ratio
    };
  }

  private defaultDatabasePath(): string {
    return path.join(this.codexHomePath, ".codex-usage", "usage.sqlite");
  }

  private resolveDatabaseConfig(envDatabasePath: string | null): DatabaseConfigState {
    if (envDatabasePath) {
      return {
        path: envDatabasePath,
        source: "env"
      };
    }
    if (this.settings.databasePath) {
      return {
        path: path.resolve(this.settings.databasePath),
        source: "config"
      };
    }
    return {
      path: this.defaultDatabasePath(),
      source: "default"
    };
  }

  private loadAppSettings(): AppSettings {
    if (fs.existsSync(this.settingsPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      } catch {}
    }

    for (const legacyDir of LEGACY_APP_SETTINGS_DIRS) {
      const legacyPath = path.join(this.codexHomePath, legacyDir, "settings.json");
      if (fs.existsSync(legacyPath)) {
        try {
          return JSON.parse(fs.readFileSync(legacyPath, "utf8"));
        } catch {}
      }
    }

    return {
      databasePath: null,
      relayPricingProviders: [],
      openaiUsdPerRmb: DEFAULT_OPENAI_USD_PER_RMB,
      modelPricingOverrides: [],
      pluginEnabled: false,
      pluginSelectedProviderId: OPENAI_OFFICIAL_PROVIDER_ID,
      locale: null,
      themeMode: null,
      showPageSourceIds: null,
      relayPricingShowOfficial: null,
      relayPricingVisibleModels: null
    };
  }

  private saveSettings(): void {
    const parentDir = path.dirname(this.settingsPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(
      this.settingsPath,
      JSON.stringify(this.settings, null, 2),
      "utf8"
    );
  }

  private migrateLegacyPricingOverrides(): void {
    if (this.settings.relayPricingProviders !== undefined && this.settings.relayPricingProviders !== null) {
      return;
    }

    const legacy = this.settings.modelPricingOverrides ?? [];
    const modelPrices = legacy.map((s: any) => ({
      model: s.model,
      rates: { ...s.rates }
    }));

    this.settings.relayPricingProviders =
      modelPrices.length === 0
        ? []
        : [
            {
              id: MIGRATED_RELAY_PROVIDER_ID,
              name: "Migrated relay",
              enabled: false,
              rechargeRatioUsdPerRmb: null,
              multiplier: 1.0,
              modelPrices
            }
          ];
  }
}
