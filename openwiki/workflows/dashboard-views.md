---
type: Workflow
title: Dashboard Views and Tabs
description: How the overview, last-7-days, month-to-date, activity wall, daily detail, monthly history, and sync info views are rendered and what data each one shows.
tags: [workflow, ui, dashboard]
---

# Dashboard Views

The renderer is a single `AppTab` enum in `src/main.ts` plus an
`activeTab` state initialized from `?tab=...`:

```ts
type AppTab = "overview" | "monthlyHistory" | "monthlyDetail"
            | "syncInfo" | "dailyDetail";
```

The renderer is intentionally monolithic: every tab's markup is a function
on `state` that returns an HTML string, then a single `render()` writes it
into `#content`. This keeps the UI in one place at the cost of a large
`main.ts`.

```mermaid
flowchart TD
    Root([App boots]) --> Detect{detectInitialTab from ?tab}
    Detect --> Overview[Overview]
    Detect --> MonthlyHistory[Monthly history]
    Detect --> MonthlyDetail[Monthly detail]
    Detect --> DailyDetail[Daily detail]
    Detect --> SyncInfo[Sync info]

    Overview --> SyncBar[Sync preview + auto-sync mode]
    Overview --> Today[Today summary card]
    Overview --> Seven[Last 7 days summary card]
    Overview --> MTD[Month-to-date summary card]
    Overview --> History[Last 7 days daily history]
    Overview --> Activity[Past year activity wall]

    MonthlyHistory --> MonthlyTable[Monthly totals table by month + model]

    MonthlyDetail --> YearMonth[Year + month buttons]
    MonthlyDetail --> MonthQuery[query_daily_usage for month]

    DailyDetail --> DateRange[Date range inputs]
    DailyDetail --> DailyQuery[query_daily_usage for range]

    SyncInfo --> Meta[Codex dir, SQLite path, time zone, parse version]
    SyncInfo --> Pricing[Model pricing form (relay overrides)]
    SyncInfo --> Update[Updater check + install]
    SyncInfo --> Repo[Source repository link]
```

## Overview

Sources: `DashboardPayloadDTO.summaries` (today, last 7 days, month to date)
plus `dailyHistory` (last 7 days) and `activityHistory` (past year).

- Period bounds are computed by `UsageRepository::period_bounds` using
  `last_n_date_keys(now, tz, 1)` for "today" and `add_days_to_date_key` /
  `month_key_for` for the wider ranges.
- The last-7-days daily history uses `last_n_date_keys(..., 7)` and forces
  every date to appear in the output (empty days still show as `0`).
- The activity wall comes from `activity_history` (52 weeks + weekday
  alignment padding) and is bucketed into 5 intensity levels via
  `activityLevelThresholds` (25th / 50th / 75th percentile of non-zero
  total tokens).

Auto-sync UX lives here: `AUTO_SYNC_OPTIONS` (`manual`, `10s`, `30s`,
`1m`, `5m`, `10m`, `15m`, `30m`) drive `setTimeout` chains that call
`startSync(false)` once a cycle elapses. `nextAutoSyncAt` powers a
countdown string in the UI.

## Monthly history

Driven by `monthlyHistory` (descending `month_key`, derived from
`daily_usage` via `month_key = substr(usage_date, 1, 7)`). Each row sums
across `(model, is_fallback)` and is sorted by total tokens descending.

The frontend breaks out model rows under each month with both a tokens
column and a `modelCost` column that reads `totals.costUSD`. `totalCost`
is computed from the month row, not re-aggregated.

## Daily detail (`?tab=dailyDetail`)

User selects a start and end date (`initializeDailyDetailRange` defaults
to the start of the current month through today). Constraints:

- `MAX_DAILY_DETAIL_RANGE_DAYS = 93`
- `DAILY_DETAIL_PAGE_SIZE = 31` days per page

The renderer calls `queryDailyUsage(startDate, endDate)` →
`commands::query_daily_usage` → `UsageRepository::daily_history_between`,
which validates the range and walks `daily_usage` for the inclusive
`[lower, upper]` bounds.

## Monthly detail (`?tab=monthlyDetail`)

User picks a year, then one of `MONTH_BUTTON_VALUES` (1..12). The button
triggers a fresh `queryDailyUsage(year-month-01, year-month-last)`. The
backend path is the same as for daily detail; only the frontend framing
is different.

## Sync info (`?tab=syncInfo`)

Shows the persisted `DashboardMetaDTO` plus the in-app updater UX:

- Codex directory and SQLite path (read-only when `database_path_locked`
  is true because `CODEX_USAGE_DATABASE` is set).
- Time zone, parse version, pricing notes, and a model-pricing form
  (see [Model pricing](#model-pricing-set_model_pricing_settings) below).
- A "Sync now" button (re-uses the same `startSync` plumbing).
- An "Update" section that calls `checkForPendingAppUpdate()` (Tauri's
  `check()` from `tauri-plugin-updater`) and, on a hit, runs
  `installPendingAppUpdate(update, onProgress)` which downloads, installs,
  and `relaunch()`es the app.
- A "View source" link that invokes `openSourceRepository()` → the
  Rust command in `commands.rs` shells out to `open` / `cmd /C start` /
  `xdg-open` to point at `https://github.com/iohao/token-ledger`.

The settings file edit (changing the SQLite path) lives in this tab too;
`set_database_path` requires no active sync, returns a fresh
`DashboardPayloadDTO`, and writes the new path into
`${CODEX_HOME}/.tokenledger/settings.json`.

### Model pricing (`set_model_pricing_settings`)

Below the database-path form, the sync info tab renders one
`pricing-model-group` per relay model. Each group shows the model's
official rates (read-only reference) and four editable fields for the
user-supplied relay rates (input, output, cache read, cache creation —
all in USD per million tokens). A toggle labeled "Use relay pricing"
flips the `relayEnabled` boolean, which decides whether
`cost_for_with_overrides` uses the user's relay rates or the official
ones for that model. The four rate fields are bounded to non-negative
finite numbers; client-side validation in `validatePricingRate` and
server-side validation in `pricing::validate_pricing_overrides` enforce
the same rules, so a malformed draft surfaces an inline error before the
Tauri call.

A successful save calls `updateModelPricingSettings` (Tauri command
`set_model_pricing_settings`, declared in
`src-tauri/capabilities/default.json` as `allow-set-model-pricing-settings`)
and reapplies the resulting `DashboardPayloadDTO`, which immediately
re-prices every visible aggregate. A "Restore relay preset" button
rehydrates the draft from the hard-coded relay preset (see
[architecture/data-model.md](../architecture/data-model.md#relay-model-pricing-overrides))
so the user can revert manual edits without having to remember the
defaults. The i18n keys for this block live in
`src/i18n.ts` (`pricingSection`, `modelPricingTitle`, `modelPricingHint`,
`useRelayPricing`, `relayPricingActive`, `officialPricingActive`,
`savePricing`, `restoreRelayPreset`, `cacheCreationAvailabilityNote`,
`pricingRequiredError`, `pricingInvalidError`,
`pricingValidationError`, `pricingSaved`).

## Demo mode

When the URL contains `?demo=1`, every command in `src/api/tauri.ts` is
short-circuited to a fabricated `DashboardPayloadDTO` from
`src/api/demo.ts`. The demo includes a 365+ day activity wall synthesized
in `buildDemoActivityHistory`, fake period summaries, and a fixed
`SyncStatus` so the entire UI can be exercised without touching real
Codex data.

Demo toggles:

- `updateDemoDatabasePath(path)` / `resetDemoDatabasePath()` keep the demo
  payload consistent with edits made in the sync info tab.
- `updateDemoModelPricingSettings(settings)` keeps the synthesized
  `DashboardMeta.model_pricing_settings` consistent with edits made in
  the model-pricing form, so the same UI can be exercised in
  `?demo=1&tab=syncInfo` without a real Codex install.

## Theme and locale

- Locale is chosen by `detectInitialLocale()` (checks `localStorage`,
  `navigator.language`, falls back to `zh-CN`), persisted as
  `tokenledger.locale`, and applied by `applyTheme` /
  `setTheme`. The two supported locales are `zh-CN` and `en-US`
  (`src/i18n.ts`).
- Theme follows `prefers-color-scheme` unless `tokenledger.theme` is set
  in `localStorage`. `[data-theme="light"]` overrides the default dark
  palette in `src/styles.css`.