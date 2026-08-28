import fs from "node:fs";
import path from "node:path";
import type { ParsedSessionFile } from "./parser";
import type { SyncStatusDTO, UsageTotalsDTO } from "../../src/dto/dashboard";

export interface SyncContext {
  codexHomePath: string | null;
  timeZone: string | null;
  parseVersion: number | null;
}

export interface SourceSessionRecord {
  sessionId: string;
  relativePath: string;
  fileSize: number;
  modifiedAt: string;
  parseVersion: number;
}

export interface StoredDailyAggregate {
  dateKey: string;
  model: string;
  isFallback: boolean;
  totals: UsageTotalsDTO;
}

export interface StoredMonthlyAggregate {
  monthKey: string;
  model: string;
  isFallback: boolean;
  totals: UsageTotalsDTO;
}

export function idleSyncStatus(): SyncStatusDTO {
  return {
    state: "idle",
    lastSyncedAt: null,
    errorMessage: null,
    coverageThrough: null,
    coverageGranularity: null,
    scannedFiles: 0,
    sessionCount: 0,
    dataSource: null
  };
}

export function emptySyncContext(): SyncContext {
  return {
    codexHomePath: null,
    timeZone: null,
    parseVersion: null
  };
}

interface GenericDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): any;
  };
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

function openDatabase(dbPath: string): GenericDatabase {
  if (typeof (globalThis as any).Bun !== "undefined") {
    // Running in Bun test environment
    const { Database } = require("bun:sqlite");
    return new Database(dbPath);
  } else {
    // Running in Node.js / Electron main process
    const Database = require("better-sqlite3");
    return new Database(dbPath);
  }
}

export class UsageStore {
  private readonly dbPath: string;
  private readonly db: GenericDatabase;

  constructor(databasePath: string) {
    this.dbPath = path.resolve(databasePath);
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.db = openDatabase(this.dbPath);
    this.migrate();
  }

  public get databasePath(): string {
    return this.dbPath;
  }

  public close(): void {
    this.db.close();
  }

  public migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS source_sessions (
        session_id TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_at TEXT NOT NULL,
        parse_version INTEGER NOT NULL,
        last_synced_at TEXT NOT NULL,
        latest_usage_at TEXT
      );

      CREATE TABLE IF NOT EXISTS session_daily_usage (
        session_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        model TEXT NOT NULL,
        is_fallback INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        PRIMARY KEY (session_id, usage_date, model, is_fallback)
      );

      CREATE INDEX IF NOT EXISTS idx_session_daily_usage_date ON session_daily_usage (usage_date);

      CREATE TABLE IF NOT EXISTS daily_usage (
        usage_date TEXT NOT NULL,
        model TEXT NOT NULL,
        is_fallback INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        PRIMARY KEY (usage_date, model, is_fallback)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage (usage_date);

      CREATE TABLE IF NOT EXISTS monthly_usage (
        month_key TEXT NOT NULL,
        model TEXT NOT NULL,
        is_fallback INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        PRIMARY KEY (month_key, model, is_fallback)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    for (const table of ["session_daily_usage", "daily_usage", "monthly_usage"]) {
      this.ensureColumn(table, "cache_creation_input_tokens", "INTEGER NOT NULL DEFAULT 0");
      this.ensureColumn(table, "request_count", "INTEGER NOT NULL DEFAULT 0");
    }
  }

  private ensureColumn(table: string, columnName: string, columnDef: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((col) => col.name === columnName)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnDef}`);
    }
  }

  public resetCache(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec("DELETE FROM session_daily_usage");
      this.db.exec("DELETE FROM source_sessions");
      this.db.exec("DELETE FROM daily_usage");
      this.db.exec("DELETE FROM monthly_usage");
    });
    transaction();
  }

  public loadSyncStatus(): SyncStatusDTO {
    const row = this.db
      .prepare("SELECT value FROM sync_state WHERE key = 'sync_status'")
      .get() as { value: string } | undefined;

    if (!row) {
      return idleSyncStatus();
    }
    try {
      return JSON.parse(row.value) as SyncStatusDTO;
    } catch {
      return idleSyncStatus();
    }
  }

  public saveSyncStatus(status: SyncStatusDTO): void {
    const value = JSON.stringify(status);
    this.db
      .prepare(
        `
      INSERT INTO sync_state (key, value)
      VALUES ('sync_status', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
      )
      .run(value);
  }

  public loadSyncContext(): SyncContext {
    const row = this.db
      .prepare("SELECT value FROM sync_state WHERE key = 'sync_context'")
      .get() as { value: string } | undefined;

    if (!row) {
      return emptySyncContext();
    }
    try {
      return JSON.parse(row.value) as SyncContext;
    } catch {
      return emptySyncContext();
    }
  }

  public saveSyncContext(context: SyncContext): void {
    const value = JSON.stringify(context);
    this.db
      .prepare(
        `
      INSERT INTO sync_state (key, value)
      VALUES ('sync_context', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
      )
      .run(value);
  }

  public loadSourceSessions(): Map<string, SourceSessionRecord> {
    const rows = this.db
      .prepare(
        `
      SELECT session_id, relative_path, file_size, modified_at, parse_version
      FROM source_sessions
    `
      )
      .all() as {
      session_id: string;
      relative_path: string;
      file_size: number;
      modified_at: string;
      parse_version: number;
    }[];

    const records = new Map<string, SourceSessionRecord>();
    for (const row of rows) {
      records.set(row.session_id, {
        sessionId: row.session_id,
        relativePath: row.relative_path,
        fileSize: row.file_size,
        modifiedAt: row.modified_at,
        parseVersion: row.parse_version
      });
    }
    return records;
  }

  public listDateKeysForSessions(sessionIds: string[]): string[] {
    if (sessionIds.length === 0) {
      return [];
    }

    const dateKeys = new Set<string>();
    const chunkSize = 500;
    for (let i = 0; i < sessionIds.length; i += chunkSize) {
      const chunk = sessionIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `
        SELECT DISTINCT usage_date
        FROM session_daily_usage
        WHERE session_id IN (${placeholders})
        ORDER BY usage_date ASC
      `
        )
        .all(...chunk) as { usage_date: string }[];

      for (const row of rows) {
        dateKeys.add(row.usage_date);
      }
    }

    return Array.from(dateKeys).sort();
  }

  public replaceSessionFiles(
    parsedFiles: ParsedSessionFile[],
    parseVersion: number,
    syncedAt: Date
  ): void {
    if (parsedFiles.length === 0) return;

    const deleteUsage = this.db.prepare(
      "DELETE FROM session_daily_usage WHERE session_id = ?1"
    );
    const insertUsage = this.db.prepare(
      `
      INSERT INTO session_daily_usage (
        session_id,
        relative_path,
        usage_date,
        model,
        is_fallback,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        request_count,
        cost_usd
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `
    );
    const insertSource = this.db.prepare(
      `
      INSERT INTO source_sessions (
        session_id,
        relative_path,
        file_size,
        modified_at,
        parse_version,
        last_synced_at,
        latest_usage_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(session_id) DO UPDATE SET
        relative_path = excluded.relative_path,
        file_size = excluded.file_size,
        modified_at = excluded.modified_at,
        parse_version = excluded.parse_version,
        last_synced_at = excluded.last_synced_at,
        latest_usage_at = excluded.latest_usage_at
    `
    );

    const transaction = this.db.transaction(() => {
      for (const file of parsedFiles) {
        deleteUsage.run(file.sessionId);

        for (const usage of file.usages) {
          insertUsage.run(
            usage.sessionId,
            usage.relativePath,
            usage.dateKey,
            usage.model,
            usage.isFallback ? 1 : 0,
            usage.totals.inputTokens,
            usage.totals.cachedInputTokens,
            usage.totals.cacheCreationInputTokens,
            usage.totals.outputTokens,
            usage.totals.reasoningOutputTokens,
            usage.totals.totalTokens,
            usage.totals.requestCount,
            usage.totals.costUSD
          );
        }

        insertSource.run(
          file.sessionId,
          file.relativePath,
          file.fileSize,
          file.modifiedAt.toISOString(),
          parseVersion,
          syncedAt.toISOString(),
          file.latestUsageAt ? file.latestUsageAt.toISOString() : null
        );
      }
    });

    transaction();
  }

  public deleteSessions(sessionIds: string[]): void {
    if (sessionIds.length === 0) return;

    const deleteUsage = this.db.prepare(
      "DELETE FROM session_daily_usage WHERE session_id = ?1"
    );
    const deleteSource = this.db.prepare(
      "DELETE FROM source_sessions WHERE session_id = ?1"
    );

    const transaction = this.db.transaction(() => {
      for (const id of sessionIds) {
        deleteUsage.run(id);
        deleteSource.run(id);
      }
    });

    transaction();
  }

  public rebuildAggregatesForDateKeys(dateKeys: string[]): void {
    const normalizedDates = Array.from(new Set(dateKeys)).sort();
    if (normalizedDates.length === 0) return;

    const monthKeys = Array.from(
      new Set(normalizedDates.map((d) => d.slice(0, 7)))
    ).sort();

    const deleteDaily = this.db.prepare(
      "DELETE FROM daily_usage WHERE usage_date = ?1"
    );
    const insertDaily = this.db.prepare(
      `
      INSERT INTO daily_usage (
        usage_date,
        model,
        is_fallback,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        request_count,
        cost_usd
      )
      SELECT
        usage_date,
        model,
        is_fallback,
        SUM(input_tokens),
        SUM(cached_input_tokens),
        SUM(cache_creation_input_tokens),
        SUM(output_tokens),
        SUM(reasoning_output_tokens),
        SUM(total_tokens),
        SUM(request_count),
        SUM(cost_usd)
      FROM session_daily_usage
      WHERE usage_date = ?1
      GROUP BY usage_date, model, is_fallback
    `
    );

    const deleteMonthly = this.db.prepare(
      "DELETE FROM monthly_usage WHERE month_key = ?1"
    );
    const insertMonthly = this.db.prepare(
      `
      INSERT INTO monthly_usage (
        month_key,
        model,
        is_fallback,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        request_count,
        cost_usd
      )
      SELECT
        substr(usage_date, 1, 7) AS month_key,
        model,
        is_fallback,
        SUM(input_tokens),
        SUM(cached_input_tokens),
        SUM(cache_creation_input_tokens),
        SUM(output_tokens),
        SUM(reasoning_output_tokens),
        SUM(total_tokens),
        SUM(request_count),
        SUM(cost_usd)
      FROM daily_usage
      WHERE substr(usage_date, 1, 7) = ?1
      GROUP BY month_key, model, is_fallback
    `
    );

    const transaction = this.db.transaction(() => {
      for (const dateKey of normalizedDates) {
        deleteDaily.run(dateKey);
        insertDaily.run(dateKey);
      }
      for (const monthKey of monthKeys) {
        deleteMonthly.run(monthKey);
        insertMonthly.run(monthKey);
      }
    });

    transaction();
  }

  public listDailyRowsBetween(
    lowerBound: string,
    upperBound: string
  ): StoredDailyAggregate[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        usage_date,
        model,
        is_fallback,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        request_count,
        cost_usd
      FROM daily_usage
      WHERE usage_date >= ?1 AND usage_date <= ?2
      ORDER BY usage_date DESC, total_tokens DESC, model ASC
    `
      )
      .all(lowerBound, upperBound) as any[];

    return rows.map((r) => ({
      dateKey: r.usage_date,
      model: r.model,
      isFallback: r.is_fallback === 1,
      totals: {
        inputTokens: r.input_tokens,
        cachedInputTokens: r.cached_input_tokens,
        cacheCreationInputTokens: r.cache_creation_input_tokens,
        outputTokens: r.output_tokens,
        reasoningOutputTokens: r.reasoning_output_tokens,
        totalTokens: r.total_tokens,
        requestCount: r.request_count,
        costUSD: r.cost_usd
      }
    }));
  }

  public listMonthlyRows(): StoredMonthlyAggregate[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        month_key,
        model,
        is_fallback,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
        request_count,
        cost_usd
      FROM monthly_usage
      ORDER BY month_key DESC, total_tokens DESC, model ASC
    `
      )
      .all() as any[];

    return rows.map((r) => ({
      monthKey: r.month_key,
      model: r.model,
      isFallback: r.is_fallback === 1,
      totals: {
        inputTokens: r.input_tokens,
        cachedInputTokens: r.cached_input_tokens,
        cacheCreationInputTokens: r.cache_creation_input_tokens,
        outputTokens: r.output_tokens,
        reasoningOutputTokens: r.reasoning_output_tokens,
        totalTokens: r.total_tokens,
        requestCount: r.request_count,
        costUSD: r.cost_usd
      }
    }));
  }

  public latestSourceUsageAt(): Date | null {
    const row = this.db
      .prepare(
        "SELECT MAX(latest_usage_at) AS latest_usage_at FROM source_sessions"
      )
      .get() as { latest_usage_at: string | null } | undefined;

    if (!row || !row.latest_usage_at) {
      return null;
    }
    const date = new Date(row.latest_usage_at);
    return isNaN(date.getTime()) ? null : date;
  }
}
