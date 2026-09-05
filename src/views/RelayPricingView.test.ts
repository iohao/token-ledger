import { describe, expect, it } from "bun:test";
import {
  compareRelayProvidersByPrice,
  computeLowestModelsByProvider,
  countCustomizedModels,
  formatDisplayRate,
  formatPrice,
  getProviderEffectiveCost,
  isRateEqual,
  mergeWithOfficialModelPrices,
  reconcileVisibleModels,
  resolveDraftProviderPrices
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
    expect(isRateEqual(null, null)).toBe(true);
    expect(isRateEqual(a, null)).toBe(false);
  });
});

describe("formatPrice & formatDisplayRate robustness", () => {
  it("safely formats prices with numbers, undefined, null, and NaN", () => {
    expect(formatPrice(5.6)).toBe("5.6000");
    expect(formatPrice(0)).toBe("0.0000");
    expect(formatPrice(undefined)).toBe("0.0000");
    expect(formatPrice(null)).toBe("0.0000");
    expect(formatPrice(Number.NaN)).toBe("0.0000");
    expect(formatPrice(undefined, "")).toBe("");
    expect(formatPrice(null, "1.0000")).toBe("1.0000");
  });

  it("safely formats display rates with numbers, undefined, null, and NaN", () => {
    expect(formatDisplayRate(5.6)).toBe("5.600");
    expect(formatDisplayRate(5.6789)).toBe("5.6789");
    expect(formatDisplayRate(0)).toBe("0.000");
    expect(formatDisplayRate(undefined)).toBe("0.0000");
    expect(formatDisplayRate(null)).toBe("0.0000");
    expect(formatDisplayRate(Number.NaN)).toBe("0.0000");
  });
});

describe("resolveDraftProviderPrices and template comparison", () => {
  const tplPrices = [
    {
      model: "gpt-5.6-sol",
      rates: {
        inputUsdPerMillion: 10.0,
        outputUsdPerMillion: 50.0,
        cacheReadUsdPerMillion: 1.0,
        cacheCreationUsdPerMillion: 10.0
      }
    }
  ];

  const templates = [
    {
      id: "tpl-1",
      name: "Template 1",
      modelPrices: tplPrices
    }
  ];

  it("resolves to official prices when templateId is openai-official", () => {
    const provider = {
      templateId: "openai-official",
      modelPrices: tplPrices
    };
    const resolved = resolveDraftProviderPrices(provider, templates, mockOfficialPrices);
    expect(resolved).toEqual(mockOfficialPrices);
  });

  it("resolves to template prices when templateId matches", () => {
    const provider = {
      templateId: "tpl-1",
      modelPrices: []
    };
    const resolved = resolveDraftProviderPrices(provider, templates, mockOfficialPrices);
    expect(resolved).toEqual(tplPrices);
  });

  it("falls back to provider prices when templateId is null or custom", () => {
    const customPrices = [
      {
        model: "gpt-5.6-sol",
        rates: {
          inputUsdPerMillion: 7.0,
          outputUsdPerMillion: 35.0,
          cacheReadUsdPerMillion: 0.7,
          cacheCreationUsdPerMillion: 7.0
        }
      }
    ];
    const provider = {
      templateId: null,
      modelPrices: customPrices
    };
    const resolved = resolveDraftProviderPrices(provider, templates, mockOfficialPrices);
    expect(resolved).toEqual(customPrices);
  });

  it("correctly compares two providers sharing the same template with different multipliers", () => {
    const providerA = {
      id: "relay-a",
      multiplier: "1.0000",
      rechargeRatioUsdPerRmb: "1.0000",
      modelPrices: resolveDraftProviderPrices({ templateId: "tpl-1" }, templates, mockOfficialPrices)
    };
    const providerB = {
      id: "relay-b",
      multiplier: "0.5000",
      rechargeRatioUsdPerRmb: "1.0000",
      modelPrices: resolveDraftProviderPrices({ templateId: "tpl-1" }, templates, mockOfficialPrices)
    };

    const comparison = computeLowestModelsByProvider([providerA, providerB], tplPrices);
    const compA = comparison.get("relay-a")?.get("gpt-5.6-sol");
    const compB = comparison.get("relay-b")?.get("gpt-5.6-sol");

    expect(compB?.isLowest).toBe(true);
    expect(compB?.diffPercent).toBeNull();

    expect(compA?.isLowest).toBe(false);
    // (10.0 - 5.0) / 5.0 = 100%
    expect(compA?.diffPercent).toBe("100%");
  });
});

describe("reconcileVisibleModels with new official models (e.g. gpt-6-astra)", () => {
  const currentOfficialModels = [
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark"
  ];

  it("defaults to all official models including gpt-6-astra when no preferences are saved", () => {
    const result = reconcileVisibleModels(null, null, currentOfficialModels);
    expect(result.visibleModels.has("gpt-6-astra")).toBe(true);
    expect(result.visibleModels.size).toBe(currentOfficialModels.length);
    expect(result.knownModels).toEqual(currentOfficialModels);
  });

  it("automatically includes newly added gpt-6-astra for users with existing saved visibility preferences", () => {
    // User had previously saved preferences from before gpt-6-astra existed, hiding gpt-5.4
    const oldSaved = [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark"
    ];

    const result = reconcileVisibleModels(oldSaved, null, currentOfficialModels);
    // Newly added model gpt-6-astra is automatically visible
    expect(result.visibleModels.has("gpt-6-astra")).toBe(true);
    // Deliberately hidden model gpt-5.4 remains hidden
    expect(result.visibleModels.has("gpt-5.4")).toBe(false);
    // Other models retain their visibility
    expect(result.visibleModels.has("gpt-5.6-sol")).toBe(true);
    expect(result.knownModels).toContain("gpt-6-astra");
  });

  it("respects user preference if gpt-6-astra was explicitly unchecked", () => {
    // User had gpt-6-astra known, but unchecked it
    const savedVisible = ["gpt-5.6-sol", "gpt-5.4-mini"];
    const savedKnown = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.4-mini"];

    const result = reconcileVisibleModels(savedVisible, savedKnown, currentOfficialModels);
    expect(result.visibleModels.has("gpt-6-astra")).toBe(false);
    expect(result.visibleModels.has("gpt-5.6-sol")).toBe(true);
  });

  it("computes lowest prices and diff correctly with gpt-6-astra benchmark rates", () => {
    const officialWithAstra = [
      {
        model: "gpt-6-astra",
        rates: {
          inputUsdPerMillion: 8.0,
          outputUsdPerMillion: 48.0,
          cacheReadUsdPerMillion: 0.8,
          cacheCreationUsdPerMillion: 10.0
        }
      }
    ];

    const providerA = {
      id: "relay-cheap",
      multiplier: "0.7500",
      rechargeRatioUsdPerRmb: "0.1400"
    };
    const providerB = {
      id: "relay-standard",
      multiplier: "1.0000",
      rechargeRatioUsdPerRmb: "0.1400"
    };

    const comparison = computeLowestModelsByProvider([providerA, providerB], officialWithAstra);
    const cheapAstra = comparison.get("relay-cheap")?.get("gpt-6-astra");
    const stdAstra = comparison.get("relay-standard")?.get("gpt-6-astra");

    expect(cheapAstra?.isLowest).toBe(true);
    expect(cheapAstra?.diffPercent).toBeNull();

    expect(stdAstra?.isLowest).toBe(false);
    // (8.0 - 6.0) / 6.0 = 33.3%
    expect(stdAstra?.diffPercent).toBe("33.3%");
  });
});
