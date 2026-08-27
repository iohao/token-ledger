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

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(
            &MenuItemBuilder::with_id("nav-overview", "Overview")
                .accelerator("CmdOrCtrl+1")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-daily-detail", "Daily Detail")
                .accelerator("CmdOrCtrl+2")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-monthly-history", "Monthly History")
                .accelerator("CmdOrCtrl+3")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-monthly-detail", "Monthly Detail")
                .accelerator("CmdOrCtrl+4")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-relay-pricing", "Relay Pricing")
                .accelerator("CmdOrCtrl+5")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-codex-plugin", "Codex Plugin")
                .accelerator("CmdOrCtrl+6")
                .build(handle)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
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

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(
            &MenuItemBuilder::with_id("nav-overview", "Overview")
                .accelerator("CmdOrCtrl+1")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-daily-detail", "Daily Detail")
                .accelerator("CmdOrCtrl+2")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-monthly-history", "Monthly History")
                .accelerator("CmdOrCtrl+3")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-monthly-detail", "Monthly Detail")
                .accelerator("CmdOrCtrl+4")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-relay-pricing", "Relay Pricing")
                .accelerator("CmdOrCtrl+5")
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-codex-plugin", "Codex Plugin")
                .accelerator("CmdOrCtrl+6")
                .build(handle)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(handle, "Help").about(None).build()?;

    MenuBuilder::new(handle)
        .items(&[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
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
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                let _ = app.emit("open-settings", ());
            }
            "nav-overview" => {
                let _ = app.emit("navigate-tab", "overview");
            }
            "nav-daily-detail" => {
                let _ = app.emit("navigate-tab", "dailyDetail");
            }
            "nav-monthly-history" => {
                let _ = app.emit("navigate-tab", "monthlyHistory");
            }
            "nav-monthly-detail" => {
                let _ = app.emit("navigate-tab", "monthlyDetail");
            }
            "nav-relay-pricing" => {
                let _ = app.emit("navigate-tab", "relayPricing");
            }
            "nav-codex-plugin" => {
                let _ = app.emit("navigate-tab", "codexPlugin");
            }
            _ => {}
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
            commands::set_pricing_providers,
            commands::get_plugin_config,
            commands::set_plugin_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
