use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension, Row};

use crate::models::{
    empty_sync_context, format_utc_timestamp, idle_sync_status, ParsedSessionFile,
    SourceSessionRecord, StoredDailyAggregate, StoredMonthlyAggregate, SyncContext, SyncStatus,
    UsageTotals,
};

pub struct UsageStore {
    database_path: PathBuf,
    connection: Connection,
}

impl UsageStore {
    pub fn new(database_path: &Path) -> Result<Self> {
        let database_path = database_path.to_path_buf();
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create database directory {}", parent.display())
            })?;
        }

        let connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .with_context(|| format!("failed to open sqlite database {}", database_path.display()))?;

        let store = Self {
            database_path,
            connection,
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn migrate(&self) -> Result<()> {
        self.connection
            .execute_batch(
                "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS source_sessions (
          session_id TEXT PRIMARY KEY,
          relative_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          modified_at TEXT NOT NULL,
          parse_version INTEGER NOT NULL,
          last_synced_at TEXT NOT NULL,
          latest_usage_at TEXT
        );

        CREATE TABLE IF NOT EXISTS session_daily_usage (
          session_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          model TEXT NOT NULL,
          is_fallback INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          cached_input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          reasoning_output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          PRIMARY KEY (session_id, usage_date, model, is_fallback)
        );

        CREATE INDEX IF NOT EXISTS idx_session_daily_usage_date ON session_daily_usage (usage_date);

        CREATE TABLE IF NOT EXISTS daily_usage (
          usage_date TEXT NOT NULL,
          model TEXT NOT NULL,
          is_fallback INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          cached_input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          reasoning_output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          PRIMARY KEY (usage_date, model, is_fallback)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage (usage_date);

        CREATE TABLE IF NOT EXISTS monthly_usage (
          month_key TEXT NOT NULL,
          model TEXT NOT NULL,
          is_fallback INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          cached_input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          reasoning_output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          PRIMARY KEY (month_key, model, is_fallback)
        );

        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        ",
            )
            .context("failed to run sqlite migrations")
    }

    pub fn reset_cache(&self) -> Result<()> {
        self.with_transaction(|connection| {
            connection.execute("DELETE FROM session_daily_usage", [])?;
            connection.execute("DELETE FROM source_sessions", [])?;
            connection.execute("DELETE FROM daily_usage", [])?;
            connection.execute("DELETE FROM monthly_usage", [])?;
            Ok(())
        })
    }

    pub fn load_sync_status(&self) -> Result<SyncStatus> {
        let raw_value = self
            .connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = 'sync_status'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("failed to query sync status")?;

        match raw_value {
            Some(value) => {
                Ok(serde_json::from_str::<SyncStatus>(&value)
                    .unwrap_or_else(|_| idle_sync_status()))
            }
            None => Ok(idle_sync_status()),
        }
    }

    pub fn save_sync_status(&self, status: &SyncStatus) -> Result<()> {
        let value = serde_json::to_string(status).context("failed to serialize sync status")?;
        self.connection
            .execute(
                "
        INSERT INTO sync_state (key, value)
        VALUES ('sync_status', ?1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ",
                [value],
            )
            .context("failed to save sync status")?;
        Ok(())
    }

    pub fn load_sync_context(&self) -> Result<SyncContext> {
        let raw_value = self
            .connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = 'sync_context'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("failed to query sync context")?;

        match raw_value {
            Some(value) => Ok(serde_json::from_str::<SyncContext>(&value)
                .unwrap_or_else(|_| empty_sync_context())),
            None => Ok(empty_sync_context()),
        }
    }

    pub fn save_sync_context(&self, context: &SyncContext) -> Result<()> {
        let value = serde_json::to_string(context).context("failed to serialize sync context")?;
        self.connection
            .execute(
                "
        INSERT INTO sync_state (key, value)
        VALUES ('sync_context', ?1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ",
                [value],
            )
            .context("failed to save sync context")?;
        Ok(())
    }

    pub fn load_source_sessions(&self) -> Result<HashMap<String, SourceSessionRecord>> {
        let mut statement = self
            .connection
            .prepare(
                "
        SELECT session_id, relative_path, file_size, modified_at, parse_version
        FROM source_sessions
        ",
            )
            .context("failed to prepare source_sessions query")?;

        let rows = statement
            .query_map([], |row| {
                Ok(SourceSessionRecord {
                    session_id: row.get("session_id")?,
                    relative_path: row.get("relative_path")?,
                    file_size: row.get("file_size")?,
                    modified_at: row.get("modified_at")?,
                    parse_version: row.get("parse_version")?,
                })
            })
            .context("failed to query source_sessions")?;

        let mut records = HashMap::new();
        for row in rows {
            let record = row.context("failed to map source_sessions row")?;
            records.insert(record.session_id.clone(), record);
        }

        Ok(records)
    }

    pub fn list_date_keys_for_sessions(&self, session_ids: &[String]) -> Result<Vec<String>> {
        if session_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut date_keys = HashSet::new();
        for chunk in session_ids.chunks(500) {
            let placeholders = (1..=chunk.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "
        SELECT DISTINCT usage_date
        FROM session_daily_usage
        WHERE session_id IN ({placeholders})
        ORDER BY usage_date ASC
        "
            );
            let mut statement = self
                .connection
                .prepare(&query)
                .context("failed to prepare session date-key query")?;
            let rows = statement
                .query_map(params_from_iter(chunk.iter()), |row| {
                    row.get::<_, String>(0)
                })
                .context("failed to query date keys for session batch")?;

            for row in rows {
                date_keys.insert(row.context("failed to read usage_date")?);
            }
        }

        let mut values = date_keys.into_iter().collect::<Vec<_>>();
        values.sort();
        Ok(values)
    }

    pub fn replace_session_file(
        &self,
        parsed_file: &ParsedSessionFile,
        parse_version: i32,
        synced_at: DateTime<Utc>,
    ) -> Result<()> {
        self.with_transaction(|connection| {
            connection.execute(
                "DELETE FROM session_daily_usage WHERE session_id = ?1",
                [&parsed_file.session_id],
            )?;

            let mut insert_usage = connection.prepare(
                "
        INSERT INTO session_daily_usage (
          session_id,
          relative_path,
          usage_date,
          model,
          is_fallback,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ",
            )?;

            for usage in &parsed_file.usages {
                insert_usage.execute(params![
                    &usage.session_id,
                    &usage.relative_path,
                    &usage.date_key,
                    &usage.model,
                    if usage.is_fallback { 1 } else { 0 },
                    usage.totals.input_tokens,
                    usage.totals.cached_input_tokens,
                    usage.totals.output_tokens,
                    usage.totals.reasoning_output_tokens,
                    usage.totals.total_tokens,
                    usage.totals.cost_usd,
                ])?;
            }

            connection.execute(
                "
        INSERT INTO source_sessions (
          session_id,
          relative_path,
          file_size,
          modified_at,
          parse_version,
          last_synced_at,
          latest_usage_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(session_id) DO UPDATE SET
          relative_path = excluded.relative_path,
          file_size = excluded.file_size,
          modified_at = excluded.modified_at,
          parse_version = excluded.parse_version,
          last_synced_at = excluded.last_synced_at,
          latest_usage_at = excluded.latest_usage_at
        ",
                params![
                    &parsed_file.session_id,
                    &parsed_file.relative_path,
                    parsed_file.file_size,
                    format_utc_timestamp(parsed_file.modified_at),
                    parse_version,
                    format_utc_timestamp(synced_at),
                    parsed_file
                        .latest_usage_at
                        .as_ref()
                        .map(|value| format_utc_timestamp(*value)),
                ],
            )?;

            Ok(())
        })
    }

    pub fn delete_sessions(&self, session_ids: &[String]) -> Result<()> {
        if session_ids.is_empty() {
            return Ok(());
        }

        self.with_transaction(|connection| {
            let mut delete_usage =
                connection.prepare("DELETE FROM session_daily_usage WHERE session_id = ?1")?;
            let mut delete_source =
                connection.prepare("DELETE FROM source_sessions WHERE session_id = ?1")?;

            for session_id in session_ids {
                delete_usage.execute([session_id])?;
                delete_source.execute([session_id])?;
            }

            Ok(())
        })
    }

    pub fn rebuild_aggregates_for_date_keys(&self, date_keys: &[String]) -> Result<()> {
        let mut normalized_dates = date_keys
            .iter()
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        normalized_dates.sort();
        if normalized_dates.is_empty() {
            return Ok(());
        }

        let month_keys = normalized_dates
            .iter()
            .map(|date_key| date_key[..7].to_string())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();

        self.with_transaction(|connection| {
            let mut delete_daily =
                connection.prepare("DELETE FROM daily_usage WHERE usage_date = ?1")?;
            let mut insert_daily = connection.prepare(
                "
        INSERT INTO daily_usage (
          usage_date,
          model,
          is_fallback,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd
        )
        SELECT
          usage_date,
          model,
          is_fallback,
          SUM(input_tokens),
          SUM(cached_input_tokens),
          SUM(output_tokens),
          SUM(reasoning_output_tokens),
          SUM(total_tokens),
          SUM(cost_usd)
        FROM session_daily_usage
        WHERE usage_date = ?1
        GROUP BY usage_date, model, is_fallback
        ",
            )?;

            for date_key in &normalized_dates {
                delete_daily.execute([date_key])?;
                insert_daily.execute([date_key])?;
            }

            let mut delete_monthly =
                connection.prepare("DELETE FROM monthly_usage WHERE month_key = ?1")?;
            let mut insert_monthly = connection.prepare(
                "
        INSERT INTO monthly_usage (
          month_key,
          model,
          is_fallback,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd
        )
        SELECT
          substr(usage_date, 1, 7) AS month_key,
          model,
          is_fallback,
          SUM(input_tokens),
          SUM(cached_input_tokens),
          SUM(output_tokens),
          SUM(reasoning_output_tokens),
          SUM(total_tokens),
          SUM(cost_usd)
        FROM daily_usage
        WHERE substr(usage_date, 1, 7) = ?1
        GROUP BY month_key, model, is_fallback
        ",
            )?;

            for month_key in &month_keys {
                delete_monthly.execute([month_key])?;
                insert_monthly.execute([month_key])?;
            }

            Ok(())
        })
    }

    pub fn list_daily_rows_between(
        &self,
        lower_bound: &str,
        upper_bound: &str,
    ) -> Result<Vec<StoredDailyAggregate>> {
        let mut statement = self
            .connection
            .prepare(
                "
        SELECT
          usage_date,
          model,
          is_fallback,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd
        FROM daily_usage
        WHERE usage_date >= ?1 AND usage_date <= ?2
        ORDER BY usage_date DESC, total_tokens DESC, model ASC
        ",
            )
            .context("failed to prepare daily_usage query")?;

        let rows = statement
            .query_map([lower_bound, upper_bound], map_daily_row)
            .context("failed to query daily_usage")?;

        let mut values = Vec::new();
        for row in rows {
            values.push(row.context("failed to map daily_usage row")?);
        }

        Ok(values)
    }

    pub fn list_monthly_rows(&self) -> Result<Vec<StoredMonthlyAggregate>> {
        let mut statement = self
            .connection
            .prepare(
                "
        SELECT
          month_key,
          model,
          is_fallback,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd
        FROM monthly_usage
        ORDER BY month_key DESC, total_tokens DESC, model ASC
        ",
            )
            .context("failed to prepare monthly_usage query")?;

        let rows = statement
            .query_map([], map_monthly_row)
            .context("failed to query monthly_usage")?;

        let mut values = Vec::new();
        for row in rows {
            values.push(row.context("failed to map monthly_usage row")?);
        }

        Ok(values)
    }

    pub fn latest_source_usage_at(&self) -> Result<Option<DateTime<Utc>>> {
        let raw_value = self
            .connection
            .query_row(
                "SELECT MAX(latest_usage_at) AS latest_usage_at FROM source_sessions",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .context("failed to query latest source usage timestamp")?;

        Ok(raw_value
            .flatten()
            .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
            .map(|value| value.with_timezone(&Utc)))
    }

    fn with_transaction<T, F>(&self, work: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        self.connection
            .execute_batch("BEGIN IMMEDIATE")
            .context("failed to begin transaction")?;
        match work(&self.connection) {
            Ok(value) => {
                self.connection
                    .execute_batch("COMMIT")
                    .context("failed to commit transaction")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}

fn map_totals(row: &Row<'_>) -> rusqlite::Result<UsageTotals> {
    Ok(UsageTotals {
        input_tokens: row.get("input_tokens")?,
        cached_input_tokens: row.get("cached_input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        reasoning_output_tokens: row.get("reasoning_output_tokens")?,
        total_tokens: row.get("total_tokens")?,
        cost_usd: row.get("cost_usd")?,
    })
}

fn map_daily_row(row: &Row<'_>) -> rusqlite::Result<StoredDailyAggregate> {
    Ok(StoredDailyAggregate {
        date_key: row.get("usage_date")?,
        model: row.get("model")?,
        is_fallback: row.get::<_, i64>("is_fallback")? == 1,
        totals: map_totals(row)?,
    })
}

fn map_monthly_row(row: &Row<'_>) -> rusqlite::Result<StoredMonthlyAggregate> {
    Ok(StoredMonthlyAggregate {
        month_key: row.get("month_key")?,
        model: row.get("model")?,
        is_fallback: row.get::<_, i64>("is_fallback")? == 1,
        totals: map_totals(row)?,
    })
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use tempfile::TempDir;

    use super::UsageStore;
    use crate::models::{
        ParsedSessionFile, SyncContext, SyncCoverageGranularity, SyncDataSource, SyncState,
        SyncStatus, UsageTotals,
    };

    fn make_store() -> (TempDir, UsageStore) {
        let temp_dir = TempDir::new().expect("temp dir");
        let database_path = temp_dir.path().join("usage.sqlite");
        let store = UsageStore::new(&database_path).expect("create store");
        (temp_dir, store)
    }

    #[test]
    fn sync_status_and_context_roundtrip() {
        let (_temp_dir, store) = make_store();
        let status = SyncStatus {
            state: SyncState::Success,
            last_synced_at: Some("2026-04-09T15:52:18.470Z".to_string()),
            error_message: None,
            coverage_through: Some("2026-04-09T15:51:00.000Z".to_string()),
            coverage_granularity: Some(SyncCoverageGranularity::Minute),
            scanned_files: 12,
            session_count: 3,
            data_source: Some(SyncDataSource::JsonlDirect),
        };
        let context = SyncContext {
            codex_home_path: Some("/tmp/.codex".to_string()),
            time_zone: Some("Asia/Shanghai".to_string()),
            parse_version: Some(4),
        };

        store.save_sync_status(&status).expect("save status");
        store.save_sync_context(&context).expect("save context");

        assert_eq!(
            store.load_sync_status().expect("load status").scanned_files,
            12
        );
        assert_eq!(
            store
                .load_sync_context()
                .expect("load context")
                .codex_home_path
                .as_deref(),
            Some("/tmp/.codex")
        );
    }

    #[test]
    fn replaces_session_and_rebuilds_daily_and_monthly_aggregates() {
        let (_temp_dir, store) = make_store();
        let synced_at = Utc
            .with_ymd_and_hms(2026, 4, 9, 16, 0, 0)
            .single()
            .expect("timestamp");
        let parsed_file = ParsedSessionFile {
            session_id: "session-a".to_string(),
            relative_path: "2026/04/09/session-a.jsonl".to_string(),
            file_size: 123,
            modified_at: synced_at,
            latest_usage_at: Some(synced_at),
            usages: vec![
                crate::models::DailySessionModelUsage {
                    session_id: "session-a".to_string(),
                    relative_path: "2026/04/09/session-a.jsonl".to_string(),
                    date_key: "2026-04-09".to_string(),
                    model: "gpt-5.4".to_string(),
                    is_fallback: false,
                    totals: UsageTotals {
                        input_tokens: 100,
                        cached_input_tokens: 20,
                        output_tokens: 10,
                        reasoning_output_tokens: 5,
                        total_tokens: 110,
                        cost_usd: 1.5,
                    },
                },
                crate::models::DailySessionModelUsage {
                    session_id: "session-a".to_string(),
                    relative_path: "2026/04/09/session-a.jsonl".to_string(),
                    date_key: "2026-04-10".to_string(),
                    model: "gpt-5.4".to_string(),
                    is_fallback: false,
                    totals: UsageTotals {
                        input_tokens: 50,
                        cached_input_tokens: 5,
                        output_tokens: 8,
                        reasoning_output_tokens: 1,
                        total_tokens: 58,
                        cost_usd: 0.8,
                    },
                },
            ],
        };

        store
            .replace_session_file(&parsed_file, 4, synced_at)
            .expect("replace session");
        store
            .rebuild_aggregates_for_date_keys(&["2026-04-09".to_string(), "2026-04-10".to_string()])
            .expect("rebuild aggregates");

        let daily = store
            .list_daily_rows_between("2026-04-09", "2026-04-10")
            .expect("list daily");
        let monthly = store.list_monthly_rows().expect("list monthly");

        assert_eq!(daily.len(), 2);
        assert_eq!(daily[0].date_key, "2026-04-10");
        assert_eq!(daily[1].date_key, "2026-04-09");
        assert_eq!(monthly.len(), 1);
        assert_eq!(monthly[0].month_key, "2026-04");
        assert_eq!(monthly[0].totals.total_tokens, 168);
        assert_eq!(
            store
                .list_date_keys_for_sessions(&["session-a".to_string()])
                .expect("date keys"),
            vec!["2026-04-09".to_string(), "2026-04-10".to_string()]
        );
    }
}
