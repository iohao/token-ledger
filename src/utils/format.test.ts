import { formatActualVsBackendCost, formatPriceDiffPercent } from "./format";

describe("formatPriceDiffPercent", () => {
  it("returns null for invalid or negative inputs", () => {
    expect(formatPriceDiffPercent(-1, 10)).toBeNull();
    expect(formatPriceDiffPercent(10, -1)).toBeNull();
    expect(formatPriceDiffPercent(Number.NaN, 10)).toBeNull();
    expect(formatPriceDiffPercent(10, Number.NaN)).toBeNull();
    expect(formatPriceDiffPercent(10, 0)).toBeNull();
  });

  it("handles 0.75 vs 1.05 -> 40%", () => {
    expect(formatPriceDiffPercent(1.05, 0.75)).toBe("40%");
  });

  it("handles 0.76 vs 1.33 -> 75%", () => {
    expect(formatPriceDiffPercent(1.33, 0.76)).toBe("75%");
  });

  it("handles 7-day stats case: 25.86 vs 42.10 -> 62.8%", () => {
    expect(formatPriceDiffPercent(42.10, 25.86)).toBe("62.8%");
  });

  it("handles integer ratios cleanly: 10 vs 20 -> 100%, 10 vs 40 -> 300%", () => {
    expect(formatPriceDiffPercent(20.00, 10.00)).toBe("100%");
    expect(formatPriceDiffPercent(40.00, 10.00)).toBe("300%");
  });

  it("returns null when cost is equal to or less than lowest cost", () => {
    expect(formatPriceDiffPercent(25.86, 25.86)).toBeNull();
    expect(formatPriceDiffPercent(20.00, 25.86)).toBeNull();
  });
});

describe("formatActualVsBackendCost", () => {
  it("returns null when costCny is null", () => {
    expect(formatActualVsBackendCost(null, 5.0, "zh-CN")).toBeNull();
  });

  it("formats actual (CNY) and backend price (USD) correctly in zh-CN", () => {
    const result = formatActualVsBackendCost(1.05, 10.5, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.cny).toBe("¥1.05");
    expect(result?.usd).toBe("$10.50");
  });

  it("formats actual (CNY) and handles null costUsd gracefully", () => {
    const result = formatActualVsBackendCost(0.68, null, "zh-CN");
    expect(result).not.toBeNull();
    expect(result?.cny).toBe("¥0.68");
    expect(result?.usd).toBe("—");
  });

  it("formats actual and backend price correctly in en-US", () => {
    const result = formatActualVsBackendCost(2.5, 25.0, "en-US");
    expect(result).not.toBeNull();
    expect(result?.cny).toContain("2.50");
    expect(result?.usd).toBe("$25.00");
  });
});
