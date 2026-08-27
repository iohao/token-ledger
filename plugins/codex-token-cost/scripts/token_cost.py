#!/usr/bin/env python3
"""Codex Stop hook for per-turn and session model requests and token costs."""

from __future__ import annotations

import json
import os
import sys
import tomllib
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from pathlib import Path
from typing import Any, Mapping


ONE_MILLION = Decimal(1_000_000)
DISPLAY_QUANTUM = Decimal("0.000001")
UNKNOWN_MODEL = "<unknown>"


def normalize_model(raw_value: str) -> str:
    """Normalize model identifier matching TokenLedger rules."""
    normalized = raw_value.strip().lower()
    for prefix in ("openrouter/openai/", "openai/", "azure/"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break

    # Strip trailing date suffixes like -2026-08-01
    if len(normalized) > 11:
        suffix = normalized[-11:]
        if (
            suffix.startswith("-")
            and suffix[1:5].isdigit()
            and suffix[5] == "-"
            and suffix[6:8].isdigit()
            and suffix[8] == "-"
            and suffix[9:11].isdigit()
        ):
            normalized = normalized[:-11]

    if normalized in ("gpt-5-codex", "gpt-5.2-codex"):
        return "gpt-5.3-codex"
    if normalized == "gpt-5.6":
        return "gpt-5.6-sol"
    return normalized


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    cache_write_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_output_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "TokenUsage":
        if not isinstance(raw, Mapping):
            return cls()

        def read(snake_name: str, camel_name: str) -> int:
            val = raw.get(snake_name, raw.get(camel_name, 0))
            if isinstance(val, bool) or not isinstance(val, int) or val < 0:
                return 0
            return val

        return cls(
            input_tokens=read("input_tokens", "inputTokens"),
            cached_input_tokens=read("cached_input_tokens", "cachedInputTokens"),
            cache_write_input_tokens=read("cache_write_input_tokens", "cacheWriteInputTokens"),
            output_tokens=read("output_tokens", "outputTokens"),
            reasoning_output_tokens=read("reasoning_output_tokens", "reasoningOutputTokens"),
            total_tokens=read("total_tokens", "totalTokens"),
        )

    def __add__(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            cached_input_tokens=self.cached_input_tokens + other.cached_input_tokens,
            cache_write_input_tokens=self.cache_write_input_tokens + other.cache_write_input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            reasoning_output_tokens=self.reasoning_output_tokens + other.reasoning_output_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
        )

    @property
    def is_zero(self) -> bool:
        return self == TokenUsage()


@dataclass(frozen=True)
class ModelPricing:
    input_per_million: Decimal = Decimal(0)
    output_per_million: Decimal = Decimal(0)
    cached_input_per_million: Decimal = Decimal(0)
    cache_creation_per_million: Decimal = Decimal(0)


@dataclass
class TurnUsage:
    turn_id: str
    by_model: dict[str, TokenUsage] = field(default_factory=dict)
    request_count: int = 0

    def add(self, model: str, usage: TokenUsage) -> None:
        key = normalize_model(model) if model else UNKNOWN_MODEL
        self.by_model[key] = self.by_model.get(key, TokenUsage()) + usage
        self.request_count += 1

    @property
    def total(self) -> TokenUsage:
        result = TokenUsage()
        for usage in self.by_model.values():
            result = result + usage
        return result


@dataclass(frozen=True)
class TranscriptUsage:
    turns: dict[str, TurnUsage]
    summed_last: TokenUsage
    session_total: TokenUsage
    request_count: int


def _parse_decimal(val: Any) -> Decimal:
    if isinstance(val, (int, float, str)):
        try:
            d = Decimal(str(val))
            if d.is_finite() and d >= 0:
                return d
        except InvalidOperation:
            pass
    return Decimal(0)


def load_pricing(pricing_path: Path) -> tuple[str, dict[str, ModelPricing]]:
    """Load provider name and model pricing map from pricing.toml."""
    if not pricing_path.is_file():
        return "", {}
    try:
        with pricing_path.open("rb") as handle:
            doc = tomllib.load(handle)
    except Exception:
        return "", {}

    provider_info = doc.get("provider", {})
    provider_name = ""
    if isinstance(provider_info, Mapping):
        provider_name = str(provider_info.get("name", "")).strip()

    raw_models = doc.get("models", {})
    pricing_map: dict[str, ModelPricing] = {}

    def extract_entry(model_id: str, rates: Mapping[str, Any]) -> None:
        norm_id = normalize_model(str(model_id))
        pricing_map[norm_id] = ModelPricing(
            input_per_million=_parse_decimal(rates.get("input_per_million")),
            output_per_million=_parse_decimal(rates.get("output_per_million")),
            cached_input_per_million=_parse_decimal(rates.get("cached_input_per_million")),
            cache_creation_per_million=_parse_decimal(rates.get("cache_creation_per_million")),
        )

    def traverse_dict(d: Mapping[str, Any], prefix: str = "") -> None:
        if "input_per_million" in d or "output_per_million" in d:
            if prefix:
                extract_entry(prefix, d)
            return
        for key, val in d.items():
            if isinstance(val, Mapping):
                full_key = f"{prefix}.{key}" if prefix else key
                traverse_dict(val, full_key)

    if isinstance(raw_models, Mapping):
        for model_id, val in raw_models.items():
            if isinstance(val, Mapping):
                traverse_dict(val, str(model_id))
    elif isinstance(raw_models, list):
        for item in raw_models:
            if isinstance(item, Mapping) and "id" in item:
                extract_entry(str(item["id"]), item)

    return provider_name, pricing_map


def calculate_cost(usage: TokenUsage, pricing: ModelPricing) -> Decimal:
    """Calculate USD cost for a token usage breakdown."""
    cached_input = min(usage.cached_input_tokens, usage.input_tokens)
    regular_input = max(0, usage.input_tokens - cached_input)
    cache_write = max(0, usage.cache_write_input_tokens)
    output_tokens = max(0, usage.output_tokens)

    with localcontext() as ctx:
        ctx.prec = 50
        input_cost = Decimal(regular_input) * pricing.input_per_million / ONE_MILLION
        cached_cost = Decimal(cached_input) * pricing.cached_input_per_million / ONE_MILLION
        cache_write_cost = Decimal(cache_write) * pricing.cache_creation_per_million / ONE_MILLION
        output_cost = Decimal(output_tokens) * pricing.output_per_million / ONE_MILLION
        return input_cost + cached_cost + cache_write_cost + output_cost


def parse_rollout(path: Path) -> TranscriptUsage:
    """Parse Codex rollout JSONL transcript into structured usage."""
    turns: dict[str, TurnUsage] = {}
    active_turn_id: str | None = None
    active_model = UNKNOWN_MODEL
    summed_last = TokenUsage()
    previous_reported_total: TokenUsage | None = None
    request_count = 0

    try:
        handle = path.open("r", encoding="utf-8")
    except OSError:
        return TranscriptUsage(turns={}, summed_last=summed_last, session_total=summed_last, request_count=0)

    with handle:
        for line in handle:
            line_str = line.strip()
            if not line_str:
                continue
            try:
                event = json.loads(line_str)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, Mapping):
                continue

            event_type = event.get("type")
            payload = event.get("payload")
            if event_type == "turn_context" and isinstance(payload, Mapping):
                raw_turn_id = payload.get("turn_id", payload.get("turnId"))
                raw_model = payload.get("model")
                if isinstance(raw_turn_id, str) and raw_turn_id:
                    active_turn_id = raw_turn_id
                    turns.setdefault(raw_turn_id, TurnUsage(raw_turn_id))
                else:
                    active_turn_id = None
                active_model = str(raw_model) if raw_model else UNKNOWN_MODEL
                continue

            if (
                event_type == "event_msg"
                and isinstance(payload, Mapping)
                and payload.get("type") == "token_count"
            ):
                info = payload.get("info")
                if not isinstance(info, Mapping):
                    continue
                raw_last = info.get("last_token_usage", info.get("lastTokenUsage"))
                if raw_last is None:
                    continue
                last = TokenUsage.from_mapping(raw_last)

                raw_total = info.get("total_token_usage", info.get("totalTokenUsage"))
                if raw_total is not None:
                    reported_total = TokenUsage.from_mapping(raw_total)
                    if reported_total == previous_reported_total:
                        continue
                    previous_reported_total = reported_total

                summed_last = summed_last + last
                request_count += 1

                if active_turn_id is not None:
                    turns[active_turn_id].add(active_model, last)

    return TranscriptUsage(
        turns=turns,
        summed_last=summed_last,
        session_total=summed_last,
        request_count=request_count,
    )


def format_money(value: Decimal) -> str:
    with localcontext() as ctx:
        ctx.prec = 50
        rounded = value.quantize(DISPLAY_QUANTUM, rounding=ROUND_HALF_UP)
    return f"${rounded:.6f}"


def calculate_turn_cost(turn: TurnUsage, pricing_map: dict[str, ModelPricing]) -> Decimal | None:
    total = Decimal(0)
    for model, usage in turn.by_model.items():
        if usage.is_zero:
            continue
        pricing = pricing_map.get(model)
        if pricing is None:
            return None
        total += calculate_cost(usage, pricing)
    return total


def render_usage(
    transcript: TranscriptUsage,
    turn_id: str,
    pricing_map: dict[str, ModelPricing],
    provider_name: str = "",
) -> str:
    turn = transcript.turns.get(turn_id)
    if turn is None or turn.total.is_zero:
        return "Usage unavailable: no token usage was recorded for this turn."

    turn_cost = calculate_turn_cost(turn, pricing_map)
    turn_display = format_money(turn_cost) if turn_cost is not None else "N/A"

    session_cost_sum = Decimal(0)
    session_cost_available = True
    for t in transcript.turns.values():
        c = calculate_turn_cost(t, pricing_map)
        if c is None:
            session_cost_available = False
            break
        session_cost_sum += c

    session_display = (
        format_money(session_cost_sum) if session_cost_available and turn_cost is not None else "N/A"
    )

    prefix = f"[{provider_name}] " if provider_name else ""
    return (
        f"{prefix}本轮 [花费：{turn_display}，请求 {turn.request_count} 次] | "
        f"总计 [花费：{session_display}，请求 {transcript.request_count} 次]"
    )


def handle_hook(payload: Mapping[str, Any], plugin_root: Path) -> dict[str, Any]:
    if payload.get("hook_event_name") != "Stop":
        return {"continue": True, "systemMessage": "Usage unavailable: expected a Stop hook payload."}

    raw_path = payload.get("transcript_path")
    turn_id = payload.get("turn_id")
    if not isinstance(raw_path, str) or not raw_path:
        return {"continue": True, "systemMessage": "Usage unavailable: Codex did not provide a rollout path."}
    if not isinstance(turn_id, str) or not turn_id:
        return {"continue": True, "systemMessage": "Usage unavailable: Codex did not provide a turn id."}

    transcript = parse_rollout(Path(raw_path))
    provider_name, pricing_map = load_pricing(plugin_root / "pricing.toml")
    message = render_usage(transcript, turn_id, pricing_map, provider_name)
    return {"continue": True, "systemMessage": message}


def main() -> int:
    plugin_root = Path(__file__).resolve().parent.parent
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, Mapping):
            output = {"continue": True, "systemMessage": "Usage unavailable: hook payload is not an object."}
        else:
            output = handle_hook(payload, plugin_root)
    except Exception as exc:
        output = {"continue": True, "systemMessage": f"Usage unavailable: {exc}"}
    print(json.dumps(output, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

