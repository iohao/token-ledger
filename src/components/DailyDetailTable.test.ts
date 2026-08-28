import { describe, expect, it } from "bun:test";
import type { ModelUsageBreakdownDTO, PricingProviderDTO, UsageTotalsDTO } from "../dto/dashboard";
import { relayCostCny, relayCostsForModels } from "./DailyDetailTable";

const mockOfficialProvider: PricingProviderDTO = {
  id: "official",
  name: "Official",
  kind: "official",
  enabled: true,
  rechargeRatioUsdPerRmb: 7.2,
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
        outputUsdPerMillion: 4.5,
        cacheReadUsdPerMillion: 0.075,
        cacheCreationUsdPerMillion: 0.75
      }
    }
  ]
};

const mockRelayProvider: PricingProviderDTO = {
  id: "relay-1",
  name: "Test Relay",
  kind: "relay",
  enabled: true,
  rechargeRatioUsdPerRmb: 1.0,
  multiplier: 0.8,
  modelPrices: []
};

const mockTotals: UsageTotalsDTO = {
  inputTokens: 1_000_000,
  cachedInputTokens: 200_000,
  cacheCreationInputTokens: 100_000,
  outputTokens: 500_000,
  reasoningOutputTokens: 0,
  totalTokens: 1_500_000,
  requestCount: 10,
  costUSD: 20.0
};

describe("relayCostCny", () => {
  it("calculates relay cost using official rates fallback and provider multiplier/ratio", () => {
    const cost = relayCostCny(mockTotals, "gpt-5.6-sol", mockRelayProvider, mockOfficialProvider);
    expect(cost).toBeCloseTo(15.38, 4);
  });

  it("returns null if rechargeRatioUsdPerRmb is missing or invalid", () => {
    const providerWithoutRatio: PricingProviderDTO = {
      ...mockRelayProvider,
      rechargeRatioUsdPerRmb: null
    };
    const cost = relayCostCny(mockTotals, "gpt-5.6-sol", providerWithoutRatio, mockOfficialProvider);
    expect(cost).toBeNull();
  });

  it("returns null if model rate is not found in provider or official provider", () => {
    const cost = relayCostCny(mockTotals, "unknown-model", mockRelayProvider, mockOfficialProvider);
    expect(cost).toBeNull();
  });
});

describe("relayCostsForModels", () => {
  it("sums relay costs for multiple models", () => {
    const models: ModelUsageBreakdownDTO[] = [
      {
        model: "gpt-5.6-sol",
        isFallback: false,
        totals: mockTotals
      },
      {
        model: "gpt-5.4-mini",
        isFallback: false,
        totals: {
          inputTokens: 1_000_000,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 1_000_000,
          reasoningOutputTokens: 0,
          totalTokens: 2_000_000,
          requestCount: 5,
          costUSD: 5.25
        }
      }
    ];

    const totalCost = relayCostsForModels(models, mockRelayProvider, mockOfficialProvider);
    expect(totalCost).toBeCloseTo(19.58, 4);
  });

  it("returns null if any model has unpriceable rates", () => {
    const models: ModelUsageBreakdownDTO[] = [
      {
        model: "gpt-5.6-sol",
        isFallback: false,
        totals: mockTotals
      },
      {
        model: "unknown-model",
        isFallback: false,
        totals: mockTotals
      }
    ];

    const totalCost = relayCostsForModels(models, mockRelayProvider, mockOfficialProvider);
    expect(totalCost).toBeNull();
  });
});
