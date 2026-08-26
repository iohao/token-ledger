import { describe, expect, it } from "bun:test";
import { formatPriceDiffPercent } from "./format";

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
