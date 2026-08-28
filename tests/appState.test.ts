import { describe, expect, it } from "bun:test";
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
});
