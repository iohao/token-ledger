# Files

- [Dashboard Views and Tabs](dashboard-views.md) - How the overview, last-7-days, month-to-date, activity wall, daily detail, monthly history, and sync info views are rendered and what data each one shows.
- [Sync Lifecycle, JSONL Parsing, and Pricing](sync.md) - How TokenLedger scans Codex JSONL sessions, decides what is dirty, parses, writes SQLite, rebuilds aggregates, streams progress back to the UI, and applies the per-model pricing table.
