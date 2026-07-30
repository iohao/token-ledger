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
- `try_begin_sync_marks_running_until_finished` — exercises the single-
  flight guard.
- A parallel block covers `app_settings_path` / `legacy_app_settings_paths`
  / `load_app_settings` / `save_app_settings` round-trips.

### `src-tauri/src/parser.rs`

Cover token-count extraction from a fixture JSONL file:

- Single event with `last_token_usage`.
- Event with only `total_token_usage` and a previous cumulative reading
  (delta path).
- `turn_context` model hint propagation and fallback to `gpt-5`.
- Empty file, file with only non-`event_msg` lines.

The fixtures are constructed in-memory via `tempfile::TempDir`.

### `src-tauri/src/repository.rs`

End-to-end exercise of the sync pipeline against an in-memory temp dir:

- `make_repository(temp_dir, parse_version)` builds a repository with a
  real `UsageStore` over a temp SQLite database.
- `parse_version_change_forces_full_rescan_preview` (notable: this is
  how a bumped `parse_version` is verified to trigger a rescan).
- Scenarios that simulate dirty sessions, removed sessions, and rebuild
  of `daily_usage` / `monthly_usage`.

### `src-tauri/src/store.rs`

- Migration is idempotent (`CREATE TABLE IF NOT EXISTS`).
- `replace_session_file` upserts and overwrites previous rows for a
  given `session_id`.
- `delete_sessions` cleans up both `session_daily_usage` and
  `source_sessions`.
- `rebuild_aggregates_for_date_keys` correctly recomputes monthly rollups
  from the new daily rows.

### `src-tauri/src/pricing.rs`

Concrete numeric assertions to catch any future rate-card regressions:

- `prices_gpt_5_5_from_codex_rate_card` — 1M input + 200K cached + 100K
  output = `$7.10`.
- `prices_gpt_5_6_variants` — Sol / generic / Terra / Luna all match
  the rates in `pricing_notes`.
- `normalizes_dated_gpt_5_5_snapshot` — strips the `YYYY-MM-DD` suffix.

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
`updateDemoDatabasePath` so the "About" tab UI can be exercised end-to-end.

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
| Frontend DTOs (`src/dto`, `src/api`) | `npm run typecheck` |
| Anything end-to-end | `npm run desktop -- dev` (and try `?demo=1` for UI-only changes) |
| Release plumbing | trigger the release workflow via `workflow_dispatch` (or push a tag once confident) |