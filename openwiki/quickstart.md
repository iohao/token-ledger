---
type: Quickstart
title: TokenLedger Quickstart
description: Entry point for the TokenLedger wiki. Describes what the desktop app does, where the code lives, how to run it, and which wiki pages to read next.
tags: [quickstart, overview]
---

# TokenLedger Wiki

`TokenLedger` is a Tauri-based desktop dashboard that ingests Codex session data
(`CODEX_HOME/sessions/*.jsonl`), aggregates token and cost usage into a local
SQLite database, and renders multi-period usage views. It is bilingual
(English and Simplified Chinese) and ships with an in-app updater that pulls
new bundles from GitHub Releases.

- Repository: `iohao/token-ledger`
- Identifier: `me.ionet.tokenledger`
- Current version: `0.4.4` (see `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`)
- Node engine: `>=25` (Tauri CLI dev workflow)

## What the app actually does

1. Scans Codex session files under `${CODEX_HOME}/sessions/*.jsonl`.
2. Streams each line, picks out `turn_context` (model hints) and `event_msg`
   with `payload.type == "token_count"` (cumulative and per-event usage),
   then derives the per-event delta.
3. Aggregates per `(date_key, model, is_fallback)` in SQLite, then rebuilds
   daily and monthly rollups for any affected date keys.
4. Exposes the aggregates to a Vite/TypeScript single-page UI through twelve
   Tauri commands and a `sync-progress` event stream.
5. Optionally checks for new GitHub releases on launch and installs them
   in-place via `tauri-plugin-updater`.

## Run it

```bash
npm ci                                # install Node + Tauri CLI deps
npm run desktop -- dev                # launch the full desktop app
npm run dev -- --host 127.0.0.1       # frontend only, demo data via ?demo=1
npm run typecheck                     # frontend type check used in CI
cd src-tauri && cargo test            # Rust unit tests
npm run package:app                   # macOS bundle copied to release-app/
```

## Where to go next

| Want to read about… | Start with |
|---|---|
| How the desktop runtime fits together | [architecture/overview.md](architecture/overview.md) |
| SQLite schema, JSONL shape, pricing table | [architecture/data-model.md](architecture/data-model.md) |
| Scan, sync, progress phases, dirty detection | [workflows/sync.md](workflows/sync.md) |
| Tabs, render tree, activity wall, auto-sync | [workflows/dashboard-views.md](workflows/dashboard-views.md) |
| Packaging script, release workflow, updater endpoints | [operations/release-and-package.md](operations/release-and-package.md) |
| Rust unit tests, compare-ts-rust script, CI | [testing.md](testing.md) |
| Annotated directory tree | [source-map.md](source-map.md) |

## Source code top-level layout

```
src/             Vite + TypeScript UI, DTOs, i18n, Tauri bridge
src-tauri/       Rust backend: commands, AppState, parser, repository, store
scripts/         Package-app, updater manifest, ts-vs-rust comparator
release-app/     Default output of `npm run package:app` (gitignored)
dist/            Vite frontend bundle output (gitignored)
src-tauri/target/, src-tauri/gen/  Rust build artifacts (gitignored)
```

See [source-map.md](source-map.md) for an annotated directory map.

## Where to change common things

- **Add a model / adjust prices** → [architecture/data-model.md](architecture/data-model.md)
  and `src-tauri/src/pricing.rs`.
- **Add a new dashboard view** → [workflows/dashboard-views.md](workflows/dashboard-views.md)
  and `src/main.ts` (`AppTab`, `state.activeTab`, render branches).
- **Add a new Tauri command** → [architecture/overview.md](architecture/overview.md)
  (register in `src-tauri/src/main.rs` and `src-tauri/capabilities/default.json`).
- **Bump the app version** → [operations/release-and-package.md](operations/release-and-package.md).
- **Tweak sync semantics** (dirty detection, full rescan triggers) →
  [workflows/sync.md](workflows/sync.md).
- **Change the in-app updater endpoints** → [operations/release-and-package.md](operations/release-and-package.md).

## Backlog

- Detailed mapping of every UI string in `src/main.ts` to its i18n key is
  deferred; start with `src/i18n.ts` and grep for `t(state.locale, "…")`.
- The `scripts/compare-ts-rust.mjs` helper still references a TypeScript
  baseline at `/Users/join/gitme/ionet_me/codexUsageTs`. Documented as a
  historical comparison tool; future agents should re-point it before reuse.
- Per-platform notarization/signing notes beyond the macOS caveat in
  `AGENTS.md`; only the existing AGENTS.md wording is surfaced today.