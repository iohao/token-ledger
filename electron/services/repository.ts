import fs from "node:fs";
import path from "node:path";
import {
  addDaysToDateKey,
  dateKeyFor,
  formatUtcTimestamp,
  lastNDateKeys,
  monthKeyFor
} from "./dateKeys";
import {
  costFor,
  costForProvider,
  costForRates,
  officialPricingFor,
  pricingIdentity,
  pricingProviders
} from "./pricing";
import {
  addUsageTotals,
  parseSessionFile,
  type DailySessionModelUsage,
  type ParsedSessionFile
} from "./parser";
import {
  UsageStore,
  type SourceSessionRecord,
  type StoredDailyAggregate,
  type StoredMonthlyAggregate
} from "./store";
import type {
  DailyActualSpendDTO,
  DailyProviderActualSpendDTO,
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  ModelUsageBreakdownDTO,
  MonthlyUsageSummaryDTO,
  PricingComparisonDTO,
  PricingProviderDTO,
  PricingTemplateDTO,
  ProviderCostComparisonDTO,
  RelayPricingProviderDTO,
  SyncPreviewDTO,
  SyncProgressDTO,
  SyncStatusDTO,
  UsagePeriod,
  UsageSummaryDTO,
  UsageTotalsDTO
} from "../../src/dto/dashboard";

export interface SessionFileEntry {
  sessionId: string;
  filePath: string;
  relativePath: string;
  fileSize: number;
  modifiedAt: Date;
}

export interface UsageRepositoryConfig {
  codexHomePath: string;
  databasePath: string;
  timeZone: string;
  parseVersion: number;
  relayPricingProviders: RelayPricingProviderDTO[];
  openaiUsdPerRmb: number;
  pricingTemplates?: PricingTemplateDTO[];
  isSyncRunning?: () => boolean;
}

function emptyTotals(): UsageTotalsDTO {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    costUSD: 0.0
  };
}

function sortBreakdowns(rows: ModelUsageBreakdownDTO[]): void {
  rows.sort((left, right) => {
    if (right.totals.totalTokens !== left.totals.totalTokens) {
      return right.totals.totalTokens - left.totals.totalTokens;
    }
    if (left.model !== right.model) {
      return left.model.localeCompare(right.model);
    }
    return Number(left.isFallback) - Number(right.isFallback);
  });
}

function sumDailyRows(rows: StoredDailyAggregate[]): UsageTotalsDTO {
  return rows.reduce(
    (totals, row) => addUsageTotals(totals, row.totals),
    emptyTotals()
  );
}

function sumMonthlyRows(rows: StoredMonthlyAggregate[]): UsageTotalsDTO {
  return rows.reduce(
    (totals, row) => addUsageTotals(totals, row.totals),
    emptyTotals()
  );
}

function aggregateDailyRows(rows: StoredDailyAggregate[]): ModelUsageBreakdownDTO[] {
  const grouped = new Map<string, ModelUsageBreakdownDTO>();

  for (const row of rows) {
    const key = `${row.model}\0${row.isFallback ? 1 : 0}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.totals = addUsageTotals(existing.totals, row.totals);
    } else {
      grouped.set(key, {
        model: row.model,
        isFallback: row.isFallback,
        totals: { ...row.totals }
      });
    }
  }

  const values = Array.from(grouped.values());
  sortBreakdowns(values);
  return values;
}

function dateKeysDescendingBetween(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  let cursor = endDate;

  while (true) {
    keys.push(cursor);
    if (cursor === startDate) {
      break;
    }
    cursor = addDaysToDateKey(cursor, -1);
  }

  return keys;
}

function validatedDateRange(startDate: string, endDate: string): [string, string] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`unsupported date format: ${startDate} or ${endDate}`);
  }
  if (startDate > endDate) {
    throw new Error("start_date must be on or before end_date");
  }
  return [startDate, endDate];
}

function progressStride(total: number): number {
  if (total <= 100) return 1;
  return Math.max(1, Math.floor(total / 100));
}

function removedSessionIds(
  entries: SessionFileEntry[],
  existingRecords: Map<string, SourceSessionRecord>
): string[] {
  const currentSessionIds = new Set(entries.map((e) => e.sessionId));
  const removed: string[] = [];
  for (const sessionId of existingRecords.keys()) {
    if (!currentSessionIds.has(sessionId)) {
      removed.push(sessionId);
    }
  }
  return removed;
}

export function parseCodexConfigTomlProviders(
  codexHomePath: string
): Map<string, { name?: string; baseUrl?: string }> {
  const map = new Map<string, { name?: string; baseUrl?: string }>();
  const configPath = path.join(codexHomePath, "config.toml");
  if (!fs.existsSync(configPath)) return map;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const lines = content.split("\n");
    let currentId: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const sectionMatch = line.match(/^\[model_providers\.([a-zA-Z0-9_\-]+)\]$/);
      if (sectionMatch) {
        currentId = sectionMatch[1].toLowerCase();
        if (!map.has(currentId)) {
          map.set(currentId, {});
        }
        continue;
      }
      if (line.startsWith("[")) {
        currentId = null;
        continue;
      }
      if (currentId) {
        const kvMatch = line.match(/^([a-zA-Z0-9_\-]+)\s*=\s*["']([^"']*)["']/);
        if (kvMatch) {
          const key = kvMatch[1];
          const val = kvMatch[2];
          const entry = map.get(currentId)!;
          if (key === "name") entry.name = val;
          if (key === "base_url") entry.baseUrl = val;
        }
      }
    }
  } catch {}

  return map;
}

export function matchPricingProvider(
  codexProvider: string,
  providers: PricingProviderDTO[],
  configTomlProviders?: Map<string, { name?: string; baseUrl?: string }>
): PricingProviderDTO | null {
  const normalized = codexProvider.trim().toLowerCase();

  // 1. Explicit codexProviderId match
  const explicit = providers.find(
    (p) => p.codexProviderId && p.codexProviderId.trim().toLowerCase() === normalized
  );
  if (explicit) return explicit;

  // 2. Direct name match
  const nameMatch = providers.find(
    (p) => p.name.trim().toLowerCase() === normalized
  );
  if (nameMatch) return nameMatch;

  // 3. ID match
  const idMatch = providers.find(
    (p) => p.id.trim().toLowerCase() === normalized
  );
  if (idMatch) return idMatch;

  // 4. Check config.toml info matching provider name
  if (configTomlProviders && configTomlProviders.has(normalized)) {
    const info = configTomlProviders.get(normalized)!;
    const infoName = (info.name || "").toLowerCase();
    const infoUrl = (info.baseUrl || "").toLowerCase();
    const match = providers.find((p) => {
      const pName = p.name.toLowerCase();
      return (infoName && infoName.includes(pName)) || (infoUrl && infoUrl.includes(pName));
    });
    if (match) return match;
  }

  // 5. Prefix match
  const prefixMatch = providers.find(
    (p) =>
      p.name.trim().toLowerCase().startsWith(normalized) ||
      normalized.startsWith(p.name.trim().toLowerCase())
  );
  if (prefixMatch) return prefixMatch;

  return null;
}

export function getActualSpendProviderPrice(item: {
  multiplier?: string | number | null;
  rechargeRatioUsdPerRmb?: string | number | null;
  effectiveCost?: number | null;
}): number | null {
  if (item.effectiveCost !== undefined && item.effectiveCost !== null) {
    return Number.isFinite(item.effectiveCost) && item.effectiveCost > 0
      ? item.effectiveCost
      : null;
  }
  const multiplier =
    item.multiplier === undefined || item.multiplier === null || item.multiplier === ""
      ? 1.0
      : typeof item.multiplier === "number"
        ? item.multiplier > 0 && Number.isFinite(item.multiplier)
          ? item.multiplier
          : null
        : Number.parseFloat(String(item.multiplier));

  const ratio =
    typeof item.rechargeRatioUsdPerRmb === "number"
      ? item.rechargeRatioUsdPerRmb > 0 && Number.isFinite(item.rechargeRatioUsdPerRmb)
        ? item.rechargeRatioUsdPerRmb
        : null
      : Number.parseFloat(String(item.rechargeRatioUsdPerRmb ?? ""));

  if (
    multiplier === null ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    ratio === null ||
    !Number.isFinite(ratio) ||
    ratio <= 0
  ) {
    return null;
  }

  const cost = multiplier / ratio;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function compareActualSpendProviders<
  T extends {
    providerName?: string;
    name?: string;
    multiplier?: string | number | null;
    rechargeRatioUsdPerRmb?: string | number | null;
    effectiveCost?: number | null;
  }
>(a: T, b: T): number {
  const priceA = getActualSpendProviderPrice(a);
  const priceB = getActualSpendProviderPrice(b);

  const nameA = a.providerName ?? a.name ?? "";
  const nameB = b.providerName ?? b.name ?? "";

  // 价格越高的越在后面 (升序: 便宜的在前，贵的在后)
  if (priceA !== null && priceB !== null) {
    if (Math.abs(priceA - priceB) > 1e-9) {
      return priceA - priceB;
    }
    return nameA.localeCompare(nameB);
  }

  if (priceA !== null) {
    return -1;
  }
  if (priceB !== null) {
    return 1;
  }

  return nameA.localeCompare(nameB);
}

export class UsageRepository {
  public readonly codexHomePath: string;
  public readonly databasePath: string;
  public readonly timeZone: string;
  public readonly parseVersion: number;
  private readonly relayPricingProviders: RelayPricingProviderDTO[];
  private readonly openaiUsdPerRmb: number;
  public readonly pricingTemplates: PricingTemplateDTO[];
  private readonly isSyncRunning?: () => boolean;
  public readonly store: UsageStore;

  constructor(config: UsageRepositoryConfig) {
    this.codexHomePath = path.resolve(config.codexHomePath);
    this.databasePath = path.resolve(config.databasePath);
    this.timeZone = config.timeZone;
    this.parseVersion = config.parseVersion;
    this.relayPricingProviders = config.relayPricingProviders;
    this.openaiUsdPerRmb = config.openaiUsdPerRmb;
    this.pricingTemplates = config.pricingTemplates ?? [];
    this.isSyncRunning = config.isSyncRunning;
    this.store = new UsageStore(this.databasePath);
  }

  public getPricingProviders(): PricingProviderDTO[] {
    return pricingProviders(this.relayPricingProviders, this.openaiUsdPerRmb, this.pricingTemplates);
  }

  public buildDashboardMeta(): DashboardMetaDTO {
    return this.buildDashboardMetaWithProviders(this.getPricingProviders());
  }

  private buildDashboardMetaWithProviders(
    providers: PricingProviderDTO[]
  ): DashboardMetaDTO {
    return {
      codexHomePath: this.codexHomePath,
      databasePath: this.databasePath,
      databasePathSource: "default",
      databasePathEditable: true,
      timeZone: this.timeZone,
      parseVersion: this.parseVersion,
      pricingProviders: providers,
      pricingTemplates: this.pricingTemplates
    };
  }

  private static providerCostComparisons(
    summaries: UsageSummaryDTO[],
    providers: PricingProviderDTO[]
  ): PricingComparisonDTO[] {
    return summaries.map((summary) => ({
      period: summary.period,
      providers: providers
        .filter((p) => p.enabled)
        .map((provider) => {
          const result = costForProvider(summary.models, provider);
          const costCny =
            result.costUsd !== null && provider.rechargeRatioUsdPerRmb
              ? result.costUsd / provider.rechargeRatioUsdPerRmb
              : null;
          return {
            providerId: provider.id,
            isComplete: costCny !== null,
            costUsd: result.costUsd,
            costCny,
            fallbackModels: result.fallbackModels,
            unpricedModels: result.unpricedModels
          };
        })
    }));
  }

  public async buildDashboardPayload(
    includeSyncPreview: boolean
  ): Promise<DashboardPayloadDTO> {
    this.store.ensureAggregates();
    const status = this.currentSyncStatus();
    const periods: UsagePeriod[] = ["today", "last7Days", "monthToDate"];
    const summaries = periods.map((period) =>
      this.summaryWithStatus(period, status)
    );
    const providers = this.getPricingProviders();
    const providerCostComparisons = UsageRepository.providerCostComparisons(
      summaries,
      providers
    );

    return {
      meta: this.buildDashboardMetaWithProviders(providers),
      status,
      syncPreview: includeSyncPreview ? await this.syncPreview() : null,
      summaries,
      providerCostComparisons,
      dailyHistory: this.last7DayHistoryWithStatus(status),
      activityHistory: this.activityHistoryWithStatus(status),
      monthlyHistory: this.monthlyHistoryWithStatus(status),
      actualSpendHistory: this.actualSpendHistoryLastNDays(7),
      now: formatUtcTimestamp(new Date())
    };
  }

  public currentSyncStatus(): SyncStatusDTO {
    const status = this.store.loadSyncStatus();
    if (status.state === "syncing" && this.isSyncRunning && !this.isSyncRunning()) {
      const repairedStatus: SyncStatusDTO = {
        ...status,
        state: "idle",
        errorMessage: null
      };
      this.store.saveSyncStatus(repairedStatus);
      return repairedStatus;
    }
    return status;
  }

  public dailyHistoryBetween(
    startDate: string,
    endDate: string
  ): DailyUsageSummaryDTO[] {
    const status = this.currentSyncStatus();
    const [lowerBound, upperBound] = validatedDateRange(startDate, endDate);
    const keys = dateKeysDescendingBetween(lowerBound, upperBound);
    return this.dailyHistoryForKeysWithStatus(keys, status);
  }

  public async syncAndBuildDashboard(
    forceFullRescan: boolean
  ): Promise<DashboardPayloadDTO> {
    const status = await this.sync(forceFullRescan);
    const totalSessionFiles = Math.max(0, status.scannedFiles);
    const payload = await this.buildDashboardPayload(false);
    payload.status = status;
    payload.syncPreview = {
      needsSync: false,
      newSessions: 0,
      changedSessions: 0,
      removedSessions: 0,
      totalTrackedSessions: totalSessionFiles,
      totalSessionFiles
    };
    return payload;
  }

  public async syncPreview(): Promise<SyncPreviewDTO> {
    const entries = this.scanSessionFilesSnapshot();
    const requiresRescan = this.requiresFullRescan();
    return this.computeSyncPreviewFromEntries(entries, requiresRescan);
  }

  public computeSyncPreviewFromEntries(
    entries: SessionFileEntry[],
    forceAllDirty: boolean
  ): SyncPreviewDTO {
    const existingRecords = this.store.loadSourceSessions();

    if (forceAllDirty) {
      return {
        needsSync: entries.length > 0 || existingRecords.size > 0,
        newSessions: 0,
        changedSessions: entries.length,
        removedSessions: 0,
        totalTrackedSessions: existingRecords.size,
        totalSessionFiles: entries.length
      };
    }

    const { dirtyEntries, newSessions } = this.findDirtyEntries(
      entries,
      existingRecords
    );
    const removedCount = removedSessionIds(entries, existingRecords).length;

    return {
      needsSync: dirtyEntries.length > 0 || removedCount > 0,
      newSessions,
      changedSessions: Math.max(0, dirtyEntries.length - newSessions),
      removedSessions: removedCount,
      totalTrackedSessions: existingRecords.size,
      totalSessionFiles: entries.length
    };
  }

  public async sync(forceFullRescan: boolean): Promise<SyncStatusDTO> {
    return this.syncWithProgress(forceFullRescan, () => {});
  }

  public async syncWithProgress(
    forceFullRescan: boolean,
    onProgress: (progress: SyncProgressDTO) => void
  ): Promise<SyncStatusDTO> {
    const previousStatus = this.currentSyncStatus();
    const requiresRescan = forceFullRescan || this.requiresFullRescan();

    let lastProgress: SyncProgressDTO = {
      phase: "preparing",
      totalSessionFiles: 0,
      filesToProcess: 0,
      processedFiles: 0,
      removedSessions: 0,
      newSessions: 0,
      changedSessions: 0,
      errorMessage: null
    };

    onProgress(lastProgress);

    const publishProgress = (progress: SyncProgressDTO) => {
      lastProgress = { ...progress };
      onProgress(progress);
    };

    const syncingStatus: SyncStatusDTO = {
      ...previousStatus,
      state: "syncing",
      errorMessage: null
    };
    this.store.saveSyncStatus(syncingStatus);

    const now = new Date();

    try {
      const status = await this.performSync(
        requiresRescan,
        now,
        null,
        publishProgress
      );
      this.store.saveSyncStatus(status);
      publishProgress({
        ...lastProgress,
        phase: "complete",
        errorMessage: null
      });
      return status;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const failedStatus: SyncStatusDTO = {
        ...previousStatus,
        state: "failed",
        errorMessage: errMsg
      };
      this.store.saveSyncStatus(failedStatus);
      publishProgress({
        ...lastProgress,
        phase: "failed",
        errorMessage: errMsg
      });
      throw error;
    }
  }

  private async performSync(
    requiresRescan: boolean,
    now: Date,
    scannedEntries: SessionFileEntry[] | null,
    onProgress: (progress: SyncProgressDTO) => void
  ): Promise<SyncStatusDTO> {
    onProgress({
      phase: "scanningFiles",
      totalSessionFiles: 0,
      filesToProcess: 0,
      processedFiles: 0,
      removedSessions: 0,
      newSessions: 0,
      changedSessions: 0,
      errorMessage: null
    });

    const sessionsRoot = path.join(this.codexHomePath, "sessions");
    const entries = scannedEntries ?? this.scanSessionFiles(sessionsRoot);
    const existingRecords = this.store.loadSourceSessions();

    let dirtyEntries: SessionFileEntry[];
    let newSessions: number;

    if (requiresRescan) {
      dirtyEntries = entries;
      newSessions = 0;
    } else {
      const res = this.findDirtyEntries(entries, existingRecords);
      dirtyEntries = res.dirtyEntries;
      newSessions = res.newSessions;
    }

    const removedIds = requiresRescan
      ? []
      : removedSessionIds(entries, existingRecords);
    const changedSessions = Math.max(0, dirtyEntries.length - newSessions);
    const removedSessions = removedIds.length;
    const totalSessionFiles = entries.length;
    const filesToProcess = dirtyEntries.length;

    if (requiresRescan) {
      this.store.resetCache();
    }

    let syncProgress: SyncProgressDTO = {
      phase: "processingFiles",
      totalSessionFiles,
      filesToProcess,
      processedFiles: 0,
      removedSessions,
      newSessions,
      changedSessions,
      errorMessage: null
    };
    onProgress(syncProgress);

    const affectedSessionIds = [
      ...dirtyEntries.map((e) => e.sessionId),
      ...removedIds
    ];
    const affectedDateKeys = new Set<string>(
      this.store.listDateKeysForSessions(affectedSessionIds)
    );

    const stride = progressStride(filesToProcess);
    const batchSize = Math.min(64, Math.max(16, stride));

    for (let i = 0; i < dirtyEntries.length; i += batchSize) {
      const chunk = dirtyEntries.slice(i, i + batchSize);
      const parsedChunk: ParsedSessionFile[] = await Promise.all(
        chunk.map(async (entry) => {
          const parsedFile = await parseSessionFile(
            entry.filePath,
            sessionsRoot,
            this.timeZone
          );
          for (const usage of parsedFile.usages) {
            usage.totals.costUSD = costFor(usage.totals, usage.model);
          }
          return parsedFile;
        })
      );

      for (const parsedFile of parsedChunk) {
        for (const usage of parsedFile.usages) {
          affectedDateKeys.add(usage.dateKey);
        }
      }

      this.store.replaceSessionFiles(parsedChunk, this.parseVersion, now);

      const previousProcessed = syncProgress.processedFiles;
      syncProgress = {
        ...syncProgress,
        processedFiles: syncProgress.processedFiles + chunk.length
      };

      if (
        syncProgress.processedFiles === filesToProcess ||
        previousProcessed === 0 ||
        Math.floor(syncProgress.processedFiles / stride) !==
          Math.floor(previousProcessed / stride)
      ) {
        onProgress(syncProgress);
      }
    }

    if (removedIds.length > 0) {
      this.store.deleteSessions(removedIds);
    }

    onProgress({
      ...syncProgress,
      phase: "finalizing"
    });

    if (requiresRescan) {
      this.store.rebuildAllAggregates();
    } else {
      this.store.rebuildAggregatesForDateKeys(Array.from(affectedDateKeys));
      this.store.ensureAggregates();
    }
    this.store.saveSyncContext({
      codexHomePath: this.codexHomePath,
      timeZone: this.timeZone,
      parseVersion: this.parseVersion
    });

    const latestUsage = this.store.latestSourceUsageAt();

    return {
      state: "success",
      lastSyncedAt: formatUtcTimestamp(now),
      errorMessage: null,
      coverageThrough: latestUsage ? formatUtcTimestamp(latestUsage) : null,
      coverageGranularity: "minute",
      scannedFiles: totalSessionFiles,
      sessionCount: filesToProcess + removedSessions,
      dataSource: "jsonlDirect"
    };
  }

  public scanSessionFilesSnapshot(): SessionFileEntry[] {
    const sessionsRoot = path.join(this.codexHomePath, "sessions");
    return this.scanSessionFiles(sessionsRoot);
  }

  public scanSessionFiles(sessionsRoot: string): SessionFileEntry[] {
    if (!fs.existsSync(sessionsRoot)) {
      return [];
    }

    const entries: SessionFileEntry[] = [];

    function traverse(currentDir: string): void {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
          traverse(fullPath);
        } else if (item.isFile() && item.name.endsWith(".jsonl")) {
          try {
            const stat = fs.statSync(fullPath);
            const relativePath = path
              .relative(sessionsRoot, fullPath)
              .split(path.sep)
              .join("/");
            const sessionId = relativePath.endsWith(".jsonl")
              ? relativePath.slice(0, -6)
              : relativePath;

            entries.push({
              sessionId,
              filePath: fullPath,
              relativePath,
              fileSize: stat.size,
              modifiedAt: stat.mtime
            });
          } catch {}
        }
      }
    }

    traverse(sessionsRoot);
    return entries;
  }

  public findDirtyEntries(
    entries: SessionFileEntry[],
    existingRecords: Map<string, SourceSessionRecord>
  ): { dirtyEntries: SessionFileEntry[]; newSessions: number } {
    const dirtyEntries: SessionFileEntry[] = [];
    let newSessions = 0;

    for (const entry of entries) {
      const existing = existingRecords.get(entry.sessionId);
      if (!existing) {
        dirtyEntries.push(entry);
        newSessions += 1;
        continue;
      }

      const sameSize = existing.fileSize === entry.fileSize;
      const existingModified = new Date(existing.modifiedAt).getTime();
      const sameModifiedAt =
        !isNaN(existingModified) &&
        Math.abs(existingModified - entry.modifiedAt.getTime()) < 500;
      const sameParseVersion = existing.parseVersion === this.parseVersion;
      const sameRelativePath = existing.relativePath === entry.relativePath;

      if (!(sameSize && sameModifiedAt && sameParseVersion && sameRelativePath)) {
        dirtyEntries.push(entry);
      }
    }

    return { dirtyEntries, newSessions };
  }

  private summaryWithStatus(
    period: UsagePeriod,
    status: SyncStatusDTO
  ): UsageSummaryDTO {
    const [lowerBound, upperBound] = this.periodBounds(period);
    const rows = this.store.listDailyRowsBetween(lowerBound, upperBound);
    for (const row of rows) {
      row.totals.costUSD = costFor(row.totals, row.model);
    }

    return {
      period,
      totals: sumDailyRows(rows),
      models: aggregateDailyRows(rows),
      lastUpdatedAt: status.lastSyncedAt
    };
  }

  private last7DayHistoryWithStatus(status: SyncStatusDTO): DailyUsageSummaryDTO[] {
    const keys = lastNDateKeys(new Date(), this.timeZone, 7);
    return this.dailyHistoryForKeysWithStatus(keys, status);
  }

  public actualSpendHistoryLastNDays(n: number): DailyActualSpendDTO[] {
    const keys = lastNDateKeys(new Date(), this.timeZone, n);
    if (keys.length === 0) return [];

    const lowerBound = keys[keys.length - 1] ?? "0000-01-01";
    const upperBound = keys[0] ?? "9999-12-31";

    const rows = this.store.listDailyProviderActualUsage(lowerBound, upperBound);
    const providers = this.getPricingProviders();
    const configTomlProviders = parseCodexConfigTomlProviders(this.codexHomePath);

    const grouped = new Map<
      string,
      Map<
        string,
        {
          totals: UsageTotalsDTO;
          sessionCount: number;
          matchedProvider: PricingProviderDTO | null;
          costUsd: number;
          costCny: number | null;
        }
      >
    >();

    for (const key of keys) {
      grouped.set(key, new Map());
    }

    for (const row of rows) {
      let dayMap = grouped.get(row.dateKey);
      if (!dayMap) {
        dayMap = new Map();
        grouped.set(row.dateKey, dayMap);
      }

      const codexProvider = row.provider;
      const matched = matchPricingProvider(codexProvider, providers, configTomlProviders);

      const identity = pricingIdentity(row.model);
      const suppliedRates = matched?.modelPrices?.find(
        (p) => pricingIdentity(p.model) === identity
      )?.rates;
      const officialRates = officialPricingFor(identity);
      const ratesToUse = suppliedRates ?? officialRates;
      const multiplier = matched?.multiplier ?? 1.0;
      const rechargeRatio = matched?.rechargeRatioUsdPerRmb ?? this.openaiUsdPerRmb;

      const itemCostUsd = ratesToUse ? costForRates(row.totals, ratesToUse) * multiplier : 0.0;
      const itemCostCny = rechargeRatio && rechargeRatio > 0 ? itemCostUsd / rechargeRatio : null;

      let providerEntry = dayMap.get(codexProvider);
      if (!providerEntry) {
        providerEntry = {
          totals: { ...row.totals },
          sessionCount: row.sessionCount,
          matchedProvider: matched,
          costUsd: itemCostUsd,
          costCny: itemCostCny
        };
        dayMap.set(codexProvider, providerEntry);
      } else {
        providerEntry.totals = addUsageTotals(providerEntry.totals, row.totals);
        providerEntry.sessionCount += row.sessionCount;
        providerEntry.costUsd += itemCostUsd;
        if (itemCostCny !== null) {
          providerEntry.costCny = (providerEntry.costCny ?? 0) + itemCostCny;
        }
      }
    }

    return keys.map((dateKey) => {
      const dayMap = grouped.get(dateKey) ?? new Map();
      const dailyProviders: DailyProviderActualSpendDTO[] = [];
      let totalCostCny = 0.0;
      let totalCostUsd = 0.0;
      let totalTokens = 0;
      let sessionCount = 0;

      for (const [codexProvider, entry] of dayMap.entries()) {
        const cny = entry.costCny ?? 0.0;
        totalCostCny += cny;
        totalCostUsd += entry.costUsd;
        totalTokens += entry.totals.totalTokens;
        sessionCount += entry.sessionCount;

        const providerName =
          entry.matchedProvider?.name ??
          (codexProvider === "unknown" ? "未知渠道" : codexProvider);

        const multiplier =
          entry.matchedProvider?.multiplier ?? (entry.matchedProvider ? 1.0 : null);
        const rechargeRatio =
          entry.matchedProvider?.rechargeRatioUsdPerRmb ??
          (entry.matchedProvider?.kind === "official" ? this.openaiUsdPerRmb : null);
        const effectiveCost =
          multiplier !== null && rechargeRatio !== null && rechargeRatio > 0
            ? multiplier / rechargeRatio
            : null;

        dailyProviders.push({
          providerId: entry.matchedProvider?.id ?? null,
          providerName,
          codexProvider,
          sessionCount: entry.sessionCount,
          inputTokens: entry.totals.inputTokens,
          outputTokens: entry.totals.outputTokens,
          totalTokens: entry.totals.totalTokens,
          costUsd: entry.costUsd,
          costCny: entry.costCny,
          multiplier,
          rechargeRatioUsdPerRmb: rechargeRatio,
          effectiveCost
        });
      }

      dailyProviders.sort(compareActualSpendProviders);

      return {
        dateKey,
        totalCostCny,
        totalCostUsd,
        totalTokens,
        sessionCount,
        providers: dailyProviders
      };
    });
  }

  private activityHistoryWithStatus(status: SyncStatusDTO): DailyUsageSummaryDTO[] {
    const todayKey = lastNDateKeys(new Date(), this.timeZone, 1)[0] ?? "0000-01-01";
    const [year, month, day] = todayKey.split("-").map(Number);
    const dateUtc = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = dateUtc.getUTCDay(); // 0 is Sunday

    const startKey = addDaysToDateKey(todayKey, -(52 * 7 + dayOfWeek));
    const keys = dateKeysDescendingBetween(startKey, todayKey);
    return this.dailyHistoryForKeysWithStatus(keys, status);
  }

  private dailyHistoryForKeysWithStatus(
    keys: string[],
    status: SyncStatusDTO
  ): DailyUsageSummaryDTO[] {
    const lowerBound = keys[keys.length - 1] ?? "0000-01-01";
    const upperBound = keys[0] ?? "9999-12-31";

    const rows = this.store.listDailyRowsBetween(lowerBound, upperBound);
    for (const row of rows) {
      row.totals.costUSD = costFor(row.totals, row.model);
    }

    const grouped = new Map<string, StoredDailyAggregate[]>();
    for (const row of rows) {
      const arr = grouped.get(row.dateKey);
      if (arr) {
        arr.push(row);
      } else {
        grouped.set(row.dateKey, [row]);
      }
    }

    return keys.map((dateKey) => {
      const dayRows = grouped.get(dateKey) ?? [];
      return {
        dateKey,
        totals: sumDailyRows(dayRows),
        models: aggregateDailyRows(dayRows),
        lastUpdatedAt: status.lastSyncedAt
      };
    });
  }

  private monthlyHistoryWithStatus(
    status: SyncStatusDTO
  ): MonthlyUsageSummaryDTO[] {
    const rows = this.store.listMonthlyRows();
    for (const row of rows) {
      row.totals.costUSD = costFor(row.totals, row.model);
    }

    const grouped = new Map<string, StoredMonthlyAggregate[]>();
    for (const row of rows) {
      const arr = grouped.get(row.monthKey);
      if (arr) {
        arr.push(row);
      } else {
        grouped.set(row.monthKey, [row]);
      }
    }

    const monthKeys = Array.from(grouped.keys()).sort((a, b) =>
      b.localeCompare(a)
    );

    return monthKeys.map((monthKey) => {
      const monthRows = grouped.get(monthKey) ?? [];
      const models: ModelUsageBreakdownDTO[] = monthRows.map((r) => ({
        model: r.model,
        isFallback: r.isFallback,
        totals: { ...r.totals }
      }));
      sortBreakdowns(models);

      return {
        monthKey,
        totals: sumMonthlyRows(monthRows),
        models,
        lastUpdatedAt: status.lastSyncedAt
      };
    });
  }

  private requiresFullRescan(): boolean {
    const context = this.store.loadSyncContext();
    return (
      context.codexHomePath !== this.codexHomePath ||
      context.timeZone !== this.timeZone ||
      context.parseVersion !== this.parseVersion
    );
  }

  private periodBounds(period: UsagePeriod): [string, string] {
    const todayKey = lastNDateKeys(new Date(), this.timeZone, 1)[0] ?? "0000-01-01";

    switch (period) {
      case "today":
        return [todayKey, todayKey];
      case "last7Days":
        return [addDaysToDateKey(todayKey, -6), todayKey];
      case "monthToDate":
        return [`${monthKeyFor(new Date(), this.timeZone)}-01`, todayKey];
    }
  }
}
