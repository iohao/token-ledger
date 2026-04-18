use std::cmp::Ordering;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UsagePeriod {
    Today,
    Last7Days,
    MonthToDate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    Idle,
    Syncing,
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncCoverageGranularity {
    Minute,
    Day,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncDataSource {
    JsonlDirect,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncProgressPhase {
    Preparing,
    ScanningFiles,
    ProcessingFiles,
    Finalizing,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabasePathSource {
    Env,
    Config,
    Default,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageBreakdown {
    pub model: String,
    pub is_fallback: bool,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub period: UsagePeriod,
    pub totals: UsageTotals,
    pub models: Vec<ModelUsageBreakdown>,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsageSummary {
    pub date_key: String,
    pub totals: UsageTotals,
    pub models: Vec<ModelUsageBreakdown>,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyUsageSummary {
    pub month_key: String,
    pub totals: UsageTotals,
    pub models: Vec<ModelUsageBreakdown>,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncContext {
    pub codex_home_path: Option<String>,
    pub time_zone: Option<String>,
    pub parse_version: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncState,
    pub last_synced_at: Option<String>,
    pub error_message: Option<String>,
    pub coverage_through: Option<String>,
    pub coverage_granularity: Option<SyncCoverageGranularity>,
    pub scanned_files: i64,
    pub session_count: i64,
    pub data_source: Option<SyncDataSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    pub needs_sync: bool,
    pub new_sessions: usize,
    pub changed_sessions: usize,
    pub removed_sessions: usize,
    pub total_tracked_sessions: usize,
    pub total_session_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub phase: SyncProgressPhase,
    pub total_session_files: usize,
    pub files_to_process: usize,
    pub processed_files: usize,
    pub removed_sessions: usize,
    pub new_sessions: usize,
    pub changed_sessions: usize,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMeta {
    pub codex_home_path: String,
    pub database_path: String,
    pub database_path_source: DatabasePathSource,
    pub database_path_editable: bool,
    pub time_zone: String,
    pub parse_version: i32,
    pub pricing_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPayload {
    pub meta: DashboardMeta,
    pub status: SyncStatus,
    pub sync_preview: Option<SyncPreview>,
    pub summaries: Vec<UsageSummary>,
    pub daily_history: Vec<DailyUsageSummary>,
    pub activity_history: Vec<DailyUsageSummary>,
    pub monthly_history: Vec<MonthlyUsageSummary>,
    pub now: String,
}

#[derive(Debug, Clone)]
pub struct DailySessionModelUsage {
    pub session_id: String,
    pub relative_path: String,
    pub date_key: String,
    pub model: String,
    pub is_fallback: bool,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone)]
pub struct ParsedSessionFile {
    pub session_id: String,
    pub relative_path: String,
    pub file_size: i64,
    pub modified_at: DateTime<Utc>,
    pub latest_usage_at: Option<DateTime<Utc>>,
    pub usages: Vec<DailySessionModelUsage>,
}

#[derive(Debug, Clone)]
pub struct StoredDailyAggregate {
    pub date_key: String,
    pub model: String,
    pub is_fallback: bool,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone)]
pub struct StoredMonthlyAggregate {
    pub month_key: String,
    pub model: String,
    pub is_fallback: bool,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone)]
pub struct SourceSessionRecord {
    pub session_id: String,
    pub relative_path: String,
    pub file_size: i64,
    pub modified_at: String,
    pub parse_version: i32,
}

pub fn usage_periods() -> [UsagePeriod; 3] {
    [
        UsagePeriod::Today,
        UsagePeriod::Last7Days,
        UsagePeriod::MonthToDate,
    ]
}

pub fn empty_usage_totals() -> UsageTotals {
    UsageTotals {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0.0,
    }
}

pub fn add_usage_totals(left: &UsageTotals, right: &UsageTotals) -> UsageTotals {
    UsageTotals {
        input_tokens: left.input_tokens + right.input_tokens,
        cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
        output_tokens: left.output_tokens + right.output_tokens,
        reasoning_output_tokens: left.reasoning_output_tokens + right.reasoning_output_tokens,
        total_tokens: left.total_tokens + right.total_tokens,
        cost_usd: left.cost_usd + right.cost_usd,
    }
}

pub fn clamp_non_negative(totals: UsageTotals) -> UsageTotals {
    UsageTotals {
        input_tokens: totals.input_tokens.max(0),
        cached_input_tokens: totals.cached_input_tokens.max(0),
        output_tokens: totals.output_tokens.max(0),
        reasoning_output_tokens: totals.reasoning_output_tokens.max(0),
        total_tokens: totals.total_tokens.max(0),
        cost_usd: totals.cost_usd.max(0.0),
    }
}

pub fn is_zero_usage_totals(totals: &UsageTotals) -> bool {
    totals.input_tokens == 0
        && totals.cached_input_tokens == 0
        && totals.output_tokens == 0
        && totals.reasoning_output_tokens == 0
}

pub fn idle_sync_status() -> SyncStatus {
    SyncStatus {
        state: SyncState::Idle,
        last_synced_at: None,
        error_message: None,
        coverage_through: None,
        coverage_granularity: None,
        scanned_files: 0,
        session_count: 0,
        data_source: None,
    }
}

pub fn empty_sync_context() -> SyncContext {
    SyncContext {
        codex_home_path: None,
        time_zone: None,
        parse_version: None,
    }
}

pub fn format_utc_timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn sort_breakdowns(rows: &mut [ModelUsageBreakdown]) {
    rows.sort_by(
        |left, right| match right.totals.total_tokens.cmp(&left.totals.total_tokens) {
            Ordering::Equal => match left.model.cmp(&right.model) {
                Ordering::Equal => left.is_fallback.cmp(&right.is_fallback),
                ordering => ordering,
            },
            ordering => ordering,
        },
    );
}
