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
  DailyUsageSummaryDTO,
  DashboardMetaDTO,
  DashboardPayloadDTO,
  ModelUsageBreakdownDTO,
  MonthlyUsageSummaryDTO,
  PricingComparisonDTO,
  PricingProviderDTO,
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

export class UsageRepository {
  public readonly codexHomePath: string;
  public readonly databasePath: string;
  public readonly timeZone: string;
  public readonly parseVersion: number;
  private readonly relayPricingProviders: RelayPricingProviderDTO[];
  private readonly openaiUsdPerRmb: number;
  public readonly store: UsageStore;

  constructor(config: UsageRepositoryConfig) {
    this.codexHomePath = path.resolve(config.codexHomePath);
    this.databasePath = path.resolve(config.databasePath);
    this.timeZone = config.timeZone;
    this.parseVersion = config.parseVersion;
    this.relayPricingProviders = config.relayPricingProviders;
    this.openaiUsdPerRmb = config.openaiUsdPerRmb;
    this.store = new UsageStore(this.databasePath);
  }

  public getPricingProviders(): PricingProviderDTO[] {
    return pricingProviders(this.relayPricingProviders, this.openaiUsdPerRmb);
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
      pricingProviders: providers
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
      now: formatUtcTimestamp(new Date())
    };
  }

  public currentSyncStatus(): SyncStatusDTO {
    return this.store.loadSyncStatus();
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
      const parsedChunk: ParsedSessionFile[] = [];

      for (const entry of chunk) {
        const parsedFile = await parseSessionFile(
          entry.filePath,
          sessionsRoot,
          this.timeZone
        );
        for (const usage of parsedFile.usages) {
          usage.totals.costUSD = costFor(usage.totals, usage.model);
        }
        parsedChunk.push(parsedFile);
      }

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

    this.store.rebuildAggregatesForDateKeys(Array.from(affectedDateKeys));
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
