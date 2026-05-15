use crate::config_store::{self, AppConfig};
use crate::donationalerts;
use crate::runtime::{emit_roll_requested, make_log, RuntimeState, TriggerEvent};
use crate::twitch;
use chrono::Utc;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMonitor {
    pub index: usize,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Option<AppConfig>, String> {
    config_store::load(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    config_store::save(&app, &config)?;
    app.emit("app:config-loaded", config)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<DisplayMonitor>, String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(Vec::new());
    };

    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let position = monitor.position();
            let size = monitor.size();
            DisplayMonitor {
                index,
                name: monitor.name().map(ToOwned::to_owned),
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect())
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        move_overlay_to_configured_monitor(&app, &overlay)?;
        overlay.show().map_err(|error| error.to_string())?;
        overlay.set_focus().map_err(|error| error.to_string())?;
        let _ = overlay.set_always_on_top(true);
        let _ = overlay.set_ignore_cursor_events(true);
    }
    Ok(())
}

fn move_overlay_to_configured_monitor(
    app: &AppHandle,
    overlay: &tauri::WebviewWindow,
) -> Result<(), String> {
    let monitor_index = config_store::load(app)?
        .map(|config| config.overlay.monitor_index)
        .unwrap_or(0);
    let monitors = overlay
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let Some(monitor) = monitors.get(monitor_index).or_else(|| monitors.first()) else {
        return Ok(());
    };

    let position = monitor.position();
    let size = monitor.size();
    let _ = overlay.set_fullscreen(false);
    overlay
        .set_position(Position::Physical(PhysicalPosition::new(
            position.x, position.y,
        )))
        .map_err(|error| error.to_string())?;
    overlay
        .set_size(Size::Physical(PhysicalSize::new(size.width, size.height)))
        .map_err(|error| error.to_string())?;
    overlay
        .set_fullscreen(true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_runtime(
    app: AppHandle,
    state: tauri::State<'_, RuntimeState>,
) -> Result<(), String> {
    *state.is_playing.lock().expect("runtime state poisoned") = true;
    show_overlay(app.clone())?;
    app.emit("runtime:started", ())
        .map_err(|error| error.to_string())?;
    app.emit("log:append", make_log("info", "Runtime started"))
        .map_err(|error| error.to_string())?;

    if let Some(config) = config_store::load(&app)? {
        twitch::start_listener(app.clone(), config.clone()).await?;
        donationalerts::start_realtime(app.clone(), config).await?;
    }

    Ok(())
}

#[tauri::command]
pub fn stop_runtime(app: AppHandle, state: tauri::State<'_, RuntimeState>) -> Result<(), String> {
    stop_runtime_inner(&app, &state)?;
    app.emit("log:append", make_log("info", "Runtime stopped"))
        .map_err(|error| error.to_string())?;
    hide_overlay(app)
}

pub fn stop_runtime_inner(app: &AppHandle, state: &RuntimeState) -> Result<(), String> {
    *state.is_playing.lock().expect("runtime state poisoned") = false;
    if let Some(handle) = state
        .twitch_task
        .lock()
        .expect("twitch task poisoned")
        .take()
    {
        handle.abort();
    }
    if let Some(handle) = state
        .twitch_chat_task
        .lock()
        .expect("twitch chat task poisoned")
        .take()
    {
        handle.abort();
    }
    if let Some(handle) = state
        .donation_task
        .lock()
        .expect("donation task poisoned")
        .take()
    {
        handle.abort();
    }
    app.emit("modifier:stop-all", ())
        .map_err(|error| error.to_string())?;
    state.clear_pending_rolls();
    app.emit("runtime:stopped", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn panic_stop(app: AppHandle, state: tauri::State<'_, RuntimeState>) -> Result<(), String> {
    stop_runtime_inner(&app, &state)?;
    hide_overlay(app.clone())?;
    app.emit("modifier:stop-all", ())
        .map_err(|error| error.to_string())?;
    app.emit("log:append", make_log("warn", "Panic Stop"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn test_roll(app: AppHandle) -> Result<(), String> {
    let trigger = TriggerEvent {
        id: uuid::Uuid::new_v4().to_string(),
        source: "test".to_string(),
        viewer_name: None,
        amount: None,
        currency: None,
        reward_id: None,
        reward_title: None,
        message: Some("Manual Test Roll".to_string()),
        duration_multiplier: None,
        created_at: Utc::now().to_rfc3339(),
    };
    emit_roll_requested(&app, trigger)
}

#[tauri::command]
pub fn get_pending_rolls(
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<TriggerEvent>, String> {
    Ok(state.drain_pending_rolls())
}

#[tauri::command]
pub fn ack_roll_queued(
    state: tauri::State<'_, RuntimeState>,
    trigger_id: String,
) -> Result<(), String> {
    state.ack_pending_roll(&trigger_id);
    Ok(())
}

#[tauri::command]
pub async fn connect_twitch(app: AppHandle) -> Result<(), String> {
    twitch::connect(app).await
}

#[tauri::command]
pub async fn disconnect_twitch(app: AppHandle) -> Result<(), String> {
    twitch::disconnect(app).await
}

#[tauri::command]
pub async fn connect_donationalerts(app: AppHandle) -> Result<(), String> {
    donationalerts::connect(app).await
}

#[tauri::command]
pub async fn disconnect_donationalerts(app: AppHandle) -> Result<(), String> {
    donationalerts::disconnect(app).await
}

#[tauri::command]
pub fn append_log(app: AppHandle, level: String, message: String) -> Result<(), String> {
    app.emit("log:append", make_log(&level, message))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_user_sound_files(app: AppHandle, category: String) -> Result<Vec<String>, String> {
    let files = rfd::FileDialog::new()
        .add_filter("MP3 audio", &["mp3"])
        .pick_files()
        .unwrap_or_default();

    let target_dir = user_sound_dir(&app, &category)?;
    let mut copied = Vec::new();

    for source in files {
        if !is_mp3(&source) {
            app.emit(
                "log:append",
                make_log(
                    "warn",
                    format!("Skipped non-mp3 file: {}", source.display()),
                ),
            )
            .map_err(|error| error.to_string())?;
            continue;
        }

        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "selected file has no valid file name".to_string())?;
        let target = unique_target_path(&target_dir, file_name);
        fs::copy(&source, &target).map_err(|error| format!("copy mp3 failed: {error}"))?;
        copied.push(target.to_string_lossy().to_string());
    }

    Ok(copied)
}

#[tauri::command]
pub fn remove_user_sound_file(app: AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir failed: {error}"))?;

    if !target.starts_with(app_data.join("user-sounds")) {
        return Err("refusing to remove a file outside user-sounds".to_string());
    }

    if target.exists() {
        fs::remove_file(target).map_err(|error| format!("remove mp3 failed: {error}"))?;
    }
    Ok(())
}

fn user_sound_dir(app: &AppHandle, category: &str) -> Result<PathBuf, String> {
    let safe_category = match category {
        "mouse" => "mouse",
        "keyboard" => "keyboard",
        _ => return Err("unknown user sound category".to_string()),
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir failed: {error}"))?
        .join("user-sounds")
        .join(safe_category);
    fs::create_dir_all(&dir).map_err(|error| format!("create user-sounds dir failed: {error}"))?;
    Ok(dir)
}

fn is_mp3(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("mp3"))
        .unwrap_or(false)
}

fn unique_target_path(dir: &Path, file_name: &str) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("sound");
    let extension = original
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp3");

    let mut candidate = dir.join(format!("{stem}.{extension}"));
    let mut index = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{index}.{extension}"));
        index += 1;
    }
    candidate
}
