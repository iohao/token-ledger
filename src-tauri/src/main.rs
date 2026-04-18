use tokenledger::app_state::AppState;
use tokenledger::commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::detect())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_dashboard,
            commands::get_sync_preview,
            commands::start_sync,
            commands::is_sync_running,
            commands::get_sync_status,
            commands::get_sync_progress,
            commands::get_app_meta,
            commands::open_source_repository,
            commands::query_daily_usage,
            commands::set_database_path,
            commands::reset_database_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
