import { describe, expect, it } from "bun:test";
import {
  compareRelayProvidersByPrice,
  computeLowestModelsByProvider,
  countCustomizedModels,
  getProviderEffectiveCost,
  isRateEqual,
  mergeWithOfficialModelPrices
} from "./RelayPricingView";

const mockOfficialPrices = [
  {
    model: "gpt-5.6-sol",
    rates: {
      inputUsdPerMillion: 5.0,
      outputUsdPerMillion: 30.0,
      cacheReadUsdPerMillion: 0.5,
      cacheCreationUsdPerMillion: 6.25
    }
  },
  {
    model: "gpt-5.4-mini",
    rates: {
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 4.52,
      cacheReadUsdPerMillion: 0.075,
      cacheCreationUsdPerMillion: 0.75
    }
  }
];

describe("computeLowestModelsByProvider", () => {
  it("returns empty map when fewer than 2 comparable providers exist", () => {
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000"
        }
      ],
      mockOfficialPrices
    );

    expect(result.get("relay-1")?.size).toBe(0);
  });

  it("identifies the lower priced provider and calculates diff percentage when ratios are 1:1", () => {
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000"
        },
        {
          id: "relay-2",
          multiplier: "0.8000",
          rechargeRatioUsdPerRmb: "1.0000"
        }
      ],
      mockOfficialPrices
    );

    const relay1Sol = result.get("relay-1")?.get("gpt-5.6-sol");
    const relay2Sol = result.get("relay-2")?.get("gpt-5.6-sol");

    expect(relay1Sol?.isLowest).toBe(false);
    // (5.0 - 4.0) / 4.0 = 25%
    expect(relay1Sol?.diffPercent).toBe("25%");

    expect(relay2Sol?.isLowest).toBe(true);
    expect(relay2Sol?.diffPercent).toBeNull();
  });

  it("factors in non-1:1 recharge ratios correctly", () => {
    // relay-1: multiplier 1.0, ratio 1.0 (cost: 5.0 * 1.0 / 1.0 = 5.0 RMB)
    // relay-2: multiplier 0.5, ratio 0.14 (cost: 5.0 * 0.5 / 0.14 = 17.857 RMB)
    // Even though relay-2 has a lower multiplier (0.5 < 1.0), relay-1 has lower actual RMB cost!
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000"
        },
        {
          id: "relay-2",
          multiplier: "0.5000",
          rechargeRatioUsdPerRmb: "0.1400"
        }
      ],
      mockOfficialPrices
    );

    const relay1Sol = result.get("relay-1")?.get("gpt-5.6-sol");
    const relay2Sol = result.get("relay-2")?.get("gpt-5.6-sol");

    expect(relay1Sol?.isLowest).toBe(true);
    expect(relay1Sol?.diffPercent).toBeNull();

    expect(relay2Sol?.isLowest).toBe(false);
    // (17.85714 - 5.0) / 5.0 = 257.1%
    expect(relay2Sol?.diffPercent).toBe("257.1%");
  });

  it("handles comparison with official provider", () => {
    // Official: multiplier 1.0, ratio 0.14 (cost: 5.0 / 0.14 = 35.71 RMB)
    // Relay: multiplier 1.0, ratio 1.0 (cost: 5.0 / 1.0 = 5.0 RMB)
    const result = computeLowestModelsByProvider(
      [
        {
          id: "openai-official",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "0.1400"
        },
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000"
        }
      ],
      mockOfficialPrices
    );

    const officialSol = result.get("openai-official")?.get("gpt-5.6-sol");
    const relay1Sol = result.get("relay-1")?.get("gpt-5.6-sol");

    expect(officialSol?.isLowest).toBe(false);
    // (35.71428 - 5.0) / 5.0 = 614.3%
    expect(officialSol?.diffPercent).toBe("614.3%");

    expect(relay1Sol?.isLowest).toBe(true);
    expect(relay1Sol?.diffPercent).toBeNull();
  });

  it("marks all providers when tied for lowest", () => {
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "0.8000",
          rechargeRatioUsdPerRmb: "1.0000"
        },
        {
          id: "relay-2",
          multiplier: "0.8000",
          rechargeRatioUsdPerRmb: "1.0000"
        }
      ],
      mockOfficialPrices
    );

    expect(result.get("relay-1")?.get("gpt-5.6-sol")?.isLowest).toBe(true);
    expect(result.get("relay-1")?.get("gpt-5.6-sol")?.diffPercent).toBeNull();

    expect(result.get("relay-2")?.get("gpt-5.6-sol")?.isLowest).toBe(true);
    expect(result.get("relay-2")?.get("gpt-5.6-sol")?.diffPercent).toBeNull();
  });

  it("ignores providers with invalid or empty ratios", () => {
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000"
        },
        {
          id: "relay-2",
          multiplier: "0.5000",
          rechargeRatioUsdPerRmb: ""
        }
      ],
      mockOfficialPrices
    );

    // Only 1 valid provider, so no comparison result
    expect(result.get("relay-1")?.size).toBe(0);
    expect(result.get("relay-2")?.size).toBe(0);
  });
});

describe("getProviderEffectiveCost", () => {
  it("calculates effective cost correctly with standard numeric and string values", () => {
    expect(getProviderEffectiveCost({ multiplier: "1.0000", rechargeRatioUsdPerRmb: "1.0000" })).toBeCloseTo(1.0);
    expect(getProviderEffectiveCost({ multiplier: "0.8000", rechargeRatioUsdPerRmb: "1.0000" })).toBeCloseTo(0.8);
    expect(getProviderEffectiveCost({ multiplier: 0.5, rechargeRatioUsdPerRmb: 2.0 })).toBeCloseTo(0.25);
    expect(getProviderEffectiveCost({ multiplier: "1.0000", rechargeRatioUsdPerRmb: "0.1400" })).toBeCloseTo(7.142857);
  });

  it("defaults multiplier to 1.0 when omitted or null", () => {
    expect(getProviderEffectiveCost({ rechargeRatioUsdPerRmb: "1.0000" })).toBeCloseTo(1.0);
    expect(getProviderEffectiveCost({ multiplier: null, rechargeRatioUsdPerRmb: "2.0000" })).toBeCloseTo(0.5);
  });

  it("returns null for missing, non-positive or invalid inputs", () => {
    expect(getProviderEffectiveCost({ multiplier: "1.0000", rechargeRatioUsdPerRmb: "" })).toBeNull();
    expect(getProviderEffectiveCost({ multiplier: "1.0000", rechargeRatioUsdPerRmb: "0" })).toBeNull();
    expect(getProviderEffectiveCost({ multiplier: "1.0000", rechargeRatioUsdPerRmb: "-1" })).toBeNull();
    expect(getProviderEffectiveCost({ multiplier: "0", rechargeRatioUsdPerRmb: "1.0000" })).toBeNull();
    expect(getProviderEffectiveCost({ multiplier: "abc", rechargeRatioUsdPerRmb: "1.0000" })).toBeNull();
    expect(getProviderEffectiveCost({ multiplier: "", rechargeRatioUsdPerRmb: "1.0000" })).toBeNull();
  });
});

describe("compareRelayProvidersByPrice", () => {
  it("sorts providers by effective cost ascending (lowest price first)", () => {
    const providers = [
      { id: "p1", name: "Standard 1:1", multiplier: "1.0000", rechargeRatioUsdPerRmb: "1.0000" }, // cost 1.0
      { id: "p2", name: "Discount 0.8x", multiplier: "0.8000", rechargeRatioUsdPerRmb: "1.0000" }, // cost 0.8
      { id: "p3", name: "High Discount 2:1", multiplier: "1.0000", rechargeRatioUsdPerRmb: "2.0000" }, // cost 0.5
      { id: "p4", name: "Expensive Relay", multiplier: "1.0000", rechargeRatioUsdPerRmb: "0.1400" }, // cost ~7.14
    ];

    const sorted = [...providers].sort(compareRelayProvidersByPrice);
    expect(sorted.map((p) => p.id)).toEqual(["p3", "p2", "p1", "p4"]);
  });

  it("places providers with unconfigured/invalid price at the end", () => {
    const providers = [
      { id: "unconfigured", name: "New Provider", multiplier: "1.0000", rechargeRatioUsdPerRmb: "" },
      { id: "valid-expensive", name: "Expensive", multiplier: "1.2000", rechargeRatioUsdPerRmb: "1.0000" },
      { id: "valid-cheap", name: "Cheap", multiplier: "0.6000", rechargeRatioUsdPerRmb: "1.0000" },
    ];

    const sorted = [...providers].sort(compareRelayProvidersByPrice);
    expect(sorted.map((p) => p.id)).toEqual(["valid-cheap", "valid-expensive", "unconfigured"]);
  });

  it("breaks ties by provider name alphabetically", () => {
    const providers = [
      { id: "b", name: "Beta Relay", multiplier: "1.0000", rechargeRatioUsdPerRmb: "1.0000" },
      { id: "a", name: "Alpha Relay", multiplier: "1.0000", rechargeRatioUsdPerRmb: "1.0000" },
    ];

    const sorted = [...providers].sort(compareRelayProvidersByPrice);
    expect(sorted.map((p) => p.name)).toEqual(["Alpha Relay", "Beta Relay"]);
  });
});

describe("computeLowestModelsByProvider with custom benchmark pricing", () => {
  it("uses provider-specific benchmark rates when determining lowest price per model", () => {
    // relay-1 has lower baseline for sol ($3 vs official $5), but higher baseline for mini ($1.5 vs official $0.75)
    // relay-2 has standard official baselines ($5 for sol, $0.75 for mini)
    // Both have 1.0 multiplier and 1.0 recharge ratio
    const result = computeLowestModelsByProvider(
      [
        {
          id: "relay-1",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000",
          modelPrices: [
            {
              model: "gpt-5.6-sol",
              rates: {
                inputUsdPerMillion: 3.0,
                outputUsdPerMillion: 18.0,
                cacheReadUsdPerMillion: 0.3,
                cacheCreationUsdPerMillion: 3.0
              }
            },
            {
              model: "gpt-5.4-mini",
              rates: {
                inputUsdPerMillion: 1.5,
                outputUsdPerMillion: 9.0,
                cacheReadUsdPerMillion: 0.15,
                cacheCreationUsdPerMillion: 1.5
              }
            }
          ]
        },
        {
          id: "relay-2",
          multiplier: "1.0000",
          rechargeRatioUsdPerRmb: "1.0000",
          modelPrices: [
            {
              model: "gpt-5.6-sol",
              rates: {
                inputUsdPerMillion: 5.0,
                outputUsdPerMillion: 30.0,
                cacheReadUsdPerMillion: 0.5,
                cacheCreationUsdPerMillion: 6.25
              }
            },
            {
              model: "gpt-5.4-mini",
              rates: {
                inputUsdPerMillion: 0.75,
                outputUsdPerMillion: 4.52,
                cacheReadUsdPerMillion: 0.075,
                cacheCreationUsdPerMillion: 0.75
              }
            }
          ]
        }
      ],
      mockOfficialPrices
    );

    // For gpt-5.6-sol: relay-1 is lowest ($3 vs $5, diff is 66.7% higher on relay-2)
    expect(result.get("relay-1")?.get("gpt-5.6-sol")?.isLowest).toBe(true);
    expect(result.get("relay-2")?.get("gpt-5.6-sol")?.isLowest).toBe(false);
    expect(result.get("relay-2")?.get("gpt-5.6-sol")?.diffPercent).toBe("66.7%");

    // For gpt-5.4-mini: relay-2 is lowest ($0.75 vs $1.5, diff is 100% higher on relay-1)
    expect(result.get("relay-2")?.get("gpt-5.4-mini")?.isLowest).toBe(true);
    expect(result.get("relay-1")?.get("gpt-5.4-mini")?.isLowest).toBe(false);
    expect(result.get("relay-1")?.get("gpt-5.4-mini")?.diffPercent).toBe("100%");
  });
});

describe("countCustomizedModels & mergeWithOfficialModelPrices", () => {
  it("detects customized models accurately", () => {
    const official = mockOfficialPrices;
    expect(countCustomizedModels(undefined, official)).toBe(0);
    expect(countCustomizedModels([], official)).toBe(0);
    expect(countCustomizedModels(official, official)).toBe(0);

    const customized = [
      {
        model: "gpt-5.6-sol",
        rates: {
          inputUsdPerMillion: 4.0, // changed from 5.0
          outputUsdPerMillion: 30.0,
          cacheReadUsdPerMillion: 0.5,
          cacheCreationUsdPerMillion: 6.25
        }
      },
      {
        model: "gpt-5.4-mini",
        rates: { ...mockOfficialPrices[1].rates }
      }
    ];

    expect(countCustomizedModels(customized, official)).toBe(1);
  });

  it("merges custom prices with missing official models", () => {
    const official = mockOfficialPrices;
    const partialCustom = [
      {
        model: "gpt-5.6-sol",
        rates: {
          inputUsdPerMillion: 4.0,
          outputUsdPerMillion: 24.0,
          cacheReadUsdPerMillion: 0.4,
          cacheCreationUsdPerMillion: 4.0
        }
      }
    ];

    const merged = mergeWithOfficialModelPrices(partialCustom, official);
    expect(merged.length).toBe(2);
    expect(merged[0].rates.inputUsdPerMillion).toBe(4.0);
    expect(merged[1].rates.inputUsdPerMillion).toBe(0.75);
  });

  it("isRateEqual handles floating point equality correctly", () => {
    const a = { inputUsdPerMillion: 5.0, outputUsdPerMillion: 30.0, cacheReadUsdPerMillion: 0.5, cacheCreationUsdPerMillion: 6.25 };
    const b = { inputUsdPerMillion: 5.0000001, outputUsdPerMillion: 30.0, cacheReadUsdPerMillion: 0.5, cacheCreationUsdPerMillion: 6.25 };
    const c = { inputUsdPerMillion: 5.1, outputUsdPerMillion: 30.0, cacheReadUsdPerMillion: 0.5, cacheCreationUsdPerMillion: 6.25 };

    expect(isRateEqual(a, b)).toBe(true);
    expect(isRateEqual(a, c)).toBe(false);
  });
});


