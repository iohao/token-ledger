from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))

import token_cost as tc  # noqa: E402


def usage(
    *,
    input_tokens: int = 0,
    cached_input_tokens: int = 0,
    cache_write_input_tokens: int = 0,
    output_tokens: int = 0,
    reasoning_output_tokens: int = 0,
    total_tokens: int | None = None,
) -> tc.TokenUsage:
    return tc.TokenUsage(
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        cache_write_input_tokens=cache_write_input_tokens,
        output_tokens=output_tokens,
        reasoning_output_tokens=reasoning_output_tokens,
        total_tokens=(
            input_tokens + output_tokens if total_tokens is None else total_tokens
        ),
    )


def turn_context(turn_id: str, model: str) -> dict[str, object]:
    return {
        "type": "turn_context",
        "payload": {"turn_id": turn_id, "model": model},
    }


def token_event(last: tc.TokenUsage, total: tc.TokenUsage) -> dict[str, object]:
    return {
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "last_token_usage": asdict(last),
                "total_token_usage": asdict(total),
            },
        },
    }


def write_rollout(path: Path, events: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(event) + "\n" for event in events),
        encoding="utf-8",
    )


class PluginLayoutTests(unittest.TestCase):
    def test_hook_config_uses_codex_discovery_path(self) -> None:
        self.assertTrue((PLUGIN_ROOT / "hooks" / "hooks.json").is_file())
        self.assertFalse((PLUGIN_ROOT / "hooks.json").exists())

    @unittest.skipIf(os.name == "nt", "POSIX plugin hook command")
    def test_hook_command_runs_outside_plugin_directory(self) -> None:
        hook_config = json.loads(
            (PLUGIN_ROOT / "hooks" / "hooks.json").read_text(encoding="utf-8")
        )
        command = hook_config["hooks"]["Stop"][0]["hooks"][0]["command"]
        self.assertIn("${PLUGIN_ROOT}", command)

        with tempfile.TemporaryDirectory() as temp_dir:
            environment = os.environ.copy()
            environment["PLUGIN_ROOT"] = str(PLUGIN_ROOT)
            completed = subprocess.run(
                command,
                cwd=temp_dir,
                env=environment,
                input=json.dumps({"hook_event_name": "Stop"}),
                text=True,
                shell=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        output = json.loads(completed.stdout)
        self.assertTrue(output["continue"])
        self.assertIn("rollout path", output["systemMessage"])


class PricingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.provider_name, cls.pricing_map = tc.load_pricing(PLUGIN_ROOT / "pricing.toml")
        cls.luna = cls.pricing_map["gpt-5.6-luna"]

    def test_model_normalization(self) -> None:
        self.assertEqual(tc.normalize_model("openai/gpt-5.6-sol-2026-08-01"), "gpt-5.6-sol")
        self.assertEqual(tc.normalize_model("openrouter/openai/gpt-5.6"), "gpt-5.6-sol")
        self.assertEqual(tc.normalize_model("gpt-5-codex"), "gpt-5.3-codex")
        self.assertEqual(tc.normalize_model("azure/gpt-5.4-mini"), "gpt-5.4-mini")

    def test_plain_input_cost(self) -> None:
        cost = tc.calculate_cost(usage(input_tokens=1_000_000), self.luna)
        self.assertEqual(cost, self.luna.input_per_million)

    def test_cache_read_cost(self) -> None:
        cost = tc.calculate_cost(
            usage(input_tokens=1_000_000, cached_input_tokens=1_000_000),
            self.luna,
        )
        self.assertEqual(cost, self.luna.cached_input_per_million)

    def test_output_cost(self) -> None:
        cost = tc.calculate_cost(usage(output_tokens=1_000_000), self.luna)
        self.assertEqual(cost, self.luna.output_per_million)

    def test_cache_creation_cost(self) -> None:
        cost = tc.calculate_cost(
            usage(cache_write_input_tokens=1_000_000), self.luna
        )
        self.assertEqual(cost, self.luna.cache_creation_per_million)

    def test_mixed_cost_does_not_double_charge_cached_input(self) -> None:
        cost = tc.calculate_cost(
            usage(
                input_tokens=1_000_000,
                cached_input_tokens=250_000,
                output_tokens=100_000,
            ),
            self.luna,
        )
        expected = (
            Decimal(750_000) * self.luna.input_per_million / Decimal(1_000_000)
            + Decimal(250_000) * self.luna.cached_input_per_million / Decimal(1_000_000)
            + Decimal(100_000) * self.luna.output_per_million / Decimal(1_000_000)
        )
        self.assertEqual(cost, expected)

    def test_money_formatting(self) -> None:
        self.assertEqual(tc.format_money(Decimal("0.0001234")), "$0.000123")
        self.assertEqual(tc.format_money(Decimal("1.5")), "$1.500000")


class RolloutTests(unittest.TestCase):
    def test_multiple_responses_are_summed_for_one_turn(self) -> None:
        first = usage(input_tokens=100, output_tokens=10)
        second = usage(input_tokens=200, cached_input_tokens=100, output_tokens=20)
        cumulative = first + second
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "rollout.jsonl"
            write_rollout(
                path,
                [
                    turn_context("turn-1", "gpt-5.6-luna"),
                    token_event(first, first),
                    token_event(second, cumulative),
                ],
            )
            transcript = tc.parse_rollout(path)
        self.assertEqual(transcript.turns["turn-1"].total, cumulative)
        self.assertEqual(transcript.turns["turn-1"].request_count, 2)
        self.assertEqual(transcript.session_total, cumulative)
        self.assertEqual(transcript.request_count, 2)

    def test_repeated_token_notification_is_not_counted_twice(self) -> None:
        response = usage(
            input_tokens=161_674,
            cached_input_tokens=159_488,
            output_tokens=6_875,
            reasoning_output_tokens=931,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "rollout.jsonl"
            duplicate = token_event(response, response)
            write_rollout(
                path,
                [
                    turn_context("turn-1", "gpt-5.6-sol"),
                    duplicate,
                    duplicate,
                ],
            )
            transcript = tc.parse_rollout(path)
        self.assertEqual(transcript.turns["turn-1"].total, response)
        self.assertEqual(transcript.turns["turn-1"].request_count, 1)
        self.assertEqual(transcript.session_total, response)
        self.assertEqual(transcript.request_count, 1)


class HookTests(unittest.TestCase):
    def test_stop_hook_renders_summary(self) -> None:
        turn = usage(
            input_tokens=1_000_000,
            cached_input_tokens=500_000,
            output_tokens=100_000,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            rollout = temp_path / "rollout.jsonl"
            write_rollout(
                rollout,
                [
                    turn_context("turn-1", "gpt-5.6-luna"),
                    token_event(turn, turn),
                ],
            )
            payload = {
                "hook_event_name": "Stop",
                "session_id": "session-1",
                "turn_id": "turn-1",
                "model": "gpt-5.6-luna",
                "transcript_path": str(rollout),
            }
            result = tc.handle_hook(payload, PLUGIN_ROOT)
            self.assertTrue(result["continue"])
            self.assertIn("本轮 [花费：$", result["systemMessage"])
            self.assertIn("总计 [花费：$", result["systemMessage"])

    def test_unknown_model_renders_na(self) -> None:
        turn = usage(input_tokens=100)
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            rollout = temp_path / "rollout.jsonl"
            write_rollout(
                rollout,
                [
                    turn_context("turn-1", "unknown-future-model"),
                    token_event(turn, turn),
                ],
            )
            payload = {
                "hook_event_name": "Stop",
                "turn_id": "turn-1",
                "model": "unknown-future-model",
                "transcript_path": str(rollout),
            }
            result = tc.handle_hook(payload, PLUGIN_ROOT)
        self.assertIn(
            "本轮 [花费：N/A，请求 1 次] | 总计 [花费：N/A，请求 1 次]",
            result["systemMessage"],
        )


if __name__ == "__main__":
    unittest.main()

