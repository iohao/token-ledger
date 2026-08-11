---
type: SourceMap
title: Annotated Source Tree
description: A guided tour of the TokenLedger repository tree, noting what each top-level directory and notable file does and where to start reading.
tags: [source-map, navigation]
---

# Annotated Source Tree

This page is a navigation aid. Use it when you want to know "what lives
here?" without diving into a long-form page. Each entry links to the file
in the repository (no host paths).

```
/
├── AGENTS.md              Repository conventions + OpenWiki pointer
├── CLAUDE.md              OpenWiki pointer (mirrors AGENTS.md)
├── README.md              English overview + quickstart commands
├── README_CN.md           Simplified Chinese mirror of README.md
├── LICENSE                Project license
├── index.html             Vite entry; mounts <div id="root"> and /src/main.ts
├── package.json           Node deps (Tauri 2.x), npm scripts, Node >=25
├── package-lock.json      npm lockfile
├── tsconfig.json          TypeScript config (strict, noEmit, ES2022)
├── vite.config.ts         Vite dev server config (port 25174, no src-tauri watch)
│
├── src/                   Frontend (Vite + TypeScript)
│   ├── main.ts            Single-file UI renderer, sync loop, updater UX
│   ├── styles.css         All styles including [data-theme="light|dark"]
│   ├── i18n.ts            zh-CN / en-US message dictionaries, locale persistence
│   ├── vite-env.d.ts      Vite ambient types
│   ├── api/
│   │   ├── tauri.ts       invoke<T>("...") wrappers + demo-mode fallbacks
│   │   ├── updater.ts     check(), downloadAndInstall(), relaunch() helpers
│   │   └── demo.ts        In-memory DashboardPayloadDTO for ?demo=1
│   └── dto/
│       └── dashboard.ts   TypeScript mirror of Rust models in src-tauri/src/models.rs
│
├── src-tauri/             Backend (Rust + Tauri)
│   ├── Cargo.toml         Crate metadata (name=tokenledger), Cargo deps
│   ├── Cargo.lock         Resolved lockfile (regenerated on dep bumps)
│   ├── build.rs           Calls tauri_build::build()
│   ├── tauri.conf.json    Tauri config: productName, version, identifier, plugins
│   ├── tauri.release.conf.json   Release-only override (currently minimal)
│   ├── capabilities/
│   │   └── default.json   Whitelist of Tauri permissions for the main window
│   ├── gen/               Generated schemas (gitignored)
│   ├── icons/             App bundle icons (.icns, .ico, .png sizes)
│   ├── permissions/       Per-command ACL (currently empty/default)
│   ├── target/            Cargo build artifacts (gitignored)
│   └── src/
│       ├── main.rs        Binary entry; registers plugins + invoke_handler list
│       ├── lib.rs         Public module declarations
│       ├── app_state.rs   AppState, settings, sync guard, preview cache, tests
│       ├── commands.rs    13 #[tauri::command] entry points
│       ├── models.rs      DTOs that cross the Tauri boundary + helpers
│       ├── parser.rs      Streaming JSONL parser + tests
│       ├── repository.rs  Sync orchestrator + tests
│       ├── store.rs       SQLite wrapper (migrate, replace_session_file, ...)
│       ├── pricing.rs     Model normalize, rate card, relay overrides, validation + tests
│       ├── date_keys.rs   TZ-aware date key math (last_n, add_days, month_key)
│       └── bin/
│           └── export_dashboard.rs   CLI: dumps DashboardPayloadDTO as JSON
│
├── scripts/               Build/release helpers
│   ├── package-app.sh     Local macOS packaging into release-app/
│   ├── build-updater-manifest.mjs   Merge platform fragments into latest.json
│   └── compare-ts-rust.mjs          Legacy parity check vs the old TS server
│
├── .github/
│   └── workflows/
│       ├── desktop-ci.yml        PR / main / dispatch build verification
│       ├── release.yml           Tag-driven release + updater manifest publish
│       └── openwiki-update.yml   Scheduled OpenWiki doc refresh
│
├── skills/                OpenWiki self-hosted skills (mermaid, write-connector)
│
├── openwiki/              This wiki (generated)
│   ├── INSTRUCTIONS.md    Brief (do not edit during normal runs)
│   └── quickstart.md + section pages
│
├── local/                 Local-only secrets and overrides (gitignored)
│   ├── tauri-updater.key      Local minisign key (loaded by package-app.sh)
│   └── tauri-updater.key.pub  Matching public key (also embedded in tauri.conf.json)
│
├── dist/                  Vite build output (gitignored)
├── release-app/           Default output of npm run package:app (gitignored)
└── node_modules/          npm install (gitignored)
```

## Where to start reading

- **New to the project** → `src-tauri/src/parser.rs` (smallest end-to-end
  surface), then `src-tauri/src/repository.rs` (the orchestrator).
- **Touching the UI** → `src/main.ts` (start by `Cmd-F` for the tab you
  care about) and `src/i18n.ts`.
- **Touching the data layer** → `src-tauri/src/store.rs` migrations and
  `src-tauri/src/repository.rs` for how migrations trigger rescans.
- **Touching the release flow** → `scripts/build-updater-manifest.mjs`,
  then `.github/workflows/release.yml`.
- **Touching the demo** → `src/api/demo.ts` for synthesized data and
  `src/api/tauri.ts` for the gating logic.

## Generated / gitignored directories

- `dist/`, `release-app/`, `src-tauri/target/`, `src-tauri/gen/`,
  `node_modules/`, `local/`. Never commit or document their internals.
- `src-tauri/gen/` contains Tauri-generated ACLs that are rewritten by
  the build.
- `src-tauri/permissions/` is currently empty; per-command ACL is
  generated from `capabilities/default.json`.