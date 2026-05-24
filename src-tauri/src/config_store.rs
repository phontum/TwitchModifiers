use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub twitch: TwitchConfig,
    pub donation_alerts: DonationAlertsConfig,
    pub overlay: OverlayConfig,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub mouse_input_sfx: MouseInputSfxSettings,
    #[serde(default)]
    pub keyboard_input_sfx: KeyboardInputSfxSettings,
    pub modifiers: Vec<ModifierDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchConfig {
    pub enabled: bool,
    #[serde(default)]
    pub client_id: String,
    // TODO: later move tokens to OS keychain.
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub broadcaster_id: Option<String>,
    #[serde(default)]
    pub broadcaster_login: Option<String>,
    pub reward_id: String,
    pub reward_title: String,
    #[serde(default = "default_true")]
    pub reward_rolls_enabled: bool,
    #[serde(default = "default_true")]
    pub subscription_rolls_enabled: bool,
    #[serde(default = "default_subscription_min_tier")]
    pub subscription_min_tier: String,
    #[serde(default = "default_gift_min_count")]
    pub gift_min_count: u32,
    #[serde(default = "default_subscription_min_tier")]
    pub gift_min_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DonationAlertsConfig {
    pub enabled: bool,
    #[serde(default)]
    pub client_id: String,
    #[serde(default = "default_true")]
    pub use_builtin_client_id: bool,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default = "default_redirect_host")]
    pub redirect_host: String,
    // TODO: later move tokens to OS keychain.
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub socket_connection_token: Option<String>,
    pub min_amount: f64,
}

fn default_redirect_host() -> String {
    "127.0.0.1".to_string()
}

fn default_true() -> bool {
    true
}

fn default_subscription_min_tier() -> String {
    "2000".to_string()
}

fn default_gift_min_count() -> u32 {
    5
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_visual_layer_order() -> Vec<String> {
    vec![
        "lag".to_string(),
        "tunnel".to_string(),
        "chat".to_string(),
        "video-corner".to_string(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub monitor_index: usize,
    pub always_on_top: bool,
    pub click_through: bool,
    #[serde(default = "default_visual_layer_order")]
    pub visual_layer_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseInputSfxSettings {
    #[serde(default = "default_mouse_volume")]
    pub volume: u8,
    #[serde(default)]
    pub sounds: MouseInputSfxSounds,
}

impl Default for MouseInputSfxSettings {
    fn default() -> Self {
        Self {
            volume: default_mouse_volume(),
            sounds: MouseInputSfxSounds::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MouseInputSfxSounds {
    #[serde(default)]
    pub left_click: Vec<String>,
    #[serde(default)]
    pub right_click: Vec<String>,
    #[serde(default)]
    pub middle_click: Vec<String>,
    #[serde(default)]
    pub wheel_up: Vec<String>,
    #[serde(default)]
    pub wheel_down: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardInputSfxSettings {
    #[serde(default = "default_keyboard_volume")]
    pub volume: u8,
    #[serde(default)]
    pub sounds: Vec<String>,
}

impl Default for KeyboardInputSfxSettings {
    fn default() -> Self {
        Self {
            volume: default_keyboard_volume(),
            sounds: Vec::new(),
        }
    }
}

fn default_mouse_volume() -> u8 {
    45
}

fn default_keyboard_volume() -> u8 {
    38
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifierDefinition {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "type")]
    pub modifier_type: String,
    pub rarity: String,
    pub roll_weight: Option<f64>,
    pub color: String,
    pub enabled: bool,
    pub duration_seconds: u64,
    pub allow_repeat_while_active: bool,
    pub volume: Option<u8>,
    #[serde(default)]
    pub max_active_videos_enabled: bool,
    #[serde(default = "default_max_active_videos")]
    pub max_active_videos: u8,
    pub variants: Option<Vec<ModifierVariant>>,
}

fn default_max_active_videos() -> u8 {
    4
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifierVariant {
    pub video_id: Option<String>,
    pub video_url: Option<String>,
    pub audio_url: Option<String>,
    pub title: Option<String>,
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir failed: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("create config dir failed: {error}"))?;
    Ok(dir.join("app-config.json"))
}

pub fn load(app: &AppHandle) -> Result<Option<AppConfig>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("read config failed: {error}"))?;
    let config =
        serde_json::from_str(&raw).map_err(|error| format!("parse config failed: {error}"))?;
    Ok(Some(config))
}

pub fn save(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("serialize config failed: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("write config failed: {error}"))
}
