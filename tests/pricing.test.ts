import { describe, expect, it } from "bun:test";
import {
  costFor,
  costForProvider,
  generatePluginPricingToml,
  normalizeModel,
  pricingProviders,
  validateRelayPricingProviders
} from "../electron/services/pricing";
import type { ModelUsageBreakdownDTO, RelayPricingProviderDTO, UsageTotalsDTO } from "../src/dto/dashboard";

function totals(
  inputTokens: number,
  cachedInputTokens: number,
  cacheCreationInputTokens: number,
  outputTokens: number
): UsageTotalsDTO {
  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
    requestCount: 0,
    costUSD: 0.0
  };
}

describe("pricing service", () => {
  it("normalizes models correctly", () => {
    expect(normalizeModel("openai/gpt-5.4-2026-04-01")).toBe("gpt-5.4");
    expect(normalizeModel("openrouter/openai/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeModel("gpt-5-codex")).toBe("gpt-5.3-codex");
    expect(normalizeModel("gpt-5.2-codex")).toBe("gpt-5.3-codex");
  });

  it("calculates official pricing default", () => {
    const cost = costFor(
      totals(1_000_000, 200_000, 0, 100_000),
      "openai/gpt-5.6-sol"
    );
    // regular input: 800k * 5 = 4.0, cached: 200k * 0.5 = 0.1, output: 100k * 30 = 3.0. Total = 7.1
    expect(Math.abs(cost - 7.1)).toBeLessThan(0.000001);
  });

  it("provider pricing falls back to official for missing models", () => {
    const relay: RelayPricingProviderDTO = {
      id: "relay-a",
      name: "Relay A",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 1.0,
      modelPrices: [
        {
          model: "gpt-5.6-sol",
          rates: {
            inputUsdPerMillion: 10.5,
            outputUsdPerMillion: 63.0,
            cacheReadUsdPerMillion: 1.05,
            cacheCreationUsdPerMillion: 13.125
          }
        }
      ]
    };

    const providers = pricingProviders([relay], 0.14);
    const models: ModelUsageBreakdownDTO[] = [
      {
        model: "gpt-5.6-sol",
        isFallback: false,
        totals: totals(1_000_000, 200_000, 100_000, 100_000)
      },
      {
        model: "gpt-5.4",
        isFallback: false,
        totals: totals(1_000_000, 0, 0, 0)
      }
    ];

    const result = costForProvider(models, providers[1]);
    expect(Math.abs((result.costUsd ?? 0) - 17.6725)).toBeLessThan(0.000001);
    expect(result.fallbackModels).toEqual(["gpt-5.4"]);
  });

  it("provider pricing applies multiplier", () => {
    const relay: RelayPricingProviderDTO = {
      id: "relay-discount",
      name: "Relay Discount",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 0.15,
      modelPrices: [
        {
          model: "gpt-5.6-sol",
          rates: {
            inputUsdPerMillion: 5.0,
            outputUsdPerMillion: 30.0,
            cacheReadUsdPerMillion: 0.5,
            cacheCreationUsdPerMillion: 6.25
          }
        }
      ]
    };

    const providers = pricingProviders([relay], 0.14);
    const result = costForProvider(
      [
        {
          model: "gpt-5.6-sol",
          isFallback: false,
          totals: totals(1_000_000, 0, 0, 0)
        }
      ],
      providers[1]
    );

    // 1M input tokens at $5.00 * 0.15 multiplier = $0.75
    expect(Math.abs((result.costUsd ?? 0) - 0.75)).toBeLessThan(0.000001);
  });

  it("enabled provider requires a recharge ratio", () => {
    const provider: RelayPricingProviderDTO = {
      id: "legacy",
      name: "Migrated relay",
      enabled: true,
      rechargeRatioUsdPerRmb: null,
      multiplier: 1.0,
      modelPrices: []
    };

    expect(() => validateRelayPricingProviders([provider])).toThrow();
  });

  it("generates plugin pricing toml correctly", () => {
    const relay: RelayPricingProviderDTO = {
      id: "relay-test",
      name: "Relay Test",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 0.15,
      modelPrices: []
    };

    const toml = generatePluginPricingToml([relay]);
    expect(toml).toContain('[models."gpt-5.6-sol"]');
    expect(toml).toContain('input_per_million = "0.7500"');
    expect(toml).toContain('output_per_million = "4.5000"');
  });

  it("generates plugin pricing toml with custom model prices", () => {
    const relay: RelayPricingProviderDTO = {
      id: "relay-custom",
      name: "Relay Custom",
      enabled: true,
      rechargeRatioUsdPerRmb: 0.14,
      multiplier: 0.5,
      modelPrices: [
        {
          model: "gpt-5.4",
          rates: {
            inputUsdPerMillion: 2.0,
            outputUsdPerMillion: 10.0,
            cacheReadUsdPerMillion: 0.2,
            cacheCreationUsdPerMillion: 2.0
          }
        }
      ]
    };

    const toml = generatePluginPricingToml([relay]);
    // Custom base $2.0 * 0.5 multiplier = $1.0000
    expect(toml).toContain('[models."gpt-5.4"]');
    expect(toml).toContain('input_per_million = "1.0000"');
    expect(toml).toContain('output_per_million = "5.0000"');
  });
});
