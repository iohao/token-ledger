import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageStore } from "../electron/services/store";
import type { ParsedSessionFile } from "../electron/services/parser";
import type { SyncContext, SyncStatusDTO } from "../src/dto/dashboard";

describe("store service", () => {
  function makeStore(): { tempDir: string; store: UsageStore } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
    const databasePath = path.join(tempDir, "usage.sqlite");
    const store = new UsageStore(databasePath);
    return { tempDir, store };
  }

  it("roundtrips sync status and sync context", () => {
    const { tempDir, store } = makeStore();
    try {
      const status: SyncStatusDTO = {
        state: "success",
        lastSyncedAt: "2026-04-09T15:52:18.470Z",
        errorMessage: null,
        coverageThrough: "2026-04-09T15:51:00.000Z",
        coverageGranularity: "minute",
        scannedFiles: 12,
        sessionCount: 3,
        dataSource: "jsonlDirect"
      };

      const context: SyncContext = {
        codexHomePath: "/tmp/.codex",
        timeZone: "Asia/Shanghai",
        parseVersion: 4
      };

      store.saveSyncStatus(status);
      store.saveSyncContext(context);

      expect(store.loadSyncStatus().scannedFiles).toBe(12);
      expect(store.loadSyncContext().codexHomePath).toBe("/tmp/.codex");
    } finally {
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("replaces session and rebuilds daily and monthly aggregates", () => {
    const { tempDir, store } = makeStore();
    try {
      const syncedAt = new Date("2026-04-09T16:00:00.000Z");
      const parsedFile: ParsedSessionFile = {
        sessionId: "session-a",
        relativePath: "2026/04/09/session-a.jsonl",
        fileSize: 123,
        modifiedAt: syncedAt,
        latestUsageAt: syncedAt,
        usages: [
          {
            sessionId: "session-a",
            relativePath: "2026/04/09/session-a.jsonl",
            dateKey: "2026-04-09",
            model: "gpt-5.4",
            isFallback: false,
            totals: {
              inputTokens: 100,
              cachedInputTokens: 20,
              cacheCreationInputTokens: 4,
              outputTokens: 10,
              reasoningOutputTokens: 5,
              totalTokens: 110,
              requestCount: 2,
              costUSD: 1.5
            }
          },
          {
            sessionId: "session-a",
            relativePath: "2026/04/09/session-a.jsonl",
            dateKey: "2026-04-10",
            model: "gpt-5.4",
            isFallback: false,
            totals: {
              inputTokens: 50,
              cachedInputTokens: 5,
              cacheCreationInputTokens: 2,
              outputTokens: 8,
              reasoningOutputTokens: 1,
              totalTokens: 58,
              requestCount: 1,
              costUSD: 0.8
            }
          }
        ]
      };

      store.replaceSessionFiles([parsedFile], 4, syncedAt);
      store.rebuildAggregatesForDateKeys(["2026-04-09", "2026-04-10"]);

      const daily = store.listDailyRowsBetween("2026-04-09", "2026-04-10");
      const monthly = store.listMonthlyRows();

      expect(daily.length).toBe(2);
      expect(daily[0].dateKey).toBe("2026-04-10");
      expect(daily[0].totals.requestCount).toBe(1);
      expect(daily[1].dateKey).toBe("2026-04-09");
      expect(daily[1].totals.requestCount).toBe(2);

      expect(monthly.length).toBe(1);
      expect(monthly[0].monthKey).toBe("2026-04");
      expect(monthly[0].totals.totalTokens).toBe(168);
      expect(monthly[0].totals.cacheCreationInputTokens).toBe(6);
      expect(monthly[0].totals.requestCount).toBe(3);

      const dateKeys = store.listDateKeysForSessions(["session-a"]);
      expect(dateKeys).toEqual(["2026-04-09", "2026-04-10"]);
    } finally {
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
