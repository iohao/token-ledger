import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSessionFile } from "../electron/services/parser";

function writeSession(tempDir: string, relativePath: string, content: string): string {
  const sessionsRoot = path.join(tempDir, "sessions");
  const filePath = path.join(sessionsRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("parser service", () => {
  it("parses last token usage and aggregates same day", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
    try {
      const sessionContent = `
invalid json
{"type":"turn_context","timestamp":"2026-04-09T01:00:00.000Z","payload":{"model":"openai/gpt-5.4"}}
{"type":"event_msg","timestamp":"2026-04-09T01:02:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"cache_creation_input_tokens":5,"output_tokens":10,"reasoning_output_tokens":3,"total_tokens":110}}}}
{"type":"event_msg","timestamp":"2026-04-09T01:05:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"cache_creation_input_tokens":3,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":55},"model":"gpt-5.4-2026-04-01"}}}
`;
      const filePath = writeSession(tempDir, "2026/04/09/example.jsonl", sessionContent);
      const sessionsRoot = path.join(tempDir, "sessions");

      const parsed = await parseSessionFile(filePath, sessionsRoot, "Asia/Shanghai");

      expect(parsed.sessionId).toBe("2026/04/09/example");
      expect(parsed.relativePath).toBe("2026/04/09/example.jsonl");
      expect(parsed.usages.length).toBe(1);

      const usage = parsed.usages[0];
      expect(usage.dateKey).toBe("2026-04-09");
      expect(usage.model).toBe("gpt-5.4");
      expect(usage.isFallback).toBe(false);
      expect(usage.totals.inputTokens).toBe(150);
      expect(usage.totals.cachedInputTokens).toBe(50);
      expect(usage.totals.cacheCreationInputTokens).toBe(8);
      expect(usage.totals.outputTokens).toBe(15);
      expect(usage.totals.reasoningOutputTokens).toBe(4);
      expect(usage.totals.totalTokens).toBe(165);
      expect(usage.totals.requestCount).toBe(2);
      expect(usage.totals.costUSD).toBeGreaterThan(0.0);
      expect(parsed.latestUsageAt?.toISOString()).toBe("2026-04-09T01:05:00.000Z");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("derives deltas from total usage and uses fallback model", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
    try {
      const sessionContent = `
{"type":"event_msg","timestamp":"2026-04-09T02:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"cache_creation_input_tokens":10,"output_tokens":30,"reasoning_output_tokens":5,"total_tokens":130}}}}
{"type":"event_msg","timestamp":"2026-04-09T02:10:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":50,"cache_creation_input_tokens":25,"output_tokens":45,"reasoning_output_tokens":8,"total_tokens":225}}}}
`;
      const filePath = writeSession(tempDir, "fallback/session.jsonl", sessionContent);
      const sessionsRoot = path.join(tempDir, "sessions");

      const parsed = await parseSessionFile(filePath, sessionsRoot, "Asia/Shanghai");

      expect(parsed.usages.length).toBe(1);
      const usage = parsed.usages[0];
      expect(usage.model).toBe("gpt-5");
      expect(usage.isFallback).toBe(true);
      expect(usage.totals.inputTokens).toBe(180);
      expect(usage.totals.cachedInputTokens).toBe(50);
      expect(usage.totals.cacheCreationInputTokens).toBe(25);
      expect(usage.totals.outputTokens).toBe(45);
      expect(usage.totals.reasoningOutputTokens).toBe(8);
      expect(usage.totals.totalTokens).toBe(225);
      expect(usage.totals.requestCount).toBe(2);
      expect(usage.totals.costUSD).toBe(0.0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts nested model and ignores zero usage points", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
    try {
      const sessionContent = `
{"type":"event_msg","timestamp":"2026-04-09T02:00:00.000Z","payload":{"type":"token_count","meta":{"messages":[{"model_slug":"openai/gpt-5.4-mini"}]},"info":{"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":0}}}}
{"type":"event_msg","timestamp":"2026-04-09T02:10:00.000Z","payload":{"type":"token_count","meta":{"messages":[{"model_slug":"openai/gpt-5.4-mini"}]},"info":{"last_token_usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":7,"reasoning_output_tokens":2,"total_tokens":27}}}}
`;
      const filePath = writeSession(tempDir, "nested/model.jsonl", sessionContent);
      const sessionsRoot = path.join(tempDir, "sessions");

      const parsed = await parseSessionFile(filePath, sessionsRoot, "Asia/Shanghai");

      expect(parsed.usages.length).toBe(1);
      const usage = parsed.usages[0];
      expect(usage.model).toBe("gpt-5.4-mini");
      expect(usage.isFallback).toBe(false);
      expect(usage.totals.inputTokens).toBe(20);
      expect(usage.totals.cachedInputTokens).toBe(5);
      expect(usage.totals.outputTokens).toBe(7);
      expect(usage.totals.reasoningOutputTokens).toBe(2);
      expect(usage.totals.totalTokens).toBe(27);
      expect(usage.totals.requestCount).toBe(1);
      expect(usage.totals.costUSD).toBeGreaterThan(0.0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
