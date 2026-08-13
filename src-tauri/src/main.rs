use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tokenledger::app_state::AppState;
use tokenledger::commands;

#[cfg(target_os = "macos")]
fn build_app_menu<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(handle, "TokenLedger")
        .about(None)
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?,
        )
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?,
        )
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(handle, "Help")
        .about(None)
        .build()?;

    MenuBuilder::new(handle)
        .items(&[&file_menu, &edit_menu, &window_menu, &help_menu])
        .build()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::detect())
        .setup(|app| {
            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                let _ = app.emit("open-settings", ());
            }
        })
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
            commands::reset_database_path,
            commands::set_model_pricing_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

