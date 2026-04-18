use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use walkdir::WalkDir;

use crate::date_keys::{add_days_to_date_key, last_n_date_keys, month_key_for};
use crate::models::{
    add_usage_totals, empty_usage_totals, format_utc_timestamp, sort_breakdowns, usage_periods,
    DailyUsageSummary, DashboardMeta, DashboardPayload, DatabasePathSource, ModelUsageBreakdown,
    MonthlyUsageSummary, ParsedSessionFile, SourceSessionRecord, StoredDailyAggregate,
    StoredMonthlyAggregate, SyncContext, SyncCoverageGranularity, SyncDataSource, SyncPreview,
    SyncProgress, SyncProgressPhase, SyncState, SyncStatus, UsagePeriod, UsageSummary,
};
use crate::parser::parse_session_file;
use crate::pricing::pricing_notes;
use crate::store::UsageStore;

pub struct UsageRepository {
    pub codex_home_path: PathBuf,
    pub database_path: PathBuf,
    pub time_zone: String,
    pub parse_version: i32,
    store: UsageStore,
}

pub struct UsageRepositoryConfig {
    pub codex_home_path: PathBuf,
    pub database_path: PathBuf,
    pub time_zone: String,
    pub parse_version: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionFileEntry {
    pub session_id: String,
    pub file_path: PathBuf,
    pub relative_path: String,
    pub file_size: i64,
    pub modified_at: DateTime<Utc>,
}

impl UsageRepository {
    pub fn new(config: UsageRepositoryConfig) -> Result<Self> {
        let store = UsageStore::new(&config.database_path)?;

        Ok(Self {
            codex_home_path: config.codex_home_path,
            database_path: store.database_path().to_path_buf(),
            time_zone: config.time_zone,
            parse_version: config.parse_version,
            store,
        })
    }

    pub fn build_dashboard_meta(&self) -> DashboardMeta {
        DashboardMeta {
            codex_home_path: self.codex_home_path.display().to_string(),
            database_path: self.database_path.display().to_string(),
            database_path_source: DatabasePathSource::Default,
            database_path_editable: true,
            time_zone: self.time_zone.clone(),
            parse_version: self.parse_version,
            pricing_notes: pricing_notes(),
        }
    }

    pub fn build_dashboard_payload(&self, include_sync_preview: bool) -> Result<DashboardPayload> {
        let status = self.current_sync_status()?;

        Ok(DashboardPayload {
            meta: self.build_dashboard_meta(),
            status: status.clone(),
            sync_preview: if include_sync_preview {
                Some(self.sync_preview()?)
            } else {
                None
            },
            summaries: usage_periods()
                .into_iter()
                .map(|period| self.summary_with_status(period, &status))
                .collect::<Result<Vec<_>>>()?,
            daily_history: self.last_7_day_history_with_status(&status)?,
            activity_history: self.activity_history_with_status(&status)?,
            monthly_history: self.monthly_history_with_status(&status)?,
            now: format_utc_timestamp(Utc::now()),
        })
    }

    pub fn current_sync_status(&self) -> Result<SyncStatus> {
        self.store.load_sync_status()
    }

    pub fn daily_history_between(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyUsageSummary>> {
        let status = self.current_sync_status()?;
        let (lower_bound, upper_bound) = validated_date_range(start_date, end_date)?;
        let keys = date_keys_descending_between(&lower_bound, &upper_bound)?;
        self.daily_history_for_keys_with_status(&keys, &status)
    }

    pub fn sync_and_build_dashboard(&self, force_full_rescan: bool) -> Result<DashboardPayload> {
        let status = self.sync(force_full_rescan)?;
        let total_session_files = status.scanned_files.max(0) as usize;
        let mut payload = self.build_dashboard_payload(false)?;
        payload.status = status;
        payload.sync_preview = Some(SyncPreview {
            needs_sync: false,
            new_sessions: 0,
            changed_sessions: 0,
            removed_sessions: 0,
            total_tracked_sessions: total_session_files,
            total_session_files,
        });
        Ok(payload)
    }

    pub fn sync_preview(&self) -> Result<SyncPreview> {
        let entries = self.scan_session_files_snapshot()?;
        self.sync_preview_from_entries(&entries)
    }

    pub(crate) fn sync_preview_from_entries(
        &self,
        entries: &[SessionFileEntry],
    ) -> Result<SyncPreview> {
        let requires_rescan = self.requires_full_rescan()?;
        self.compute_sync_preview_from_entries(entries, requires_rescan)
    }

    pub fn sync(&self, force_full_rescan: bool) -> Result<SyncStatus> {
        self.sync_with_progress(force_full_rescan, |_| {})
    }

    pub fn sync_with_progress<F>(
        &self,
        force_full_rescan: bool,
        on_progress: F,
    ) -> Result<SyncStatus>
    where
        F: FnMut(SyncProgress),
    {
        self.sync_with_progress_from_entries(force_full_rescan, None, on_progress)
    }

    pub(crate) fn sync_with_progress_from_entries<F>(
        &self,
        force_full_rescan: bool,
        scanned_entries: Option<Vec<SessionFileEntry>>,
        mut on_progress: F,
    ) -> Result<SyncStatus>
    where
        F: FnMut(SyncProgress),
    {
        let previous_status = self.current_sync_status()?;
        let requires_rescan = force_full_rescan || self.requires_full_rescan()?;
        let mut last_progress = SyncProgress {
            phase: SyncProgressPhase::Preparing,
            total_session_files: 0,
            files_to_process: 0,
            processed_files: 0,
            removed_sessions: 0,
            new_sessions: 0,
            changed_sessions: 0,
            error_message: None,
        };
        on_progress(last_progress.clone());
        let mut publish_progress = |progress: SyncProgress| {
            last_progress = progress.clone();
            on_progress(progress);
        };
        let syncing_status = SyncStatus {
            state: SyncState::Syncing,
            error_message: None,
            ..previous_status.clone()
        };
        self.store.save_sync_status(&syncing_status)?;

        let now = Utc::now();
        let result =
            self.perform_sync(requires_rescan, now, scanned_entries, &mut publish_progress);
        drop(publish_progress);

        match result {
            Ok(status) => {
                self.store.save_sync_status(&status)?;
                let complete_progress = SyncProgress {
                    phase: SyncProgressPhase::Complete,
                    error_message: None,
                    ..last_progress.clone()
                };
                on_progress(complete_progress);
                Ok(status)
            }
            Err(error) => {
                let failed_status = SyncStatus {
                    state: SyncState::Failed,
                    error_message: Some(error.to_string()),
                    ..previous_status
                };
                self.store.save_sync_status(&failed_status)?;
                let failed_progress = SyncProgress {
                    phase: SyncProgressPhase::Failed,
                    error_message: Some(error.to_string()),
                    ..last_progress.clone()
                };
                on_progress(failed_progress);
                Err(error)
            }
        }
    }

    fn perform_sync<F>(
        &self,
        requires_rescan: bool,
        now: DateTime<Utc>,
        scanned_entries: Option<Vec<SessionFileEntry>>,
        on_progress: &mut F,
    ) -> Result<SyncStatus>
    where
        F: FnMut(SyncProgress),
    {
        on_progress(SyncProgress {
            phase: SyncProgressPhase::ScanningFiles,
            total_session_files: 0,
            files_to_process: 0,
            processed_files: 0,
            removed_sessions: 0,
            new_sessions: 0,
            changed_sessions: 0,
            error_message: None,
        });
        let sessions_root = self.codex_home_path.join("sessions");
        let entries = scanned_entries.unwrap_or(self.scan_session_files(&sessions_root)?);
        let existing_records = self.store.load_source_sessions()?;
        let (dirty_entries, new_sessions) = if requires_rescan {
            (entries.iter().collect::<Vec<_>>(), 0)
        } else {
            self.find_dirty_entries(&entries, &existing_records)
        };

        let removed_session_ids = if requires_rescan {
            Vec::new()
        } else {
            removed_session_ids(&entries, &existing_records)
        };
        let changed_sessions = dirty_entries.len().saturating_sub(new_sessions);
        let removed_sessions = removed_session_ids.len();
        let total_session_files = entries.len();
        let files_to_process = dirty_entries.len();

        if requires_rescan {
            self.store.reset_cache()?;
        }

        let mut sync_progress = SyncProgress {
            phase: SyncProgressPhase::ProcessingFiles,
            total_session_files,
            files_to_process,
            processed_files: 0,
            removed_sessions,
            new_sessions,
            changed_sessions,
            error_message: None,
        };
        on_progress(sync_progress.clone());

        let affected_session_ids = dirty_entries
            .iter()
            .map(|entry| entry.session_id.clone())
            .chain(removed_session_ids.iter().cloned())
            .collect::<Vec<_>>();
        let mut affected_date_keys = self
            .store
            .list_date_keys_for_sessions(&affected_session_ids)?
            .into_iter()
            .collect::<HashSet<_>>();

        let progress_stride = progress_stride(files_to_process);

        for (index, entry) in dirty_entries.iter().enumerate() {
            let parsed_file =
                parse_session_file(&entry.file_path, &sessions_root, &self.time_zone)?;
            extend_affected_date_keys(&mut affected_date_keys, &parsed_file);
            self.store
                .replace_session_file(&parsed_file, self.parse_version, now.clone())?;
            sync_progress.processed_files = index + 1;

            if sync_progress.processed_files == files_to_process
                || sync_progress.processed_files == 1
                || sync_progress.processed_files % progress_stride == 0
            {
                on_progress(sync_progress.clone());
            }
        }

        if !removed_session_ids.is_empty() {
            self.store.delete_sessions(&removed_session_ids)?;
        }

        let affected_date_keys = affected_date_keys.into_iter().collect::<Vec<_>>();
        on_progress(SyncProgress {
            phase: SyncProgressPhase::Finalizing,
            ..sync_progress.clone()
        });
        self.store
            .rebuild_aggregates_for_date_keys(&affected_date_keys)?;
        self.store.save_sync_context(&SyncContext {
            codex_home_path: Some(self.codex_home_path.display().to_string()),
            time_zone: Some(self.time_zone.clone()),
            parse_version: Some(self.parse_version),
        })?;

        Ok(SyncStatus {
            state: SyncState::Success,
            last_synced_at: Some(format_utc_timestamp(now)),
            error_message: None,
            coverage_through: self
                .store
                .latest_source_usage_at()?
                .map(format_utc_timestamp),
            coverage_granularity: Some(SyncCoverageGranularity::Minute),
            scanned_files: total_session_files as i64,
            session_count: (files_to_process + removed_sessions) as i64,
            data_source: Some(SyncDataSource::JsonlDirect),
        })
    }

    pub fn current_session_file_count(&self) -> Result<usize> {
        Ok(self.scan_session_files_snapshot()?.len())
    }

    pub(crate) fn scan_session_files_snapshot(&self) -> Result<Vec<SessionFileEntry>> {
        let sessions_root = self.codex_home_path.join("sessions");
        self.scan_session_files(&sessions_root)
    }

    fn summary_with_status(
        &self,
        period: UsagePeriod,
        status: &SyncStatus,
    ) -> Result<UsageSummary> {
        let (lower_bound, upper_bound) = self.period_bounds(period)?;
        let rows = self
            .store
            .list_daily_rows_between(&lower_bound, &upper_bound)?;

        Ok(UsageSummary {
            period,
            totals: sum_daily_rows(&rows),
            models: aggregate_daily_rows(&rows),
            last_updated_at: status.last_synced_at.clone(),
        })
    }

    fn last_7_day_history_with_status(
        &self,
        status: &SyncStatus,
    ) -> Result<Vec<DailyUsageSummary>> {
        let keys = last_n_date_keys(Utc::now(), &self.time_zone, 7)?;
        self.daily_history_for_keys_with_status(&keys, status)
    }

    fn activity_history_with_status(
        &self,
        status: &SyncStatus,
    ) -> Result<Vec<DailyUsageSummary>> {
        let today_key = last_n_date_keys(Utc::now(), &self.time_zone, 1)?
            .into_iter()
            .next()
            .unwrap_or_else(|| "0000-01-01".to_string());
        let today = NaiveDate::parse_from_str(&today_key, "%Y-%m-%d")
            .with_context(|| format!("unsupported date key: {today_key}"))?;
        let start_key = add_days_to_date_key(
            &today_key,
            -((52 * 7) as i64 + i64::from(today.weekday().num_days_from_sunday())),
        )?;
        let keys = date_keys_descending_between(&start_key, &today_key)?;
        self.daily_history_for_keys_with_status(&keys, status)
    }

    fn daily_history_for_keys_with_status(
        &self,
        keys: &[String],
        status: &SyncStatus,
    ) -> Result<Vec<DailyUsageSummary>> {
        let lower_bound = keys
            .last()
            .cloned()
            .unwrap_or_else(|| "0000-01-01".to_string());
        let upper_bound = keys
            .first()
            .cloned()
            .unwrap_or_else(|| "9999-12-31".to_string());
        let rows = self
            .store
            .list_daily_rows_between(&lower_bound, &upper_bound)?;
        let mut grouped: HashMap<String, Vec<StoredDailyAggregate>> = HashMap::new();

        for row in rows {
            grouped.entry(row.date_key.clone()).or_default().push(row);
        }

        Ok(keys
            .iter()
            .cloned()
            .map(|date_key| {
                let day_rows = grouped.remove(&date_key).unwrap_or_default();
                DailyUsageSummary {
                    date_key,
                    totals: sum_daily_rows(&day_rows),
                    models: aggregate_daily_rows(&day_rows),
                    last_updated_at: status.last_synced_at.clone(),
                }
            })
            .collect())
    }

    fn monthly_history_with_status(&self, status: &SyncStatus) -> Result<Vec<MonthlyUsageSummary>> {
        let rows = self.store.list_monthly_rows()?;
        let mut grouped: HashMap<String, Vec<StoredMonthlyAggregate>> = HashMap::new();

        for row in rows {
            grouped.entry(row.month_key.clone()).or_default().push(row);
        }

        let mut month_keys = grouped.keys().cloned().collect::<Vec<_>>();
        month_keys.sort_by(|left, right| right.cmp(left));

        Ok(month_keys
            .into_iter()
            .map(|month_key| {
                let month_rows = grouped.remove(&month_key).unwrap_or_default();
                let mut models = month_rows
                    .iter()
                    .map(|row| ModelUsageBreakdown {
                        model: row.model.clone(),
                        is_fallback: row.is_fallback,
                        totals: row.totals.clone(),
                    })
                    .collect::<Vec<_>>();
                sort_breakdowns(&mut models);

                MonthlyUsageSummary {
                    month_key,
                    totals: sum_monthly_rows(&month_rows),
                    models,
                    last_updated_at: status.last_synced_at.clone(),
                }
            })
            .collect())
    }

    fn requires_full_rescan(&self) -> Result<bool> {
        let context = self.store.load_sync_context()?;
        let codex_home_path = self.codex_home_path.display().to_string();
        Ok(context.codex_home_path.as_ref() != Some(&codex_home_path)
            || context.time_zone.as_deref() != Some(self.time_zone.as_str())
            || context.parse_version != Some(self.parse_version))
    }

    fn compute_sync_preview_from_entries(
        &self,
        entries: &[SessionFileEntry],
        force_all_dirty: bool,
    ) -> Result<SyncPreview> {
        let existing_records = self.store.load_source_sessions()?;

        if force_all_dirty {
            return Ok(SyncPreview {
                needs_sync: !entries.is_empty() || !existing_records.is_empty(),
                new_sessions: 0,
                changed_sessions: entries.len(),
                removed_sessions: 0,
                total_tracked_sessions: existing_records.len(),
                total_session_files: entries.len(),
            });
        }

        let (dirty_entries, new_sessions) = self.find_dirty_entries(&entries, &existing_records);
        let removed_session_ids = removed_session_ids(&entries, &existing_records).len();

        Ok(SyncPreview {
            needs_sync: !dirty_entries.is_empty() || removed_session_ids > 0,
            new_sessions,
            changed_sessions: dirty_entries.len().saturating_sub(new_sessions),
            removed_sessions: removed_session_ids,
            total_tracked_sessions: existing_records.len(),
            total_session_files: entries.len(),
        })
    }

    fn scan_session_files(&self, sessions_root: &Path) -> Result<Vec<SessionFileEntry>> {
        if !sessions_root.exists() {
            return Ok(Vec::new());
        }

        let mut entries = Vec::new();
        for entry in WalkDir::new(sessions_root).follow_links(false) {
            let entry = entry.context("failed to traverse sessions directory")?;
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.path().extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }

            let metadata = fs::metadata(entry.path()).with_context(|| {
                format!("failed to read metadata for {}", entry.path().display())
            })?;
            let relative_path = relative_posix_path(sessions_root, entry.path())?;
            let session_id = relative_path.trim_end_matches(".jsonl").to_string();
            entries.push(SessionFileEntry {
                session_id,
                file_path: entry.path().to_path_buf(),
                relative_path,
                file_size: metadata.len() as i64,
                modified_at: DateTime::<Utc>::from(metadata.modified().with_context(|| {
                    format!("failed to read mtime for {}", entry.path().display())
                })?),
            });
        }

        Ok(entries)
    }

    fn find_dirty_entries<'a>(
        &self,
        entries: &'a [SessionFileEntry],
        existing_records: &HashMap<String, SourceSessionRecord>,
    ) -> (Vec<&'a SessionFileEntry>, usize) {
        let mut dirty_entries = Vec::new();
        let mut new_sessions = 0;

        for entry in entries {
            let Some(existing) = existing_records.get(&entry.session_id) else {
                dirty_entries.push(entry);
                new_sessions += 1;
                continue;
            };

            let same_size = existing.file_size == entry.file_size;
            let same_modified_at = parse_rfc3339_utc(&existing.modified_at)
                .map(|timestamp| {
                    (timestamp.timestamp_millis() - entry.modified_at.timestamp_millis()).abs()
                        < 500
                })
                .unwrap_or(false);
            let same_parse_version = existing.parse_version == self.parse_version;
            let same_relative_path = existing.relative_path == entry.relative_path;

            if !(same_size && same_modified_at && same_parse_version && same_relative_path) {
                dirty_entries.push(entry);
            }
        }

        (dirty_entries, new_sessions)
    }

    fn period_bounds(&self, period: UsagePeriod) -> Result<(String, String)> {
        let today_key = last_n_date_keys(Utc::now(), &self.time_zone, 1)?
            .into_iter()
            .next()
            .unwrap_or_else(|| "0000-01-01".to_string());

        match period {
            UsagePeriod::Today => Ok((today_key.clone(), today_key)),
            UsagePeriod::Last7Days => Ok((add_days_to_date_key(&today_key, -6)?, today_key)),
            UsagePeriod::MonthToDate => Ok((
                format!("{}-01", month_key_for(Utc::now(), &self.time_zone)?),
                today_key,
            )),
        }
    }
}

fn extend_affected_date_keys(affected: &mut HashSet<String>, parsed_file: &ParsedSessionFile) {
    for usage in &parsed_file.usages {
        affected.insert(usage.date_key.clone());
    }
}

fn aggregate_daily_rows(rows: &[StoredDailyAggregate]) -> Vec<ModelUsageBreakdown> {
    let mut grouped: HashMap<String, ModelUsageBreakdown> = HashMap::new();

    for row in rows {
        let key = format!("{}\u{0}{}", row.model, if row.is_fallback { 1 } else { 0 });
        grouped
            .entry(key)
            .and_modify(|existing| {
                existing.totals = add_usage_totals(&existing.totals, &row.totals);
            })
            .or_insert_with(|| ModelUsageBreakdown {
                model: row.model.clone(),
                is_fallback: row.is_fallback,
                totals: row.totals.clone(),
            });
    }

    let mut values = grouped.into_values().collect::<Vec<_>>();
    sort_breakdowns(&mut values);
    values
}

fn sum_daily_rows(rows: &[StoredDailyAggregate]) -> crate::models::UsageTotals {
    rows.iter().fold(empty_usage_totals(), |totals, row| {
        add_usage_totals(&totals, &row.totals)
    })
}

fn sum_monthly_rows(rows: &[StoredMonthlyAggregate]) -> crate::models::UsageTotals {
    rows.iter().fold(empty_usage_totals(), |totals, row| {
        add_usage_totals(&totals, &row.totals)
    })
}

fn validated_date_range(start_date: &str, end_date: &str) -> Result<(String, String)> {
    let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
        .with_context(|| format!("unsupported start_date: {start_date}"))?;
    let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
        .with_context(|| format!("unsupported end_date: {end_date}"))?;

    if start > end {
        anyhow::bail!("start_date must be on or before end_date");
    }

    Ok((
        start.format("%Y-%m-%d").to_string(),
        end.format("%Y-%m-%d").to_string(),
    ))
}

fn date_keys_descending_between(start_date: &str, end_date: &str) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    let mut cursor = end_date.to_string();

    loop {
        keys.push(cursor.clone());

        if cursor == start_date {
            break;
        }

        cursor = add_days_to_date_key(&cursor, -1)?;
    }

    Ok(keys)
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn relative_posix_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).with_context(|| {
        format!(
            "failed to strip prefix {} from {}",
            root.display(),
            path.display()
        )
    })?;

    Ok(relative
        .iter()
        .map(|segment| segment.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn progress_stride(total: usize) -> usize {
    if total <= 100 {
        1
    } else {
        (total / 100).max(1)
    }
}

fn removed_session_ids(
    entries: &[SessionFileEntry],
    existing_records: &HashMap<String, SourceSessionRecord>,
) -> Vec<String> {
    let current_session_ids = entries
        .iter()
        .map(|entry| entry.session_id.as_str())
        .collect::<HashSet<_>>();

    existing_records
        .keys()
        .filter(|session_id| !current_session_ids.contains(session_id.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{UsageRepository, UsageRepositoryConfig};

    fn write_session(temp_dir: &TempDir, relative_path: &str, content: &str) {
        let sessions_root = temp_dir.path().join("sessions");
        let file_path = sessions_root.join(relative_path);
        fs::create_dir_all(file_path.parent().expect("session file parent"))
            .expect("create session dirs");
        fs::write(file_path, content).expect("write session file");
    }

    fn make_repository(temp_dir: &TempDir, parse_version: i32) -> UsageRepository {
        let database_path = temp_dir.path().join("usage.sqlite");
        UsageRepository::new(UsageRepositoryConfig {
            codex_home_path: temp_dir.path().to_path_buf(),
            database_path,
            time_zone: "Asia/Shanghai".to_string(),
            parse_version,
        })
        .expect("create repository")
    }

    fn sample_session() -> &'static str {
        r#"
{"type":"turn_context","timestamp":"2026-04-09T01:00:00.000Z","payload":{"model":"gpt-5.4"}}
{"type":"event_msg","timestamp":"2026-04-09T01:02:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":3,"total_tokens":110}}}}
"#
    }

    fn second_sample_session() -> &'static str {
        r#"
{"type":"turn_context","timestamp":"2026-04-09T03:00:00.000Z","payload":{"model":"gpt-5.4"}}
{"type":"event_msg","timestamp":"2026-04-09T03:05:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":55}}}}
"#
    }

    #[test]
    fn daily_history_between_returns_requested_range_with_empty_days() {
        let temp_dir = TempDir::new().expect("temp dir");
        write_session(&temp_dir, "2026/04/09/example.jsonl", sample_session());
        let repository = make_repository(&temp_dir, 4);
        repository.sync(false).expect("initial sync");

        let rows = repository
            .daily_history_between("2026-04-08", "2026-04-10")
            .expect("daily history between");

        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].date_key, "2026-04-10");
        assert_eq!(rows[0].totals.total_tokens, 0);
        assert_eq!(rows[1].date_key, "2026-04-09");
        assert_eq!(rows[1].totals.total_tokens, 110);
        assert_eq!(rows[2].date_key, "2026-04-08");
        assert_eq!(rows[2].totals.total_tokens, 0);
    }

    #[test]
    fn dashboard_activity_history_covers_trailing_year_with_empty_days() {
        let temp_dir = TempDir::new().expect("temp dir");
        write_session(&temp_dir, "2026/04/09/example.jsonl", sample_session());
        let repository = make_repository(&temp_dir, 4);
        repository.sync(false).expect("initial sync");

        let payload = repository
            .build_dashboard_payload(false)
            .expect("dashboard payload");

        assert!(payload.activity_history.len() >= 365);
        assert!(payload.activity_history.len() <= 371);
        assert_eq!(
            payload.activity_history.first().map(|row| row.date_key.as_str()),
            Some(payload.now[..10].as_ref())
        );
        assert!(payload
            .activity_history
            .iter()
            .any(|row| row.date_key == "2026-04-09" && row.totals.total_tokens == 110));
        assert!(payload
            .activity_history
            .iter()
            .any(|row| row.totals.total_tokens == 0));
    }

    #[test]
    fn sync_preview_detects_new_session_and_clears_after_sync() {
        let temp_dir = TempDir::new().expect("temp dir");
        write_session(&temp_dir, "2026/04/09/example.jsonl", sample_session());
        let repository = make_repository(&temp_dir, 4);

        let before = repository.sync_preview().expect("preview before sync");
        assert!(before.needs_sync);
        assert_eq!(before.new_sessions, 0);
        assert_eq!(before.changed_sessions, 1);
        assert_eq!(before.total_tracked_sessions, 0);

        let payload = repository
            .sync_and_build_dashboard(false)
            .expect("sync and build dashboard");

        let after = repository.sync_preview().expect("preview after sync");
        assert!(!after.needs_sync);
        let payload_preview = payload.sync_preview.expect("payload preview");
        assert!(!payload_preview.needs_sync);
        assert_eq!(payload_preview.total_session_files, 1);
    }

    #[test]
    fn parse_version_change_forces_full_rescan_preview() {
        let temp_dir = TempDir::new().expect("temp dir");
        write_session(&temp_dir, "2026/04/09/example.jsonl", sample_session());

        let repository_v4 = make_repository(&temp_dir, 4);
        repository_v4.sync(false).expect("initial sync");

        let repository_v5 = make_repository(&temp_dir, 5);
        let preview = repository_v5
            .sync_preview()
            .expect("preview after parse version bump");

        assert!(preview.needs_sync);
        assert_eq!(preview.new_sessions, 0);
        assert_eq!(preview.changed_sessions, 1);
        assert_eq!(preview.total_tracked_sessions, 1);
        assert_eq!(preview.total_session_files, 1);
    }

    #[test]
    fn sync_removes_deleted_session_and_rebuilds_aggregates() {
        let temp_dir = TempDir::new().expect("temp dir");
        let relative_path = "2026/04/09/example.jsonl";
        write_session(&temp_dir, relative_path, sample_session());

        let repository = make_repository(&temp_dir, 4);
        repository.sync(false).expect("initial sync");

        let before_delete = repository
            .build_dashboard_payload(false)
            .expect("dashboard before delete");
        assert_eq!(before_delete.monthly_history[0].totals.total_tokens, 110);

        fs::remove_file(temp_dir.path().join("sessions").join(relative_path))
            .expect("remove session");

        let preview = repository.sync_preview().expect("preview after delete");
        assert!(preview.needs_sync);
        assert_eq!(preview.removed_sessions, 1);

        let payload = repository
            .sync_and_build_dashboard(false)
            .expect("sync after delete");

        assert!(payload.monthly_history.is_empty());
        let payload_preview = payload.sync_preview.expect("payload preview after delete");
        assert!(!payload_preview.needs_sync);
        assert_eq!(payload_preview.total_tracked_sessions, 0);
        assert_eq!(payload_preview.total_session_files, 0);
    }

    #[test]
    fn force_full_rescan_rebuilds_from_current_files_only() {
        let temp_dir = TempDir::new().expect("temp dir");
        let first_path = "2026/04/09/example-a.jsonl";
        let second_path = "2026/04/09/example-b.jsonl";
        write_session(&temp_dir, first_path, sample_session());
        write_session(&temp_dir, second_path, second_sample_session());

        let repository = make_repository(&temp_dir, 4);
        repository.sync(false).expect("initial sync");

        let initial = repository
            .build_dashboard_payload(false)
            .expect("initial dashboard");
        assert_eq!(initial.monthly_history[0].totals.total_tokens, 165);

        fs::remove_file(temp_dir.path().join("sessions").join(second_path))
            .expect("remove second session");

        let payload = repository
            .sync_and_build_dashboard(true)
            .expect("force full rescan");

        assert_eq!(payload.monthly_history[0].totals.total_tokens, 110);
        let payload_preview = payload.sync_preview.expect("payload preview");
        assert!(!payload_preview.needs_sync);
        assert_eq!(payload_preview.total_tracked_sessions, 1);
        assert_eq!(payload_preview.total_session_files, 1);
    }

    #[test]
    fn sync_failure_persists_failed_status() {
        let temp_dir = TempDir::new().expect("temp dir");
        write_session(&temp_dir, "2026/04/09/example.jsonl", sample_session());
        let database_path = temp_dir.path().join("usage.sqlite");
        let repository = UsageRepository::new(UsageRepositoryConfig {
            codex_home_path: temp_dir.path().to_path_buf(),
            database_path,
            time_zone: "Invalid/TimeZone".to_string(),
            parse_version: 4,
        })
        .expect("create repository");

        let error = repository.sync(false).expect_err("sync should fail");
        assert!(error.to_string().contains("unsupported time zone"));

        let status = repository
            .current_sync_status()
            .expect("load failed sync status");
        assert!(matches!(status.state, crate::models::SyncState::Failed));
        assert!(status
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("unsupported time zone")));
    }
}
