import { describe, expect, it } from "bun:test";
import {
  addDaysToDateKey,
  dateKeyFor,
  lastNDateKeys,
  monthKeyFor,
  parseTimestamp
} from "../electron/services/dateKeys";

describe("dateKeys", () => {
  it("parses valid timestamp and handles invalid", () => {
    const valid = parseTimestamp("2026-04-09T01:00:00.000Z");
    expect(valid).not.toBeNull();
    expect(valid?.toISOString()).toBe("2026-04-09T01:00:00.000Z");

    const invalid = parseTimestamp("invalid-date");
    expect(invalid).toBeNull();
  });

  it("calculates dateKey and monthKey in timezone", () => {
    // 2026-04-09T18:00:00Z is 2026-04-10 in Asia/Shanghai (UTC+8)
    const date = new Date("2026-04-09T18:00:00.000Z");
    expect(dateKeyFor(date, "Asia/Shanghai")).toBe("2026-04-10");
    expect(monthKeyFor(date, "Asia/Shanghai")).toBe("2026-04");

    // In UTC it is 2026-04-09
    expect(dateKeyFor(date, "UTC")).toBe("2026-04-09");
  });

  it("adds and subtracts days to dateKey", () => {
    expect(addDaysToDateKey("2026-04-09", 1)).toBe("2026-04-10");
    expect(addDaysToDateKey("2026-04-09", -1)).toBe("2026-04-08");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDateKey("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });

  it("generates last N date keys descending", () => {
    const date = new Date("2026-04-09T01:00:00.000Z");
    const keys = lastNDateKeys(date, "UTC", 3);
    expect(keys).toEqual(["2026-04-09", "2026-04-08", "2026-04-07"]);
  });
});
