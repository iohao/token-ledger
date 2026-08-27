# Codex Token Cost

This plugin shows a compact per-turn and session model request and cost summary
in the Codex TUI after every completed turn:

```text
本轮 [花费：$0.033030，请求 2 次] | 总计 [花费：$0.072785，请求 5 次]
```

It reads the usage written to the session rollout JSONL and calculates costs based
on the relay pricing configured in TokenLedger.

## Pricing

Model prices are automatically managed and synchronized by TokenLedger via `RelayPricingView`
and stored in `pricing.toml`:

```toml
[models."gpt-5.6-sol"]
input_per_million = "0.7500"
output_per_million = "4.5000"
cached_input_per_million = "0.0750"
cache_creation_per_million = "0.7500"
```

## Install

From this repository root:

```bash
codex plugin marketplace add .
codex plugin add codex-token-cost@token-ledger-local
```

