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

  it("handles 0.76 / 1.33 -> 57.1%", () => {
    expect(formatPriceDiffPercent(1.33, 0.76)).toBe("57.1%");
  });

  it("handles 7-day stats case: 25.86 / 42.10 -> 61.4%", () => {
    expect(formatPriceDiffPercent(42.10, 25.86)).toBe("61.4%");
  });

  it("handles integer ratios cleanly: 10 / 20 -> 50%", () => {
    expect(formatPriceDiffPercent(20.00, 10.00)).toBe("50%");
    expect(formatPriceDiffPercent(40.00, 10.00)).toBe("25%");
  });

  it("returns null when cost is equal to or less than lowest cost", () => {
    expect(formatPriceDiffPercent(25.86, 25.86)).toBeNull();
    expect(formatPriceDiffPercent(20.00, 25.86)).toBeNull();
  });
});
