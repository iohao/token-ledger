import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { dateKeyFor, parseTimestamp } from "./dateKeys";
import { costFor, normalizeModel } from "./pricing";
import type { UsageTotalsDTO } from "../../src/dto/dashboard";

const MODEL_KEYS = ["model", "model_slug", "model_name"];

export interface RawUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface DailySessionModelUsage {
  sessionId: string;
  relativePath: string;
  dateKey: string;
  model: string;
  isFallback: boolean;
  totals: UsageTotalsDTO;
}

export interface ParsedSessionFile {
  sessionId: string;
  relativePath: string;
  fileSize: number;
  modifiedAt: Date;
  latestUsageAt: Date | null;
  usages: DailySessionModelUsage[];
}

interface UsagePoint {
  timestamp: Date;
  model: string;
  isFallback: boolean;
  totals: UsageTotalsDTO;
}

function emptyTotals(): UsageTotalsDTO {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    costUSD: 0.0
  };
}

export function addUsageTotals(left: UsageTotalsDTO, right: UsageTotalsDTO): UsageTotalsDTO {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    requestCount: left.requestCount + right.requestCount,
    costUSD: left.costUSD + right.costUSD
  };
}

function isZeroUsageTotals(totals: UsageTotalsDTO): boolean {
  return (
    totals.inputTokens === 0 &&
    totals.cachedInputTokens === 0 &&
    totals.cacheCreationInputTokens === 0 &&
    totals.outputTokens === 0 &&
    totals.reasoningOutputTokens === 0
  );
}

function integerValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function rawUsageFromDictionary(value: unknown): RawUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const obj = value as Record<string, unknown>;
  return {
    inputTokens: integerValue(obj.input_tokens),
    cachedInputTokens: integerValue(obj.cached_input_tokens),
    cacheCreationInputTokens: integerValue(obj.cache_creation_input_tokens),
    outputTokens: integerValue(obj.output_tokens),
    reasoningOutputTokens: integerValue(obj.reasoning_output_tokens),
    totalTokens: integerValue(obj.total_tokens)
  };
}

function subtractUsage(current: RawUsage, previous: RawUsage | null): RawUsage {
  if (!previous) {
    return { ...current };
  }
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    cacheCreationInputTokens: Math.max(
      0,
      current.cacheCreationInputTokens - previous.cacheCreationInputTokens
    ),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens
    ),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens)
  };
}

function addRawUsage(left: RawUsage, right: RawUsage): RawUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

function asTotals(raw: RawUsage): UsageTotalsDTO {
  return {
    inputTokens: Math.max(0, raw.inputTokens),
    cachedInputTokens: Math.max(0, raw.cachedInputTokens),
    cacheCreationInputTokens: Math.max(0, raw.cacheCreationInputTokens),
    outputTokens: Math.max(0, raw.outputTokens),
    reasoningOutputTokens: Math.max(0, raw.reasoningOutputTokens),
    totalTokens: Math.max(0, raw.totalTokens),
    requestCount: 1,
    costUSD: 0.0
  };
}

function extractModel(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractModel(item);
      if (extracted) return extracted;
    }
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (MODEL_KEYS.some((candidate) => candidate.toLowerCase() === key.toLowerCase())) {
        const val = obj[key];
        if (typeof val === "string") {
          const normalized = normalizeModel(val);
          if (normalized.length > 0) {
            return normalized;
          }
        }
      }
    }
    for (const subVal of Object.values(obj)) {
      const extracted = extractModel(subVal);
      if (extracted) return extracted;
    }
  }
  return null;
}

function extractModelObject(values: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(values)) {
    if (MODEL_KEYS.some((candidate) => candidate.toLowerCase() === key.toLowerCase())) {
      if (typeof value === "string") {
        const normalized = normalizeModel(value);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    }
  }
  for (const val of Object.values(values)) {
    const extracted = extractModel(val);
    if (extracted) return extracted;
  }
  return null;
}

function relativePosixPath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative.split(path.sep).join("/");
}

export async function parseSessionFile(
  filePath: string,
  sessionsRoot: string,
  timeZone: string
): Promise<ParsedSessionFile> {
  const relativePath = relativePosixPath(sessionsRoot, filePath);
  const sessionId = relativePath.endsWith(".jsonl")
    ? relativePath.slice(0, -6)
    : relativePath;

  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;
  const modifiedAt = stat.mtime;

  let currentModel: string | null = null;
  let currentModelIsFallback = false;
  let previousTotalUsage: RawUsage | null = null;
  let latestUsageAt: Date | null = null;
  const points: UsagePoint[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let jsonValue: any;
    try {
      jsonValue = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!jsonValue || typeof jsonValue !== "object") {
      continue;
    }

    const entryType = typeof jsonValue.type === "string" ? jsonValue.type : null;
    const timestampStr = typeof jsonValue.timestamp === "string" ? jsonValue.timestamp : null;
    const timestamp = timestampStr ? parseTimestamp(timestampStr) : null;
    const payload = jsonValue.payload ?? null;

    if (entryType === "turn_context") {
      const extractedModel = extractModel(payload);
      if (extractedModel) {
        currentModel = extractedModel;
        currentModelIsFallback = false;
      }
      continue;
    }

    if (!payload || typeof payload !== "object") {
      continue;
    }

    if (entryType !== "event_msg" || payload.type !== "token_count") {
      continue;
    }

    if (!timestamp) {
      continue;
    }

    const info = payload.info && typeof payload.info === "object" ? payload.info : null;
    const lastUsage = info ? rawUsageFromDictionary(info.last_token_usage) : null;
    const totalUsage = info ? rawUsageFromDictionary(info.total_token_usage) : null;

    let rawUsage: RawUsage | null = lastUsage ? { ...lastUsage } : null;
    if (!rawUsage && totalUsage) {
      rawUsage = subtractUsage(totalUsage, previousTotalUsage);
    }

    if (totalUsage) {
      previousTotalUsage = { ...totalUsage };
    } else if (lastUsage) {
      previousTotalUsage = previousTotalUsage
        ? addRawUsage(previousTotalUsage, lastUsage)
        : { ...lastUsage };
    }

    if (!rawUsage) {
      continue;
    }

    const extractedModel =
      extractModel(payload) || (info ? extractModelObject(info) : null);

    let model: string;
    let isFallback: boolean;
    if (extractedModel) {
      currentModel = extractedModel;
      currentModelIsFallback = false;
      model = extractedModel;
      isFallback = false;
    } else if (currentModel) {
      model = currentModel;
      isFallback = currentModelIsFallback;
    } else {
      currentModel = "gpt-5";
      currentModelIsFallback = true;
      model = "gpt-5";
      isFallback = true;
    }

    const totals = asTotals(rawUsage);
    if (isZeroUsageTotals(totals)) {
      continue;
    }

    if (!latestUsageAt || timestamp.getTime() > latestUsageAt.getTime()) {
      latestUsageAt = timestamp;
    }

    points.push({
      timestamp,
      model,
      isFallback,
      totals: {
        ...totals,
        costUSD: costFor(totals, model)
      }
    });
  }

  // Aggregate by dateKey + model + isFallback
  const aggregated = new Map<string, DailySessionModelUsage>();

  for (const point of points) {
    const dateKey = dateKeyFor(point.timestamp, timeZone);
    const key = `${dateKey}\0${point.model}\0${point.isFallback ? 1 : 0}`;

    const existing = aggregated.get(key);
    if (existing) {
      existing.totals = addUsageTotals(existing.totals, point.totals);
    } else {
      aggregated.set(key, {
        sessionId,
        relativePath,
        dateKey,
        model: point.model,
        isFallback: point.isFallback,
        totals: { ...point.totals }
      });
    }
  }

  const usages = Array.from(aggregated.values());
  usages.sort((left, right) => {
    if (left.dateKey !== right.dateKey) {
      return right.dateKey.localeCompare(left.dateKey);
    }
    if (left.model !== right.model) {
      return left.model.localeCompare(right.model);
    }
    return Number(left.isFallback) - Number(right.isFallback);
  });

  return {
    sessionId,
    relativePath,
    fileSize,
    modifiedAt,
    latestUsageAt,
    usages
  };
}
