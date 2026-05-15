use crate::config_store::{self, AppConfig};
use crate::oauth::{random_token, wait_for_fragment_token};
use crate::runtime::{emit_roll_requested, make_log, RuntimeState, TriggerEvent};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const DA_AUTH_URL: &str = "https://www.donationalerts.com/oauth/authorize";
const DA_USER_URL: &str = "https://www.donationalerts.com/api/v1/user/oauth";
const DA_CENTRIFUGE_SUBSCRIBE_URL: &str =
    "https://www.donationalerts.com/api/v1/centrifuge/subscribe";
const DA_CENTRIFUGE_WS_URL: &str = "wss://centrifugo.donationalerts.com/connection/websocket";
const DA_REDIRECT_PORT: u16 = 17893;
const BUILTIN_DA_CLIENT_ID: &str = "18945";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DonationEvent {
    pub id: String,
    pub viewer_name: Option<String>,
    pub amount: f64,
    pub currency: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserResponse {
    data: DaUser,
}

#[derive(Debug, Deserialize)]
struct DaUser {
    id: u64,
    socket_connection_token: String,
}

pub async fn connect(app: AppHandle) -> Result<(), String> {
    let mut config = config_store::load(&app)?
        .ok_or_else(|| "Save config before connecting DonationAlerts".to_string())?;
    let configured_client_id = config.donation_alerts.client_id.trim();
    let builtin_client_id = BUILTIN_DA_CLIENT_ID.trim();
    let client_id = if !configured_client_id.is_empty() {
        configured_client_id
    } else if config.donation_alerts.use_builtin_client_id && !builtin_client_id.is_empty() {
        builtin_client_id
    } else {
        ""
    }
    .to_string();
    if client_id.is_empty() {
        return Err("DonationAlerts Client ID is not configured".to_string());
    }

    let redirect_host = match config.donation_alerts.redirect_host.as_str() {
        "localhost" => "localhost",
        _ => "127.0.0.1",
    };
    let redirect_uri = format!("http://{redirect_host}:{DA_REDIRECT_PORT}/donationalerts/callback");
    let state = random_token(32);
    let scopes = "oauth-donation-index oauth-donation-subscribe oauth-user-show";
    let auth_url = format!(
        "{DA_AUTH_URL}?response_type=token&client_id={}&redirect_uri={}&scope={}&state={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scopes),
        urlencoding::encode(&state),
    );

    app.emit(
        "log:append",
        make_log("info", "Opening DonationAlerts OAuth in browser"),
    )
    .map_err(|error| error.to_string())?;
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|error| format!("open DonationAlerts OAuth failed: {error}"))?;

    let access_token = wait_for_fragment_token(DA_REDIRECT_PORT, state).await?;
    let user = fetch_user(&access_token).await?;

    config.donation_alerts.enabled = true;
    config.donation_alerts.access_token = Some(access_token);
    config.donation_alerts.refresh_token = None;
    config.donation_alerts.user_id = Some(user.id.to_string());
    config.donation_alerts.socket_connection_token = Some(user.socket_connection_token);
    config_store::save(&app, &config)?;
    app.emit("app:config-loaded", config)
        .map_err(|error| error.to_string())?;
    app.emit("log:append", make_log("info", "DonationAlerts connected"))
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn fetch_user(access_token: &str) -> Result<DaUser, String> {
    Client::new()
        .get(DA_USER_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("DonationAlerts user request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("DonationAlerts user response failed: {error}"))?
        .json::<UserResponse>()
        .await
        .map(|response| response.data)
        .map_err(|error| format!("DonationAlerts user parse failed: {error}"))
}

pub async fn disconnect(app: AppHandle) -> Result<(), String> {
    if let Some(mut config) = config_store::load(&app)? {
        config.donation_alerts.enabled = false;
        config.donation_alerts.access_token = None;
        config.donation_alerts.refresh_token = None;
        config.donation_alerts.user_id = None;
        config.donation_alerts.socket_connection_token = None;
        config_store::save(&app, &config)?;
        app.emit("app:config-loaded", config)
            .map_err(|error| error.to_string())?;
    }
    app.emit(
        "log:append",
        make_log("info", "DonationAlerts disconnected"),
    )
    .map_err(|error| error.to_string())
}

pub async fn start_realtime(app: AppHandle, config: AppConfig) -> Result<(), String> {
    if !config.donation_alerts.enabled || config.donation_alerts.access_token.is_none() {
        app.emit(
            "log:append",
            make_log(
                "info",
                "DonationAlerts skipped: integration disabled or token missing",
            ),
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let state = app.state::<RuntimeState>();
        let old_handle = state
            .donation_task
            .lock()
            .expect("donation task poisoned")
            .take();
        if let Some(handle) = old_handle {
            handle.abort();
        }
    }

    let task_app = app.clone();
    let realtime_config = config.clone();
    let handle = tokio::spawn(async move {
        if let Err(error) = run_realtime(task_app.clone(), realtime_config.clone()).await {
            let _ = task_app.emit(
                "log:append",
                make_log("error", format!("DonationAlerts realtime error: {error}")),
            );
        }
    });
    let state = app.state::<RuntimeState>();
    *state.donation_task.lock().expect("donation task poisoned") = Some(handle);
    Ok(())
}

async fn run_realtime(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let access_token = config
        .donation_alerts
        .access_token
        .clone()
        .ok_or_else(|| "missing DonationAlerts token".to_string())?;
    let user_id =
        config.donation_alerts.user_id.clone().ok_or_else(|| {
            "missing DonationAlerts user id; reconnect DonationAlerts".to_string()
        })?;
    let socket_token = config
        .donation_alerts
        .socket_connection_token
        .clone()
        .ok_or_else(|| {
            "missing DonationAlerts socket token; reconnect DonationAlerts".to_string()
        })?;

    let channel = format!("$alerts:donation_{user_id}");
    let (ws, _) = connect_async(DA_CENTRIFUGE_WS_URL)
        .await
        .map_err(|error| format!("DonationAlerts Centrifugo connect failed: {error}"))?;
    let (mut write, mut read) = ws.split();
    write
        .send(Message::Text(
            json!({ "params": { "token": socket_token }, "id": 1 }).to_string(),
        ))
        .await
        .map_err(|error| format!("DonationAlerts Centrifugo auth send failed: {error}"))?;

    let client_id = loop {
        let Some(message) = read.next().await else {
            return Err("DonationAlerts Centrifugo closed before auth".to_string());
        };
        let Message::Text(text) = message.map_err(|error| error.to_string())? else {
            continue;
        };
        let payload: Value = serde_json::from_str(&text)
            .map_err(|error| format!("Centrifugo auth JSON failed: {error}"))?;
        if let Some(client) = payload.pointer("/result/client").and_then(Value::as_str) {
            break client.to_string();
        }
        if let Some(error) = payload.get("error") {
            return Err(format!("Centrifugo auth error: {error}"));
        }
    };

    let sub_token = subscribe_channel(&access_token, &channel, &client_id).await?;
    write
        .send(Message::Text(
            json!({ "params": { "channel": channel, "token": sub_token }, "method": 1, "id": 2 })
                .to_string(),
        ))
        .await
        .map_err(|error| format!("DonationAlerts Centrifugo subscribe send failed: {error}"))?;
    app.emit(
        "log:append",
        make_log("info", "DonationAlerts realtime listener started"),
    )
    .map_err(|error| error.to_string())?;

    while let Some(message) = read.next().await {
        let Message::Text(text) = message.map_err(|error| error.to_string())? else {
            continue;
        };
        let payload: Value = serde_json::from_str(&text)
            .map_err(|error| format!("Centrifugo message JSON failed: {error}"))?;
        if let Some(donation) = find_donation_event(&payload) {
            if donation.amount < config.donation_alerts.min_amount {
                app.emit(
                    "log:append",
                    make_log(
                        "info",
                        format!(
                            "DonationAlerts realtime donation {} ignored: amount below minimum",
                            donation.id
                        ),
                    ),
                )
                .map_err(|error| error.to_string())?;
                continue;
            }
            app.emit(
                "log:append",
                make_log(
                    "info",
                    format!(
                        "DonationAlerts realtime donation {} triggers roll",
                        donation.id
                    ),
                ),
            )
            .map_err(|error| error.to_string())?;
            emit_donation_roll(&app, &donation, config.donation_alerts.min_amount)?;
        }
    }
    Err("DonationAlerts Centrifugo connection closed".to_string())
}

async fn subscribe_channel(
    access_token: &str,
    channel: &str,
    client_id: &str,
) -> Result<String, String> {
    let body = json!({ "channels": [channel], "client": client_id });
    let response = Client::new()
        .post(DA_CENTRIFUGE_SUBSCRIBE_URL)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("DonationAlerts subscribe request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("DonationAlerts subscribe response failed: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("DonationAlerts subscribe parse failed: {error}"))?;
    response
        .get("channels")
        .and_then(Value::as_array)
        .and_then(|channels| channels.first())
        .and_then(|item| item.get("token"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("DonationAlerts subscribe token missing: {response}"))
}

fn find_donation_event(value: &Value) -> Option<DonationEvent> {
    if let Some(donation) = parse_donation(value) {
        return Some(donation);
    }
    match value {
        Value::Object(map) => map.values().find_map(find_donation_event),
        Value::Array(items) => items.iter().find_map(find_donation_event),
        _ => None,
    }
}

fn parse_donation(value: &Value) -> Option<DonationEvent> {
    let id = value.get("id")?.to_string().trim_matches('"').to_string();
    let amount = value
        .get("amount")
        .or_else(|| value.get("amount_main"))
        .or_else(|| value.get("amount_in_user_currency"))
        .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
        .unwrap_or(0.0);
    let viewer_name = value
        .get("username")
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let currency = value
        .get("currency")
        .or_else(|| value.get("currency_code"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    Some(DonationEvent {
        id,
        viewer_name,
        amount,
        currency,
        message,
    })
}

pub fn emit_donation_roll(
    app: &AppHandle,
    donation: &DonationEvent,
    min_amount: f64,
) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let event_id = format!("donationalerts-{}", donation.id);
    if !state.remember_event(&event_id) {
        return Ok(());
    }
    let trigger = TriggerEvent {
        id: event_id,
        source: "donationalerts".to_string(),
        viewer_name: donation.viewer_name.clone(),
        amount: Some(donation.amount),
        currency: donation.currency.clone(),
        reward_id: None,
        reward_title: None,
        message: donation.message.clone(),
        duration_multiplier: Some(duration_multiplier_from_amount(donation.amount, min_amount)),
        created_at: Utc::now().to_rfc3339(),
    };
    emit_roll_requested(app, trigger)
}

fn duration_multiplier_from_amount(amount: f64, min_amount: f64) -> u32 {
    if min_amount <= 0.0 {
        return 1;
    }
    (amount / min_amount).floor().max(1.0) as u32
}
