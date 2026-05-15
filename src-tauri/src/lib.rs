mod commands;
mod config_store;
mod donationalerts;
mod input_listener;
mod oauth;
mod runtime;
mod twitch;

use runtime::RuntimeState;
use tauri::{Emitter, Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            let _ = app.emit(
                "log:append",
                runtime::make_log("warn", "Second app instance ignored"),
            );
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::list_monitors,
            commands::show_overlay,
            commands::hide_overlay,
            commands::start_runtime,
            commands::stop_runtime,
            commands::panic_stop,
            commands::test_roll,
            commands::get_pending_rolls,
            commands::ack_roll_queued,
            commands::connect_twitch,
            commands::disconnect_twitch,
            commands::connect_donationalerts,
            commands::disconnect_donationalerts,
            commands::append_log,
            commands::add_user_sound_files,
            commands::remove_user_sound_file,
        ])
        .setup(|app| {
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_ignore_cursor_events(true);
            }
            input_listener::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle();
                let state = app.state::<RuntimeState>();
                let _ = commands::stop_runtime_inner(app, &state);
                if let Some(overlay) = app.get_webview_window("overlay") {
                    let _ = overlay.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
