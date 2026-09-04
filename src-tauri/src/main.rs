// Prevents the console window from appearing alongside the release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{LogicalSize, Manager, Size};

/// Native, offline entry point for the Indianapolis Grand Prix circuit.
/// The window is spawned at a fixed 1600x900 logical size and centred; the
/// webview loads the bundled front end only, with no network access.
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(Size::Logical(LogicalSize {
                    width: 1600.0,
                    height: 900.0,
                }));
                let _ = window.center();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the Indianapolis Grand Prix window could not be created");
}
