use std::env;

use tokenledger::app_state::AppState;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let include_sync_preview = args.iter().any(|arg| arg == "--include-sync-preview");
    let run_sync = args.iter().any(|arg| arg == "--run-sync");
    let force_full_rescan = args.iter().any(|arg| arg == "--force-full-rescan");

    let state = AppState::detect();
    let repository = state.repository()?;

    let payload = if run_sync {
        repository.sync_and_build_dashboard(force_full_rescan)?
    } else {
        repository.build_dashboard_payload(include_sync_preview)?
    };
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}
