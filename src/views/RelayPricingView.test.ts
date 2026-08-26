import { describe, expect, it } from "bun:test";
import { computeLowestModelsByProvider } from "./RelayPricingView";

const mockOfficialPrices = [
  {
    model: "gpt-5.6-sol",
    rates: {
      inputUsdPerMillion: 5.0,
      outputUsdPerMillion: 30.0,
      cacheReadUsdPerMillion: 0.5,
      cacheCreationUsdPerMillion: 5.0
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
