use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_state::AppState;
use crate::models::{
    DailyUsageSummary, DashboardMeta, DashboardPayload, SyncPreview, SyncProgress, SyncStatus,
};

const SYNC_PROGRESS_EVENT_NAME: &str = "sync-progress";

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
pub fn get_dashboard(state: State<'_, AppState>) -> Result<DashboardPayload, String> {
    let mut payload = state
        .repository()
        .and_then(|repository| repository.build_dashboard_payload(false))
        .map_err(|error| error.to_string())?;
    state
        .populate_dashboard_meta(&mut payload.meta)
        .map_err(|error| error.to_string())?;
    Ok(payload)
}

#[tauri::command]
pub fn get_sync_preview(state: State<'_, AppState>) -> Result<SyncPreview, String> {
    state.sync_preview().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_sync(force_full_rescan: bool, app_handle: AppHandle) -> Result<bool, String> {
    let state = app_handle.state::<AppState>();
    let started = state.try_begin_sync().map_err(|error| error.to_string())?;
    if !started {
        return Ok(false);
    }
    drop(state);

    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        let mut publish_progress = |progress: SyncProgress| {
            if let Err(error) = state.update_sync_progress(progress.clone()) {
                eprintln!("failed to persist sync progress in runtime state: {error}");
            }

            if let Err(error) = app_handle.emit(SYNC_PROGRESS_EVENT_NAME, &progress) {
                eprintln!("failed to emit sync progress event: {error}");
            }
        };
        let sync_result = state.repository().and_then(|repository| {
            repository.sync_with_progress(force_full_rescan, &mut publish_progress)
        });

        if let Err(error) = sync_result {
            eprintln!("background sync failed: {error}");
        }

        if let Err(error) = state.finish_sync() {
            eprintln!("failed to update sync runtime state: {error}");
        }
    });

    Ok(true)
}

#[tauri::command]
pub fn is_sync_running(state: State<'_, AppState>) -> Result<bool, String> {
    state.is_syncing().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    state
        .repository()
        .and_then(|repository| repository.current_sync_status())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_sync_progress(state: State<'_, AppState>) -> Result<Option<SyncProgress>, String> {
    state
        .current_sync_progress()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_meta(state: State<'_, AppState>) -> Result<DashboardMeta, String> {
    let mut meta = state
        .repository()
        .map(|repository| repository.build_dashboard_meta())
        .map_err(|error| error.to_string())?;
    state
        .populate_dashboard_meta(&mut meta)
        .map_err(|error| error.to_string())?;
    Ok(meta)
}

#[tauri::command]
pub fn set_database_path(
    database_path: String,
    state: State<'_, AppState>,
) -> Result<DashboardPayload, String> {
    state
        .set_database_path(std::path::PathBuf::from(database_path.trim()))
        .map_err(|error| error.to_string())?;

    let mut payload = state
        .repository()
        .and_then(|repository| repository.build_dashboard_payload(false))
        .map_err(|error| error.to_string())?;
    state
        .populate_dashboard_meta(&mut payload.meta)
        .map_err(|error| error.to_string())?;
    Ok(payload)
}

#[tauri::command]
pub fn reset_database_path(state: State<'_, AppState>) -> Result<DashboardPayload, String> {
    state
        .reset_database_path()
        .map_err(|error| error.to_string())?;

    let mut payload = state
        .repository()
        .and_then(|repository| repository.build_dashboard_payload(false))
        .map_err(|error| error.to_string())?;
    state
        .populate_dashboard_meta(&mut payload.meta)
        .map_err(|error| error.to_string())?;
    Ok(payload)
}

#[tauri::command]
pub fn query_daily_usage(
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<DailyUsageSummary>, String> {
    state
        .repository()
        .and_then(|repository| repository.daily_history_between(&start_date, &end_date))
        .map_err(|error| error.to_string())
}
