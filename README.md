# TokenLedger

[中文说明](./README_CN.md)

`TokenLedger` is a Tauri-based desktop dashboard that reads Codex session data and tracks token and cost trends.

## Features

- **Data Parsing**: Reads Codex session data from `CODEX_HOME/sessions/*.jsonl`.
- **Local Storage**: Writes aggregated usage into a local SQLite database (default path: `CODEX_HOME/.codex-usage/usage.sqlite`).
- **Multi-dimensional Views**: Browse token and cost trends across today, the last 7 days, month-to-date, daily, and monthly views.
- **In-App Updates**: Checks GitHub Releases for new versions and installs updates in-place.
- **i18n**: Built-in support for English and Chinese.

## Quick Start

### Run the desktop app

```bash
npm ci
npm run desktop -- dev
```

### Preview the frontend only

```bash
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/?demo=1` to preview the UI with demo data.  
You can also open a specific view directly with `tab`:
- `?demo=1&tab=overview`
- `?demo=1&tab=monthlyHistory`
- `?demo=1&tab=monthlyDetail`
- `?demo=1&tab=dailyDetail`

### Checks and tests

```bash
npm run typecheck
cd src-tauri && cargo test
```

### Package the desktop app

```bash
npm run package:app
```
Packaged runnable artifacts are copied into `release-app/` by default.

## Project Structure

```text
src/             Frontend UI, i18n, DTOs, and Tauri API bridge (Vite + TypeScript)
src-tauri/       Rust backend, commands, SQLite, and Tauri config
scripts/         Packaging and comparison helpers
release-app/     Output directory for packaged apps
```
