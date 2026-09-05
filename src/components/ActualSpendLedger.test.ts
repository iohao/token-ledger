import { describe, expect, it } from "bun:test";
import {
  compareActualSpendProviders,
  resolveActualSpendProviderPrice
} from "./ActualSpendLedger";
import type { PricingProviderDTO } from "../dto/dashboard";

describe("resolveActualSpendProviderPrice", () => {
  const relayPricingProviders: PricingProviderDTO[] = [
    {
      id: "relay-cheap",
      name: "Cheap Relay",
      kind: "relay",
      enabled: true,
      multiplier: 0.2,
      rechargeRatioUsdPerRmb: 1.0 // price = 0.2
    },
    {
      id: "relay-mid",
      name: "Mid Relay",
      kind: "relay",
      enabled: true,
      multiplier: 2.1,
      rechargeRatioUsdPerRmb: 10.0 // price = 0.21
    },
    {
      id: "openai-official",
      name: "OpenAI Official",
      kind: "official",
      enabled: true,
      multiplier: 1.0,
      rechargeRatioUsdPerRmb: 0.14 // price ≈ 7.14
    }
  ];

  it("resolves price using matching provider from RelayPricingView", () => {
    expect(
      resolveActualSpendProviderPrice(
        { providerId: "relay-cheap", providerName: "Cheap Relay" },
        relayPricingProviders
      )
    ).toBeCloseTo(0.2, 4);

    expect(
      resolveActualSpendProviderPrice(
        { providerId: "relay-mid", providerName: "Mid Relay" },
        relayPricingProviders
      )
    ).toBeCloseTo(0.21, 4);

    expect(
      resolveActualSpendProviderPrice(
        { providerId: "openai-official", providerName: "OpenAI Official" },
        relayPricingProviders
      )
    ).toBeCloseTo(7.142857, 4);
  });

  it("matches by provider name when providerId is absent", () => {
    expect(
      resolveActualSpendProviderPrice(
        { providerName: "Cheap Relay" },
        relayPricingProviders
      )
    ).toBeCloseTo(0.2, 4);
  });

  it("falls back to item effectiveCost or multiplier/ratio when not in pricingProviders", () => {
    expect(
      resolveActualSpendProviderPrice({
        providerName: "Custom Channel",
        effectiveCost: 0.5
      })
    ).toBe(0.5);

    expect(
      resolveActualSpendProviderPrice({
        providerName: "Custom Channel",
        multiplier: 0.8,
        rechargeRatioUsdPerRmb: 2.0
      })
    ).toBe(0.4);
  });

  it("returns null for unconfigured or invalid providers", () => {
    expect(
      resolveActualSpendProviderPrice({
        providerName: "Unknown",
        multiplier: null,
        rechargeRatioUsdPerRmb: null
      })
    ).toBeNull();
  });
});

describe("compareActualSpendProviders", () => {
  const pricingProviders: PricingProviderDTO[] = [
    {
      id: "p-krill",
      name: "krill",
      kind: "relay",
      enabled: true,
      multiplier: 0.2,
      rechargeRatioUsdPerRmb: 1.0 // price = 0.20
    },
    {
      id: "p-fucheers",
      name: "fucheers",
      kind: "relay",
      enabled: true,
      multiplier: 2.1,
      rechargeRatioUsdPerRmb: 10.0 // price = 0.21
    },
    {
      id: "p-standard",
      name: "standard",
      kind: "relay",
      enabled: true,
      multiplier: 1.0,
      rechargeRatioUsdPerRmb: 1.0 // price = 1.00
    },
    {
      id: "openai-official",
      name: "OpenAI Official",
      kind: "official",
      enabled: true,
      multiplier: 1.0,
      rechargeRatioUsdPerRmb: 0.14 // price = 7.14
    }
  ];

  it("sorts providers based on RelayPricingView price (higher price further behind)", () => {
    const providers = [
      { providerName: "OpenAI Official", providerId: "openai-official" }, // 7.14
      { providerName: "fucheers", providerId: "p-fucheers" }, // 0.21
      { providerName: "krill", providerId: "p-krill" }, // 0.20
      { providerName: "standard", providerId: "p-standard" }, // 1.00
    ];

    const sorted = [...providers].sort((a, b) =>
      compareActualSpendProviders(a, b, pricingProviders)
    );

    // 0.20 (krill) -> 0.21 (fucheers) -> 1.00 (standard) -> 7.14 (OpenAI Official)
    expect(sorted.map((p) => p.providerName)).toEqual([
      "krill",
      "fucheers",
      "standard",
      "OpenAI Official"
    ]);
  });

  it("places providers unconfigured in RelayPricingView at the very end", () => {
    const providers = [
      { providerName: "unknown-channel", providerId: null },
      { providerName: "standard", providerId: "p-standard" },
      { providerName: "krill", providerId: "p-krill" },
    ];

    const sorted = [...providers].sort((a, b) =>
      compareActualSpendProviders(a, b, pricingProviders)
    );

    expect(sorted.map((p) => p.providerName)).toEqual([
      "krill",
      "standard",
      "unknown-channel"
    ]);
  });

  it("breaks ties by provider name alphabetically", () => {
    const tiedProviders: PricingProviderDTO[] = [
      {
        id: "p-beta",
        name: "Beta Relay",
        kind: "relay",
        enabled: true,
        multiplier: 1.0,
        rechargeRatioUsdPerRmb: 1.0
      },
      {
        id: "p-alpha",
        name: "Alpha Relay",
        kind: "relay",
        enabled: true,
        multiplier: 1.0,
        rechargeRatioUsdPerRmb: 1.0
      }
    ];

    const providers = [
      { providerName: "Beta Relay", providerId: "p-beta" },
      { providerName: "Alpha Relay", providerId: "p-alpha" },
    ];

    const sorted = [...providers].sort((a, b) =>
      compareActualSpendProviders(a, b, tiedProviders)
    );

    expect(sorted.map((p) => p.providerName)).toEqual([
      "Alpha Relay",
      "Beta Relay"
    ]);
  });
});
