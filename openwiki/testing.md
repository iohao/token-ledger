---
type: Testing
title: Testing Strategy and CI
description: Where Rust unit tests live, how the TS-vs-Rust parity check works, what CI runs on every change, and how demo mode fits into UI testing.
tags: [testing, ci, parity]
---

# Testing Strategy

TokenLedger has three testing surfaces:

1. **Rust unit tests** — `#[cfg(test)] mod tests` blocks in
   `src-tauri/src/app_state.rs`, `parser.rs`, `repository.rs`, `store.rs`,
   and `pricing.rs`.
2. **Frontend type checks** — `npm run typecheck` (the only frontend gate
   in CI; no ESLint or Prettier config is checked in).
3. **End-to-end parity** — `scripts/compare-ts-rust.mjs` cross-checks the
   new Rust sync pipeline against the historical TypeScript baseline.

## What CI runs

`.github/workflows/desktop-ci.yml` runs on every PR, push to `main`, and
manual dispatch. For both macOS-latest and windows-latest runners:

```
npm ci
npm run typecheck
cargo test                       # working-directory: src-tauri
npm run desktop -- build --ci --no-sign
```

Bundles are uploaded as `desktop-bundle-${label}` artifacts (14 days
retention) and the build is the authoritative "does it compile" gate.

The release workflow runs the same set before uploading signed bundles
and adds `scripts/build-updater-manifest.mjs` for the final manifest.

## Rust unit tests

Inline `#[cfg(test)]` modules keep tests next to the code they exercise.

### `src-tauri/src/app_state.rs`

Focus on the resolution and state-guard helpers:

- `prefers_home_when_present` / `falls_back_to_userprofile_when_missing` /
  `returns_none_when_no_home_variables_exist` for
  `default_codex_home_from_env`.
- `resolve_database_config_prefers_env_override` /
  `resolve_database_config_uses_saved_setting_when_present` /
  `resolve_database_config_falls_back_to_default_path`.
- `default_database_path_uses_codex_usage_directory`.
- `try_begin_sync_marks_running_until_finished` and
  `try_begin_sync_invalidates_sync_preview_cache` — exercise the
  single-flight guard and its cache-invalidation side effects.
- `sync_preview_cache_roundtrip` and `session_file_scan_cache_roundtrip`
  — confirm the two AppState TTL caches are read, expired, and
  invalidated correctly.
- `app_settings_roundtrip` and
  `app_settings_loads_legacy_path_when_new_path_missing` — cover the
  `load_app_settings` / `save_app_settings` flow plus the legacy
  settings dir fallbacks.
- `pricing_update_preserves_database_path_setting` — confirms
  `set_model_pricing_overrides` does not clobber the existing
  `database_path` entry in `AppSettings`.

### `src-tauri/src/parser.rs`

Cover token-count extraction from a fixture JSONL file:

- `parses_last_token_usage_and_aggregates_same_day` — multi-event JSONL
  with `last_token_usage`, a `turn_context` model hint, a noisy
  non-JSON line, dated model variants, and cache-creation fields.
  Asserts the resulting per-session totals include the parsed
  `cache_creation_input_tokens` and a non-zero `cost_usd`.
- `derives_deltas_from_total_usage_and_uses_fallback_model` — only
  `total_token_usage` is present, so the parser must subtract the
  previous cumulative reading. Also covers the `gpt-5` fallback
  (`is_fallback = true`) when no model is in the payload.
- `extracts_nested_model_and_ignores_zero_usage_points` — model is
  discovered inside a nested `meta.messages[].model_slug`, and
  zero-token events are dropped from the output.

The fixtures are constructed in-memory via `tempfile::TempDir` and
written into `<temp_dir>/sessions/<relative>.jsonl`.

### `src-tauri/src/repository.rs`

End-to-end exercise of the sync pipeline against an in-memory temp dir:

- `make_repository(temp_dir, parse_version)` builds a repository with a
  real `UsageStore` over a temp SQLite database;
  `make_repository_with_overrides` adds a pricing override list.
- `parse_version_change_forces_full_rescan_preview` (notable: this is
  how a bumped `parse_version` is verified to trigger a rescan).
- `pricing_override_reprices_existing_history_without_rescan` —
  writes a session, applies a relay-model override, and asserts the
  `daily_usage` row reflects the new cost without a rescan.
- `daily_history_between_returns_requested_range_with_empty_days` and
  `dashboard_activity_history_covers_trailing_year_with_empty_days` —
  exercise the dashboard date range and activity-wall backfill.
- `sync_preview_detects_new_session_and_clears_after_sync`,
  `sync_removes_deleted_session_and_rebuilds_aggregates`,
  `force_full_rescan_rebuilds_from_current_files_only`,
  `sync_failure_persists_failed_status` — cover dirty detection,
  removed-session cleanup, full-rescan behavior, and failed-sync
  status persistence.

### `src-tauri/src/store.rs`

- `sync_status_and_context_roundtrip` — exercises the `sync_state`
  key/value rows and the legacy-row fallback in `load_sync_status`.
- `replaces_session_and_rebuilds_daily_and_monthly_aggregates` —
  confirms `replace_session_file` upserts `source_sessions` while
  deleting/replacing `session_daily_usage`, and that
  `rebuild_aggregates_for_date_keys` correctly recomputes the daily
  and monthly rollups (including the `cache_creation_input_tokens`
  column).
- `migrate_adds_cache_creation_column_to_existing_usage_tables` — opens
  a SQLite database that pre-dates the cache-creation column and
  asserts `UsageStore::migrate` adds the column to all three usage
  tables without rebuilding existing rows.
- `delete_sessions` is exercised by the repository-level test
  `sync_removes_deleted_session_and_rebuilds_aggregates`.

### `src-tauri/src/pricing.rs`

Concrete numeric and validation assertions:

- `official_pricing_remains_default` — `cost_for` matches the
  hard-coded official rate card (1M input + 200K cache read + 100K
  output = `$7.10` for `gpt-5.6-sol`).
- `enabled_sol_override_prices_all_token_categories` — when the
  `gpt-5.6-sol` override is enabled, the relay rates drive all four
  token categories (1M input + 200K cache read + 100K cache creation +
  100K output = `$13.005`).
- `generic_gpt_5_6_uses_sol_override` — the generic `gpt-5.6` model
  name maps to the `gpt-5.6-sol` override slot.
- `cache_categories_are_clamped_to_total_input` — cache-read and
  cache-creation tokens are clamped so they cannot exceed
  `input_tokens`.
- `rejects_negative_prices` — `validate_pricing_overrides` rejects a
  negative `input_usd_per_million` with the expected error message.
- `invalid_stored_override_falls_back_to_disabled_preset` — the
  `normalize_pricing_overrides` loader strips bad stored rows back
  to the disabled preset instead of failing.
- `normalizes_dated_gpt_5_5_snapshot` — `openai/gpt-5.5-2026-04-24`
  strips to `gpt-5.5`.

## Frontend checks

There is no dedicated UI test suite today. Verification is manual via
`npm run desktop -- dev` and the demo build at `?demo=1`. `AGENTS.md`
asks future contributors to:

> Add or extend those tests when changing parsing, storage, or
> aggregation behavior. Frontend changes should at minimum pass
> `npm run typecheck` and be manually checked in `npm run desktop -- dev`.

`tsconfig.json` is `strict: true` with `noEmit: true`; the type-check is
the contract that prevents drift between the Rust DTOs and the
TypeScript mirrors in `src/dto/dashboard.ts`.

## Demo mode

`?demo=1` short-circuits every Tauri command to in-memory payloads from
`src/api/demo.ts`. This is the fastest way to:

- Run the Vite dev server (`npm run dev -- --host 127.0.0.1`) and open
  `http://127.0.0.1:25174/?demo=1&tab=dailyDetail` to exercise UI tabs
  without a real Codex install.
- Capture screenshots for documentation / releases.
- Reproduce layout issues regardless of time zone (`Asia/Shanghai` is
  hard-coded in the demo meta block).

The demo mode also persists edits to the SQLite path through
`updateDemoDatabasePath` and edits to the relay-model pricing through
`updateDemoModelPricingSettings`, so the model-pricing form in the sync
info tab (`?tab=syncInfo`) can be exercised end-to-end without a real
Codex install.

## Parity check (`compare-ts-rust.mjs`)

`scripts/compare-ts-rust.mjs` was used during the Rust migration to verify
that the new Rust pipeline produces identical `DashboardPayloadDTO`
JSON to the legacy TypeScript server. It:

1. Backs up the existing `${CODEX_HOME}/.codex-usage/usage.sqlite` into
   two temp copies.
2. Spawns the old `node server/index.ts` against one copy.
3. Spawns `cargo run --bin export_dashboard` against the other copy.
4. Compares pre-sync dashboard, pre-sync preview, and post-sync dashboard
   payloads (with deep equality after normalization).

The script's default `OLD_PROJECT_ROOT` is hard-coded to a developer
machine (`/Users/join/gitme/ionet_me/codexUsageTs`); it is a one-off
parity tool, not a CI gate. Treat it as historical evidence of the
migration rather than a required check.

## What to add or run when changing the code

| Touched area | Run |
|---|---|
| Parser (`parser.rs`) | `cd src-tauri && cargo test parser` |
| Pricing (`pricing.rs`) | `cd src-tauri && cargo test pricing` |
| SQLite store (`store.rs`) | `cd src-tauri && cargo test store` |
| Repository sync flow (`repository.rs`) | `cd src-tauri && cargo test repository` |
| AppState / settings (`app_state.rs`) | `cd src-tauri && cargo test app_state` |
| Relay-model pricing form (`src/main.ts` model pricing block, `pricing.rs` validation) | `cd src-tauri && cargo test pricing && cargo test app_state && npm run typecheck` then `?demo=1&tab=syncInfo` |
| Frontend DTOs (`src/dto`, `src/api`) | `npm run typecheck` |
| Anything end-to-end | `npm run desktop -- dev` (and try `?demo=1` for UI-only changes) |
| Release plumbing | trigger the release workflow via `workflow_dispatch` (or push a tag once confident) |