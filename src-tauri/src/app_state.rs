use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::models::{
    DashboardMeta, DatabasePathSource, SyncPreview, SyncProgress, SyncProgressPhase,
};
use crate::repository::{SessionFileEntry, UsageRepository, UsageRepositoryConfig};

const SYNC_PREVIEW_CACHE_TTL: Duration = Duration::from_secs(5);
const SESSION_FILE_SCAN_CACHE_TTL: Duration = Duration::from_secs(15);
const APP_SETTINGS_DIR: &str = ".tokenledger";
const LEGACY_APP_SETTINGS_DIRS: [&str; 2] = [".tokenaccount", ".codex-usage-tauri"];

pub struct AppState {
    codex_home_path: PathBuf,
    settings_path: PathBuf,
    database_config: Mutex<DatabaseConfigState>,
    database_path_locked: bool,
    time_zone: String,
    parse_version: i32,
    sync_state: Mutex<SyncExecutionState>,
    sync_preview_cache: Mutex<Option<CachedSyncPreview>>,
    session_file_scan_cache: Mutex<Option<CachedSessionFileScan>>,
}

#[derive(Debug)]
struct DatabaseConfigState {
    path: PathBuf,
    source: DatabasePathSource,
}

#[derive(Debug, Default)]
struct SyncExecutionState {
    running: bool,
    progress: Option<SyncProgress>,
}

#[derive(Debug, Clone)]
struct CachedSyncPreview {
    value: SyncPreview,
    cached_at: Instant,
}

#[derive(Debug, Clone)]
struct CachedSessionFileScan {
    entries: Vec<SessionFileEntry>,
    cached_at: Instant,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    database_path: Option<String>,
}

impl AppState {
    pub fn detect() -> Self {
        let codex_home_path = env_path("CODEX_HOME")
            .or_else(default_codex_home)
            .unwrap_or_else(|| PathBuf::from(".codex"));
        let settings_path = app_settings_path(&codex_home_path);
        let env_database_path = env_path("CODEX_USAGE_DATABASE");
        let settings = load_app_settings(
            &settings_path,
            &legacy_app_settings_paths(&codex_home_path),
        )
        .unwrap_or_default();
        let database_config =
            resolve_database_config(&codex_home_path, env_database_path.clone(), &settings);
        let time_zone = env::var("TZ")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| iana_time_zone::get_timezone().ok())
            .unwrap_or_else(|| "UTC".to_string());

        Self {
            codex_home_path,
            settings_path,
            database_config: Mutex::new(database_config),
            database_path_locked: env_database_path.is_some(),
            time_zone,
            parse_version: 4,
            sync_state: Mutex::new(SyncExecutionState::default()),
            sync_preview_cache: Mutex::new(None),
            session_file_scan_cache: Mutex::new(None),
        }
    }

    pub fn repository(&self) -> Result<UsageRepository> {
        let database_path = self
            .database_config
            .lock()
            .map_err(|_| anyhow::anyhow!("database config lock poisoned"))?
            .path
            .clone();

        UsageRepository::new(UsageRepositoryConfig {
            codex_home_path: self.codex_home_path.clone(),
            database_path,
            time_zone: self.time_zone.clone(),
            parse_version: self.parse_version,
        })
    }

    pub fn populate_dashboard_meta(&self, meta: &mut DashboardMeta) -> Result<()> {
        let database_config = self
            .database_config
            .lock()
            .map_err(|_| anyhow::anyhow!("database config lock poisoned"))?;

        meta.database_path = database_config.path.display().to_string();
        meta.database_path_source = database_config.source;
        meta.database_path_editable = !self.database_path_locked;
        Ok(())
    }

    pub fn is_syncing(&self) -> Result<bool> {
        let sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;
        Ok(sync_state.running)
    }

    pub fn current_sync_progress(&self) -> Result<Option<SyncProgress>> {
        let sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;
        Ok(sync_state.progress.clone())
    }

    pub fn sync_preview(&self) -> Result<SyncPreview> {
        if let Some(preview) = self.cached_sync_preview()? {
            return Ok(preview);
        }

        let repository = self.repository()?;
        let session_file_entries = if let Some(entries) = self.cached_session_file_entries()? {
            entries
        } else {
            let entries = repository.scan_session_files_snapshot()?;
            self.store_session_file_entries(entries.clone())?;
            entries
        };
        let preview = repository.sync_preview_from_entries(&session_file_entries)?;
        if !self.is_syncing()? {
            self.store_sync_preview(preview.clone())?;
        }
        Ok(preview)
    }

    pub fn try_begin_sync(&self) -> Result<bool> {
        let mut sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;

        if sync_state.running {
            return Ok(false);
        }

        sync_state.running = true;
        sync_state.progress = Some(SyncProgress {
            phase: SyncProgressPhase::Preparing,
            total_session_files: 0,
            files_to_process: 0,
            processed_files: 0,
            removed_sessions: 0,
            new_sessions: 0,
            changed_sessions: 0,
            error_message: None,
        });
        self.invalidate_sync_preview_cache()?;
        Ok(true)
    }

    pub fn update_sync_progress(&self, progress: SyncProgress) -> Result<()> {
        let mut sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;
        sync_state.progress = Some(progress);
        Ok(())
    }

    pub fn finish_sync(&self) -> Result<()> {
        let mut sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;
        sync_state.running = false;
        sync_state.progress = None;
        drop(sync_state);
        self.invalidate_sync_preview_cache()?;
        self.invalidate_session_file_cache()?;
        Ok(())
    }

    fn lock_available_operation(&self) -> Result<std::sync::MutexGuard<'_, SyncExecutionState>> {
        let sync_state = self
            .sync_state
            .lock()
            .map_err(|_| anyhow::anyhow!("sync state lock poisoned"))?;

        if sync_state.running {
            anyhow::bail!("sync is already running");
        }

        Ok(sync_state)
    }

    pub fn set_database_path(&self, database_path: PathBuf) -> Result<()> {
        let _sync_guard = self.lock_available_operation()?;

        if self.database_path_locked {
            anyhow::bail!(
                "database path is managed by CODEX_USAGE_DATABASE and cannot be changed in the app"
            );
        }

        if database_path.as_os_str().is_empty() {
            anyhow::bail!("database path cannot be empty");
        }

        let repository = UsageRepository::new(UsageRepositoryConfig {
            codex_home_path: self.codex_home_path.clone(),
            database_path: database_path.clone(),
            time_zone: self.time_zone.clone(),
            parse_version: self.parse_version,
        })?;

        save_app_settings(
            &self.settings_path,
            &AppSettings {
                database_path: Some(repository.database_path.display().to_string()),
            },
        )?;

        let mut database_config = self
            .database_config
            .lock()
            .map_err(|_| anyhow::anyhow!("database config lock poisoned"))?;
        database_config.path = repository.database_path;
        database_config.source = DatabasePathSource::Config;
        drop(database_config);
        self.invalidate_sync_preview_cache()?;
        Ok(())
    }

    pub fn reset_database_path(&self) -> Result<()> {
        let _sync_guard = self.lock_available_operation()?;

        if self.database_path_locked {
            anyhow::bail!(
                "database path is managed by CODEX_USAGE_DATABASE and cannot be changed in the app"
            );
        }

        let database_path = default_database_path(&self.codex_home_path);
        let repository = UsageRepository::new(UsageRepositoryConfig {
            codex_home_path: self.codex_home_path.clone(),
            database_path,
            time_zone: self.time_zone.clone(),
            parse_version: self.parse_version,
        })?;

        save_app_settings(
            &self.settings_path,
            &AppSettings {
                database_path: None,
            },
        )?;

        let mut database_config = self
            .database_config
            .lock()
            .map_err(|_| anyhow::anyhow!("database config lock poisoned"))?;
        database_config.path = repository.database_path;
        database_config.source = DatabasePathSource::Default;
        drop(database_config);
        self.invalidate_sync_preview_cache()?;
        Ok(())
    }

    fn cached_sync_preview(&self) -> Result<Option<SyncPreview>> {
        let mut sync_preview_cache = self
            .sync_preview_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("sync preview cache lock poisoned"))?;

        let Some(cached_preview) = sync_preview_cache.as_ref() else {
            return Ok(None);
        };

        if cached_preview.cached_at.elapsed() > SYNC_PREVIEW_CACHE_TTL {
            *sync_preview_cache = None;
            return Ok(None);
        }

        Ok(Some(cached_preview.value.clone()))
    }

    fn store_sync_preview(&self, preview: SyncPreview) -> Result<()> {
        let mut sync_preview_cache = self
            .sync_preview_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("sync preview cache lock poisoned"))?;
        *sync_preview_cache = Some(CachedSyncPreview {
            value: preview,
            cached_at: Instant::now(),
        });
        Ok(())
    }

    fn cached_session_file_entries(&self) -> Result<Option<Vec<SessionFileEntry>>> {
        let mut session_file_scan_cache = self
            .session_file_scan_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("session file scan cache lock poisoned"))?;

        let Some(cached_scan) = session_file_scan_cache.as_ref() else {
            return Ok(None);
        };

        if cached_scan.cached_at.elapsed() > SESSION_FILE_SCAN_CACHE_TTL {
            *session_file_scan_cache = None;
            return Ok(None);
        }

        Ok(Some(cached_scan.entries.clone()))
    }

    fn store_session_file_entries(&self, entries: Vec<SessionFileEntry>) -> Result<()> {
        let mut session_file_scan_cache = self
            .session_file_scan_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("session file scan cache lock poisoned"))?;
        *session_file_scan_cache = Some(CachedSessionFileScan {
            entries,
            cached_at: Instant::now(),
        });
        Ok(())
    }

    fn invalidate_sync_preview_cache(&self) -> Result<()> {
        let mut sync_preview_cache = self
            .sync_preview_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("sync preview cache lock poisoned"))?;
        *sync_preview_cache = None;
        Ok(())
    }

    fn invalidate_session_file_cache(&self) -> Result<()> {
        let mut session_file_scan_cache = self
            .session_file_scan_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("session file scan cache lock poisoned"))?;
        *session_file_scan_cache = None;
        Ok(())
    }
}

fn default_codex_home() -> Option<PathBuf> {
    default_codex_home_from_env(env::var_os("HOME"), env::var_os("USERPROFILE"))
}

fn default_database_path(codex_home_path: &std::path::Path) -> PathBuf {
    codex_home_path.join(".codex-usage").join("usage.sqlite")
}

fn app_settings_path(codex_home_path: &std::path::Path) -> PathBuf {
    codex_home_path.join(APP_SETTINGS_DIR).join("settings.json")
}

fn legacy_app_settings_paths(codex_home_path: &std::path::Path) -> Vec<PathBuf> {
    LEGACY_APP_SETTINGS_DIRS
        .iter()
        .map(|dir| codex_home_path.join(dir).join("settings.json"))
        .collect()
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_database_config(
    codex_home_path: &std::path::Path,
    env_database_path: Option<PathBuf>,
    settings: &AppSettings,
) -> DatabaseConfigState {
    if let Some(database_path) = env_database_path {
        return DatabaseConfigState {
            path: database_path,
            source: DatabasePathSource::Env,
        };
    }

    if let Some(database_path) = settings.database_path.as_ref().map(PathBuf::from) {
        return DatabaseConfigState {
            path: database_path,
            source: DatabasePathSource::Config,
        };
    }

    DatabaseConfigState {
        path: default_database_path(codex_home_path),
        source: DatabasePathSource::Default,
    }
}

fn load_app_settings(
    settings_path: &std::path::Path,
    legacy_settings_paths: &[PathBuf],
) -> Result<AppSettings> {
    if settings_path.exists() {
        return read_app_settings(settings_path);
    }

    for legacy_path in legacy_settings_paths {
        if legacy_path.exists() {
            return read_app_settings(legacy_path);
        }
    }

    Ok(AppSettings::default())
}

fn read_app_settings(settings_path: &std::path::Path) -> Result<AppSettings> {
    let content = fs::read_to_string(settings_path)
        .with_context(|| format!("failed to read app settings {}", settings_path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse app settings {}", settings_path.display()))
}

fn save_app_settings(settings_path: &std::path::Path, settings: &AppSettings) -> Result<()> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create app settings directory {}",
                parent.display()
            )
        })?;
    }

    let content =
        serde_json::to_string_pretty(settings).context("failed to serialize app settings")?;
    fs::write(settings_path, content)
        .with_context(|| format!("failed to write app settings {}", settings_path.display()))
}

fn default_codex_home_from_env(
    home: Option<OsString>,
    userprofile: Option<OsString>,
) -> Option<PathBuf> {
    home.filter(|value| !value.is_empty())
        .or_else(|| userprofile.filter(|value| !value.is_empty()))
        .map(|dir| PathBuf::from(dir).join(".codex"))
}

#[cfg(test)]
mod tests {
    use super::{
        app_settings_path, default_codex_home_from_env, default_database_path,
        legacy_app_settings_paths, load_app_settings, resolve_database_config, save_app_settings,
        AppSettings, AppState, DatabaseConfigState, DatabasePathSource, SyncExecutionState,
        SyncProgressPhase,
    };
    use crate::models::SyncPreview;
    use crate::repository::SessionFileEntry;
    use chrono::Utc;
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tempfile::TempDir;

    fn app_state_for_tests() -> AppState {
        AppState {
            codex_home_path: PathBuf::from("/tmp/home/.codex"),
            settings_path: PathBuf::from("/tmp/home/.codex/.tokenledger/settings.json"),
            database_config: Mutex::new(DatabaseConfigState {
                path: PathBuf::from("/tmp/home/.codex/.codex-usage/usage.sqlite"),
                source: DatabasePathSource::Default,
            }),
            database_path_locked: false,
            time_zone: "UTC".to_string(),
            parse_version: 4,
            sync_state: Mutex::new(SyncExecutionState::default()),
            sync_preview_cache: Mutex::new(None),
            session_file_scan_cache: Mutex::new(None),
        }
    }

    #[test]
    fn prefers_home_when_present() {
        let path = default_codex_home_from_env(
            Some(OsString::from("/tmp/home")),
            Some(OsString::from("/tmp/userprofile")),
        );

        assert_eq!(path, Some(PathBuf::from("/tmp/home/.codex")));
    }

    #[test]
    fn falls_back_to_userprofile_when_home_missing() {
        let path = default_codex_home_from_env(None, Some(OsString::from("/tmp/userprofile")));

        assert_eq!(path, Some(PathBuf::from("/tmp/userprofile/.codex")));
    }

    #[test]
    fn returns_none_when_no_home_variables_exist() {
        let path = default_codex_home_from_env(None, None);

        assert_eq!(path, None);
    }

    #[test]
    fn resolve_database_config_prefers_env_override() {
        let codex_home_path = PathBuf::from("/tmp/home/.codex");
        let config = resolve_database_config(
            &codex_home_path,
            Some(PathBuf::from("/tmp/override/usage.sqlite")),
            &AppSettings {
                database_path: Some("/tmp/config/usage.sqlite".to_string()),
            },
        );

        assert_eq!(config.path, PathBuf::from("/tmp/override/usage.sqlite"));
        assert!(matches!(config.source, DatabasePathSource::Env));
    }

    #[test]
    fn resolve_database_config_uses_saved_setting_when_present() {
        let codex_home_path = PathBuf::from("/tmp/home/.codex");
        let config = resolve_database_config(
            &codex_home_path,
            None,
            &AppSettings {
                database_path: Some("/tmp/config/usage.sqlite".to_string()),
            },
        );

        assert_eq!(config.path, PathBuf::from("/tmp/config/usage.sqlite"));
        assert!(matches!(config.source, DatabasePathSource::Config));
    }

    #[test]
    fn resolve_database_config_falls_back_to_default_path() {
        let codex_home_path = PathBuf::from("/tmp/home/.codex");
        let config = resolve_database_config(&codex_home_path, None, &AppSettings::default());

        assert_eq!(config.path, default_database_path(&codex_home_path));
        assert!(matches!(config.source, DatabasePathSource::Default));
    }

    #[test]
    fn default_database_path_uses_codex_usage_directory() {
        let codex_home_path = PathBuf::from("/tmp/home/.codex");

        assert_eq!(
            default_database_path(&codex_home_path),
            PathBuf::from("/tmp/home/.codex/.codex-usage/usage.sqlite")
        );
    }

    #[test]
    fn try_begin_sync_marks_running_until_finished() {
        let app_state = app_state_for_tests();

        assert_eq!(
            app_state.is_syncing().expect("sync state before start"),
            false
        );
        assert_eq!(app_state.try_begin_sync().expect("start sync"), true);
        assert_eq!(
            app_state.is_syncing().expect("sync state after start"),
            true
        );
        assert!(matches!(
            app_state
                .current_sync_progress()
                .expect("current sync progress")
                .expect("progress snapshot")
                .phase,
            SyncProgressPhase::Preparing
        ));
        assert_eq!(app_state.try_begin_sync().expect("start sync twice"), false);

        app_state.finish_sync().expect("finish sync");

        assert_eq!(
            app_state.is_syncing().expect("sync state after finish"),
            false
        );
        assert!(app_state
            .current_sync_progress()
            .expect("progress after finish")
            .is_none());
    }

    #[test]
    fn sync_preview_cache_roundtrip() {
        let app_state = app_state_for_tests();
        let preview = SyncPreview {
            needs_sync: true,
            new_sessions: 1,
            changed_sessions: 2,
            removed_sessions: 3,
            total_tracked_sessions: 4,
            total_session_files: 5,
        };

        app_state
            .store_sync_preview(preview.clone())
            .expect("store cached preview");

        assert_eq!(
            app_state
                .cached_sync_preview()
                .expect("cached preview query"),
            Some(preview)
        );
    }

    #[test]
    fn try_begin_sync_invalidates_sync_preview_cache() {
        let app_state = app_state_for_tests();

        app_state
            .store_sync_preview(SyncPreview {
                needs_sync: false,
                new_sessions: 0,
                changed_sessions: 0,
                removed_sessions: 0,
                total_tracked_sessions: 7,
                total_session_files: 7,
            })
            .expect("store cached preview");

        app_state.try_begin_sync().expect("start sync");

        assert_eq!(
            app_state
                .cached_sync_preview()
                .expect("cached preview after invalidation"),
            None
        );
    }

    #[test]
    fn session_file_scan_cache_roundtrip() {
        let app_state = app_state_for_tests();
        let cached_entries = vec![SessionFileEntry {
            session_id: "session-a".to_string(),
            file_path: PathBuf::from("/tmp/home/.codex/sessions/session-a.jsonl"),
            relative_path: "session-a.jsonl".to_string(),
            file_size: 42,
            modified_at: Utc::now(),
        }];

        app_state
            .store_session_file_entries(cached_entries.clone())
            .expect("store cached session entries");

        assert_eq!(
            app_state
                .cached_session_file_entries()
                .expect("cached session entries"),
            Some(cached_entries)
        );
    }

    #[test]
    fn app_settings_roundtrip() {
        let temp_dir = TempDir::new().expect("temp dir");
        let settings_path = app_settings_path(temp_dir.path());
        let expected = AppSettings {
            database_path: Some(temp_dir.path().join("usage.sqlite").display().to_string()),
        };

        save_app_settings(&settings_path, &expected).expect("save settings");
        let actual =
            load_app_settings(&settings_path, &legacy_app_settings_paths(temp_dir.path()))
                .expect("load settings");

        assert_eq!(actual, expected);
    }

    #[test]
    fn app_settings_loads_legacy_path_when_new_path_missing() {
        for legacy_dir in [".tokenaccount", ".codex-usage-tauri"] {
            let temp_dir = TempDir::new().expect("temp dir");
            let legacy_path = temp_dir.path().join(legacy_dir).join("settings.json");
            let expected = AppSettings {
                database_path: Some(temp_dir.path().join("legacy.sqlite").display().to_string()),
            };

            save_app_settings(&legacy_path, &expected).expect("save legacy settings");
            let actual = load_app_settings(
                &app_settings_path(temp_dir.path()),
                &legacy_app_settings_paths(temp_dir.path()),
            )
            .expect("load legacy settings");

            assert_eq!(actual, expected);
        }
    }
}
