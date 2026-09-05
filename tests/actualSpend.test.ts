import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareActualSpendProviders,
  getActualSpendProviderPrice,
  matchPricingProvider,
  parseCodexConfigTomlProviders,
  UsageRepository
} from "../electron/services/repository";
import type { PricingProviderDTO, RelayPricingProviderDTO } from "../src/dto/dashboard";

describe("actualSpend features", () => {
  it("parses model_providers from config.toml", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toml-test-"));
    try {
      const tomlContent = `
model_provider = "krill"

[model_providers.krill]
name = "OpenAI"
base_url = "https://api.krill-code.net/codex/v1"

[model_providers.custom]
name = "fucheers Codex"
base_url = "https://www.fucheers.top/v1"
`;
      fs.writeFileSync(path.join(tempDir, "config.toml"), tomlContent, "utf8");

      const providers = parseCodexConfigTomlProviders(tempDir);
      expect(providers.size).toBe(2);
      expect(providers.get("krill")?.name).toBe("OpenAI");
      expect(providers.get("krill")?.baseUrl).toBe("https://api.krill-code.net/codex/v1");
      expect(providers.get("custom")?.name).toBe("fucheers Codex");
      expect(providers.get("custom")?.baseUrl).toBe("https://www.fucheers.top/v1");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("matches pricing provider by codexProviderId, name, or config.toml", () => {
    const providers: PricingProviderDTO[] = [
      {
        id: "provider-1",
        kind: "relay",
        name: "fucheers",
        enabled: true,
        rechargeRatioUsdPerRmb: 10,
        multiplier: 2.1
      },
      {
        id: "provider-2",
        kind: "relay",
        name: "krill-月卡",
        codexProviderId: "krill",
        enabled: true,
        rechargeRatioUsdPerRmb: 7.33,
        multiplier: 1.0
      }
    ];

    const configTomlMap = new Map<string, { name?: string; baseUrl?: string }>([
      ["custom", { name: "fucheers Codex", baseUrl: "https://www.fucheers.top/v1" }]
    ]);

    // 1. Explicit codexProviderId
    expect(matchPricingProvider("krill", providers, configTomlMap)?.id).toBe("provider-2");

    // 2. Direct name match
    expect(matchPricingProvider("fucheers", providers, configTomlMap)?.id).toBe("provider-1");

    // 3. Matched via config.toml "custom" -> "fucheers Codex" contains "fucheers"
    expect(matchPricingProvider("custom", providers, configTomlMap)?.id).toBe("provider-1");

    // 4. Unknown
    expect(matchPricingProvider("nonexistent", providers, configTomlMap)).toBeNull();
  });

  it("calculates 7-day actual spend by provider accurately", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-actual-spend-"));
    try {
      const codexHome = path.join(tempDir, "codex");
      const dbPath = path.join(tempDir, "db", "usage.sqlite");
      const sessionsRoot = path.join(codexHome, "sessions");
      fs.mkdirSync(sessionsRoot, { recursive: true });

      // Create session 1: custom (fucheers) on 2026-09-04
      const session1 = `
{"type":"session_meta","timestamp":"2026-09-04T02:00:00.000Z","payload":{"id":"session-1","model_provider":"custom"}}
{"type":"turn_context","timestamp":"2026-09-04T02:00:01.000Z","payload":{"model":"gpt-5.6-sol"}}
{"type":"event_msg","timestamp":"2026-09-04T02:05:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000000}}}}
`;
      // Create session 2: krill on 2026-09-04
      const session2 = `
{"type":"session_meta","timestamp":"2026-09-04T10:00:00.000Z","payload":{"id":"session-2","model_provider":"krill"}}
{"type":"turn_context","timestamp":"2026-09-04T10:00:01.000Z","payload":{"model":"gpt-5.6-sol"}}
{"type":"event_msg","timestamp":"2026-09-04T10:05:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000000}}}}
`;
      fs.writeFileSync(path.join(sessionsRoot, "s1.jsonl"), session1, "utf8");
      fs.writeFileSync(path.join(sessionsRoot, "s2.jsonl"), session2, "utf8");

      // Write config.toml
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        `[model_providers.custom]\nname = "fucheers"\n[model_providers.krill]\nname = "krill"\n`,
        "utf8"
      );

      const relayProviders: RelayPricingProviderDTO[] = [
        {
          id: "relay-fucheers",
          name: "fucheers",
          enabled: true,
          multiplier: 2.1,
          rechargeRatioUsdPerRmb: 10
        },
        {
          id: "relay-krill",
          name: "krill",
          enabled: true,
          multiplier: 0.2,
          rechargeRatioUsdPerRmb: 1.0
        }
      ];

      const repo = new UsageRepository({
        codexHomePath: codexHome,
        databasePath: dbPath,
        timeZone: "Asia/Shanghai",
        parseVersion: 9,
        relayPricingProviders: relayProviders,
        openaiUsdPerRmb: 0.14
      });

      await repo.sync(true);

      const actualSpend = repo.actualSpendHistoryLastNDays(7);
      expect(actualSpend.length).toBe(7);

      const day0904 = actualSpend.find((d) => d.dateKey === "2026-09-04");
      expect(day0904).toBeDefined();
      if (day0904) {
        expect(day0904.sessionCount).toBe(2);
        expect(day0904.providers.length).toBe(2);

        const fucheersEntry = day0904.providers.find((p) => p.providerName === "fucheers");
        const krillEntry = day0904.providers.find((p) => p.providerName === "krill");

        expect(fucheersEntry).toBeDefined();
        expect(krillEntry).toBeDefined();

        // gpt-5.6-sol 1M input tokens = $5.0 official
        // fucheers: $5.0 * 2.1 = $10.5 USD / 10 = ¥1.05
        expect(fucheersEntry?.costUsd).toBeCloseTo(10.5, 2);
        expect(fucheersEntry?.costCny).toBeCloseTo(1.05, 2);

        // krill: $5.0 * 0.2 = $1.0 USD / 1 = ¥1.0
        expect(krillEntry?.costUsd).toBeCloseTo(1.0, 2);
        expect(krillEntry?.costCny).toBeCloseTo(1.0, 2);

        // total day cost = 1.05 + 1.0 = 2.05
        expect(day0904.totalCostCny).toBeCloseTo(2.05, 2);

        // Sorting check: RelayPricingView price krill (0.2 / 1 = 0.20) is cheaper than fucheers (2.1 / 10 = 0.21)
        // 价格越高的越在后面: krill (0.20) is first, fucheers (0.21) is second
        expect(day0904.providers[0]?.providerName).toBe("krill");
        expect(day0904.providers[1]?.providerName).toBe("fucheers");
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
