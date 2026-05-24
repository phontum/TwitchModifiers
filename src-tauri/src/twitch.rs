use crate::config_store::{self, AppConfig};
use crate::runtime::{emit_roll_requested, make_log, ChatMessageEvent, RuntimeState, TriggerEvent};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TWITCH_DEVICE_URL: &str = "https://id.twitch.tv/oauth2/device";
const TWITCH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const TWITCH_USERS_URL: &str = "https://api.twitch.tv/helix/users";
const TWITCH_EVENTSUB_URL: &str = "https://api.twitch.tv/helix/eventsub/subscriptions";
const TWITCH_WS_URL: &str = "wss://eventsub.wss.twitch.tv/ws";
const TWITCH_IRC_WS_URL: &str = "wss://irc-ws.chat.twitch.tv:443";

const TWITCH_RECONNECT_MIN_SECONDS: u64 = 3;
const TWITCH_RECONNECT_MAX_SECONDS: u64 = 60;

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct UsersResponse {
    data: Vec<TwitchUser>,
}

#[derive(Debug, Deserialize)]
struct TwitchUser {
    id: String,
    login: String,
}

pub async fn connect(app: AppHandle) -> Result<(), String> {
    let mut config = config_store::load(&app)?
        .ok_or_else(|| "Save config before connecting Twitch".to_string())?;

    let client_id = config.twitch.client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Twitch Client ID is required".to_string());
    }

    let scopes = "channel:read:redemptions channel:read:subscriptions chat:read";
    let device = request_device_code(&client_id, scopes).await?;

    app.emit(
        "log:append",
        make_log(
            "info",
            format!(
                "Opening Twitch device authorization. Code: {}",
                device.user_code
            ),
        ),
    )
    .map_err(|error| error.to_string())?;

    app.opener()
        .open_url(device.verification_uri.clone(), None::<&str>)
        .map_err(|error| format!("open Twitch device authorization failed: {error}"))?;

    let token = wait_for_device_token(&client_id, scopes, &device).await?;

    let users = Client::new()
        .get(TWITCH_USERS_URL)
        .header("Client-Id", &client_id)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| format!("Twitch user request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Twitch user response failed: {error}"))?
        .json::<UsersResponse>()
        .await
        .map_err(|error| format!("Twitch user parse failed: {error}"))?;

    let broadcaster = users
        .data
        .first()
        .ok_or_else(|| "Twitch user response is empty".to_string())?;
    let broadcaster_id = broadcaster.id.clone();
    let broadcaster_login = broadcaster.login.clone();

    config.twitch.enabled = true;
    config.twitch.access_token = Some(token.access_token);
    config.twitch.refresh_token = token.refresh_token;
    config.twitch.broadcaster_id = Some(broadcaster_id);
    config.twitch.broadcaster_login = Some(broadcaster_login);

    config_store::save(&app, &config)?;

    app.emit("app:config-loaded", config.clone())
        .map_err(|error| error.to_string())?;

    app.emit("log:append", make_log("info", "Twitch connected"))
        .map_err(|error| error.to_string())?;

    start_listener(app, config).await
}

async fn request_device_code(client_id: &str, scopes: &str) -> Result<DeviceResponse, String> {
    let response = Client::new()
        .post(TWITCH_DEVICE_URL)
        .form(&[("client_id", client_id), ("scopes", scopes)])
        .send()
        .await
        .map_err(|error| format!("Twitch device request failed: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Twitch device response read failed: {error}"))?;

    if !status.is_success() {
        return Err(format!("Twitch device response failed: {status}: {body}"));
    }

    serde_json::from_str::<DeviceResponse>(&body)
        .map_err(|error| format!("Twitch device parse failed: {error}; body={body}"))
}

async fn wait_for_device_token(
    client_id: &str,
    scopes: &str,
    device: &DeviceResponse,
) -> Result<TokenResponse, String> {
    let started = std::time::Instant::now();
    let mut interval = device.interval.max(5);

    loop {
        if started.elapsed().as_secs() > device.expires_in {
            return Err("Twitch device authorization expired".to_string());
        }

        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let response = Client::new()
            .post(TWITCH_TOKEN_URL)
            .form(&[
                ("client_id", client_id),
                ("scope", scopes),
                ("device_code", device.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|error| format!("Twitch device token request failed: {error}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("Twitch device token response read failed: {error}"))?;

        if status.is_success() {
            return serde_json::from_str::<TokenResponse>(&body).map_err(|error| {
                format!("Twitch device token parse failed: {error}; body={body}")
            });
        }

        if body.contains("authorization_pending") {
            continue;
        }

        if body.contains("slow_down") {
            interval += 5;
            continue;
        }

        return Err(format!(
            "Twitch device token response failed: {status}: {body}"
        ));
    }
}

pub async fn disconnect(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<RuntimeState>();
        let old_handle = state
            .twitch_task
            .lock()
            .expect("twitch task poisoned")
            .take();
        let old_chat_handle = state
            .twitch_chat_task
            .lock()
            .expect("twitch chat task poisoned")
            .take();

        if let Some(handle) = old_handle {
            handle.abort();
        }

        if let Some(handle) = old_chat_handle {
            handle.abort();
        }
    }

    if let Some(mut config) = config_store::load(&app)? {
        config.twitch.enabled = false;
        config.twitch.access_token = None;
        config.twitch.refresh_token = None;
        config.twitch.broadcaster_id = None;
        config.twitch.broadcaster_login = None;

        config_store::save(&app, &config)?;

        app.emit("app:config-loaded", config)
            .map_err(|error| error.to_string())?;
    }

    app.emit("log:append", make_log("info", "Twitch disconnected"))
        .map_err(|error| error.to_string())
}

async fn disable_twitch_after_auth_error(app: &AppHandle, reason: &str) -> Result<(), String> {
    if let Some(mut config) = config_store::load(app)? {
        config.twitch.enabled = false;
        config.twitch.access_token = None;
        config.twitch.refresh_token = None;

        config_store::save(app, &config)?;

        app.emit("app:config-loaded", config)
            .map_err(|error| error.to_string())?;
    }

    app.emit(
        "log:append",
        make_log(
            "error",
            format!("Twitch authorization expired or was revoked: {reason}. Reconnect Twitch."),
        ),
    )
    .map_err(|error| error.to_string())
}

fn is_twitch_auth_error(error: &str) -> bool {
    error.contains("Twitch OAuth token invalid")
        || error.contains("Login authentication failed")
        || error.contains("Invalid OAuth token")
        || error.contains("401 Unauthorized")
}

pub async fn start_listener(app: AppHandle, config: AppConfig) -> Result<(), String> {
    if !config.twitch.enabled || config.twitch.access_token.is_none() {
        app.emit(
            "log:append",
            make_log(
                "info",
                "Twitch listener skipped: integration disabled or token missing",
            ),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    }

    start_chat_listener(app.clone(), config.clone())?;

    let state = app.state::<RuntimeState>();
    let mut task_guard = state.twitch_task.lock().expect("twitch task poisoned");

    if let Some(handle) = task_guard.as_ref() {
        if !handle.is_finished() {
            app.emit(
                "log:append",
                make_log(
                    "warn",
                    "Twitch listener already running; start request ignored",
                ),
            )
            .map_err(|error| error.to_string())?;

            return Ok(());
        }
    }

    if !config.twitch.reward_rolls_enabled && !config.twitch.subscription_rolls_enabled {
        app.emit(
            "log:append",
            make_log("info", "Twitch EventSub skipped: reward and subscription rolls disabled"),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    }

    if let Some(old_handle) = task_guard.take() {
        old_handle.abort();
    }

    let task_app = app.clone();

    let handle = tokio::spawn(async move {
        if let Err(error) = run_eventsub_with_reconnect(task_app.clone(), config).await {
            let _ = task_app.emit(
                "log:append",
                make_log("error", format!("Twitch listener stopped: {error}")),
            );
        }
    });

    *task_guard = Some(handle);

    drop(task_guard);

    app.emit("log:append", make_log("info", "Twitch listener started"))
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn start_chat_listener(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let Some(token) = config.twitch.access_token.clone() else {
        return Ok(());
    };

    let Some(login) = config.twitch.broadcaster_login.clone() else {
        app.emit(
            "log:append",
            make_log(
                "warn",
                "Twitch chat skipped: reconnect Twitch to grant chat:read and save channel login",
            ),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    };

    let state = app.state::<RuntimeState>();
    let mut task_guard = state
        .twitch_chat_task
        .lock()
        .expect("twitch chat task poisoned");

    if let Some(handle) = task_guard.as_ref() {
        if !handle.is_finished() {
            return Ok(());
        }
    }

    if let Some(old_handle) = task_guard.take() {
        old_handle.abort();
    }

    let task_app = app.clone();
    let handle = tokio::spawn(async move {
        if let Err(error) = run_chat_with_reconnect(task_app.clone(), token, login).await {
            let _ = task_app.emit(
                "log:append",
                make_log("error", format!("Twitch chat listener stopped: {error}")),
            );
        }
    });

    *task_guard = Some(handle);

    app.emit(
        "log:append",
        make_log("info", "Twitch chat listener started"),
    )
    .map_err(|error| error.to_string())
}

async fn run_chat_with_reconnect(
    app: AppHandle,
    token: String,
    login: String,
) -> Result<(), String> {
    let mut reconnect_delay = TWITCH_RECONNECT_MIN_SECONDS;

    loop {
        let result = run_chat_once(app.clone(), token.clone(), login.clone()).await;

        match result {
            Ok(()) => {
                app.emit(
                    "log:append",
                    make_log(
                        "warn",
                        format!("Twitch chat WebSocket ended. Reconnecting in {reconnect_delay}s"),
                    ),
                )
                .map_err(|error| error.to_string())?;
            }
            Err(error) => {
                if is_twitch_auth_error(&error) {
                    disable_twitch_after_auth_error(&app, &error).await?;
                    return Err(error);
                }

                app.emit(
                    "log:append",
                    make_log(
                        "error",
                        format!(
                            "Twitch chat WebSocket error: {error}. Reconnecting in {reconnect_delay}s"
                        ),
                    ),
                )
                .map_err(|emit_error| emit_error.to_string())?;
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay)).await;
        reconnect_delay = (reconnect_delay * 2).min(TWITCH_RECONNECT_MAX_SECONDS);
    }
}

async fn run_chat_once(app: AppHandle, token: String, login: String) -> Result<(), String> {
    let channel = login.trim().to_lowercase();
    if channel.is_empty() {
        return Err("missing Twitch channel login".to_string());
    }

    let (ws, _) = connect_async(TWITCH_IRC_WS_URL)
        .await
        .map_err(|error| format!("Twitch chat WebSocket failed: {error}"))?;

    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(format!("PASS oauth:{token}")))
        .await
        .map_err(|error| format!("Twitch chat PASS failed: {error}"))?;
    write
        .send(Message::Text(format!("NICK {channel}")))
        .await
        .map_err(|error| format!("Twitch chat NICK failed: {error}"))?;
    write
        .send(Message::Text(
            "CAP REQ :twitch.tv/tags twitch.tv/commands".to_string(),
        ))
        .await
        .map_err(|error| format!("Twitch chat CAP failed: {error}"))?;
    write
        .send(Message::Text(format!("JOIN #{channel}")))
        .await
        .map_err(|error| format!("Twitch chat JOIN failed: {error}"))?;

    app.emit(
        "log:append",
        make_log("info", format!("Twitch chat joined #{channel}")),
    )
    .map_err(|error| error.to_string())?;

    while let Some(message) = read.next().await {
        let message = message.map_err(|error| format!("Twitch chat message failed: {error}"))?;

        match message {
            Message::Text(text) => {
                for line in text.lines() {
                    if line.starts_with("PING ") {
                        write
                            .send(Message::Text("PONG :tmi.twitch.tv".to_string()))
                            .await
                            .map_err(|error| format!("Twitch chat PONG failed: {error}"))?;
                        continue;
                    }

                    if line.contains(" NOTICE ") {
                        let notice = irc_trailing(line);
                        if is_twitch_auth_error(&notice) {
                            return Err(notice);
                        }

                        app.emit(
                            "log:append",
                            make_log("warn", format!("Twitch chat notice: {notice}")),
                        )
                        .map_err(|error| error.to_string())?;
                        continue;
                    }

                    if let Some(chat_event) = parse_irc_privmsg(line) {
                        app.emit("chat:message", chat_event)
                            .map_err(|error| error.to_string())?;
                    }
                }
            }
            Message::Ping(payload) => {
                write
                    .send(Message::Pong(payload))
                    .await
                    .map_err(|error| format!("Twitch chat pong failed: {error}"))?;
            }
            Message::Close(frame) => {
                app.emit(
                    "log:append",
                    make_log("warn", format!("Twitch chat close frame: {frame:?}")),
                )
                .map_err(|error| error.to_string())?;
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

fn parse_irc_privmsg(line: &str) -> Option<ChatMessageEvent> {
    let (tags_raw, rest) = line.strip_prefix('@')?.split_once(' ')?;
    let tags = parse_irc_tags(tags_raw);
    let (_, message_part) = rest.split_once(" PRIVMSG ")?;
    let (_, message) = message_part.split_once(" :")?;

    let fallback_name = rest
        .strip_prefix(':')
        .and_then(|value| value.split_once('!'))
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| "chat".to_string());

    Some(ChatMessageEvent {
        id: tags
            .get("id")
            .cloned()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        source: "twitch".to_string(),
        viewer_name: tags
            .get("display-name")
            .filter(|name| !name.is_empty())
            .cloned()
            .unwrap_or(fallback_name),
        message: message.to_string(),
        created_at: Utc::now().to_rfc3339(),
    })
}

fn irc_trailing(line: &str) -> String {
    line.split_once(" :")
        .map(|(_, trailing)| trailing.to_string())
        .unwrap_or_else(|| line.to_string())
}

fn parse_irc_tags(raw: &str) -> HashMap<String, String> {
    raw.split(';')
        .filter_map(|tag| {
            let (key, value) = tag.split_once('=')?;
            Some((key.to_string(), value.replace("\\s", " ")))
        })
        .collect()
}

async fn run_eventsub_with_reconnect(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let mut reconnect_delay = TWITCH_RECONNECT_MIN_SECONDS;

    loop {
        let result = run_eventsub_once(app.clone(), config.clone()).await;

        match result {
            Ok(()) => {
                app.emit(
                    "log:append",
                    make_log(
                        "warn",
                        format!(
                            "Twitch EventSub WebSocket ended. Reconnecting in {reconnect_delay}s"
                        ),
                    ),
                )
                .map_err(|error| error.to_string())?;
            }
            Err(error) => {
                if is_twitch_auth_error(&error) {
                    disable_twitch_after_auth_error(&app, &error).await?;
                    return Err(error);
                }

                app.emit(
                    "log:append",
                    make_log(
                        "error",
                        format!(
                            "Twitch EventSub WebSocket error: {error}. Reconnecting in {reconnect_delay}s"
                        ),
                    ),
                )
                .map_err(|emit_error| emit_error.to_string())?;
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(reconnect_delay)).await;

        reconnect_delay = (reconnect_delay * 2).min(TWITCH_RECONNECT_MAX_SECONDS);
    }
}

async fn run_eventsub_once(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let client_id = config.twitch.client_id.trim().to_string();

    if client_id.is_empty() {
        return Err("missing Twitch client id".to_string());
    }

    let token = config
        .twitch
        .access_token
        .clone()
        .ok_or_else(|| "missing Twitch token".to_string())?;

    let broadcaster_id = config
        .twitch
        .broadcaster_id
        .clone()
        .ok_or_else(|| "missing Twitch broadcaster id".to_string())?;

    let configured_reward_id = config.twitch.reward_id.trim().to_string();
    let configured_reward_title = config.twitch.reward_title.trim().to_string();

    app.emit(
        "log:append",
        make_log(
            "info",
            format!(
                "Twitch EventSub connecting: broadcaster_id={broadcaster_id}, reward_id='{configured_reward_id}', reward_title='{configured_reward_title}'"
            ),
        ),
    )
    .map_err(|error| error.to_string())?;

    let (ws, _) = connect_async(TWITCH_WS_URL)
        .await
        .map_err(|error| format!("Twitch EventSub WebSocket failed: {error}"))?;

    let (mut write, mut read) = ws.split();

    app.emit(
        "log:append",
        make_log("info", "Twitch EventSub WebSocket connected"),
    )
    .map_err(|error| error.to_string())?;

    while let Some(message) = read.next().await {
        let message = message.map_err(|error| format!("Twitch WS message failed: {error}"))?;

        match message {
            Message::Text(text) => {
                let text = text.to_string();

                let payload: Value = serde_json::from_str(&text)
                    .map_err(|error| format!("Twitch WS JSON failed: {error}; text={text}"))?;

                let message_type = payload
                    .pointer("/metadata/message_type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();

                match message_type {
                    "session_welcome" => {
                        let session_id = payload
                            .pointer("/payload/session/id")
                            .and_then(Value::as_str)
                            .ok_or_else(|| {
                                format!("Twitch session_welcome missing session id: {payload}")
                            })?;

                        if config.twitch.reward_rolls_enabled {
                            let custom_subscription_response = subscribe_redemptions(
                                &client_id,
                                &token,
                                &broadcaster_id,
                                configured_reward_id.as_str(),
                                session_id,
                            )
                            .await?;

                            app.emit(
                                "log:append",
                                make_log(
                                    "info",
                                    format!(
                                        "Twitch custom reward subscription created: {}",
                                        summarize_subscription_response(
                                            &custom_subscription_response,
                                            "custom"
                                        )
                                    ),
                                ),
                            )
                            .map_err(|error| error.to_string())?;

                            match subscribe_automatic_redemptions(
                                &client_id,
                                &token,
                                &broadcaster_id,
                                session_id,
                            )
                            .await
                            {
                                Ok(response) => {
                                    app.emit(
                                        "log:append",
                                        make_log(
                                            "info",
                                            format!(
                                                "Twitch automatic reward subscription created: {}",
                                                summarize_subscription_response(&response, "automatic")
                                            ),
                                        ),
                                    )
                                    .map_err(|error| error.to_string())?;
                                }
                                Err(error) => {
                                    app.emit(
                                        "log:append",
                                        make_log(
                                            "warn",
                                            format!(
                                                "Twitch automatic reward subscription skipped: {error}"
                                            ),
                                        ),
                                    )
                                    .map_err(|emit_error| emit_error.to_string())?;
                                }
                            }
                        }

                        if config.twitch.subscription_rolls_enabled {
                            for subscription_type in
                                ["channel.subscribe", "channel.subscription.gift"]
                            {
                                match subscribe_channel_subscription_event(
                                    &client_id,
                                    &token,
                                    &broadcaster_id,
                                    session_id,
                                    subscription_type,
                                )
                                .await
                                {
                                    Ok(response) => {
                                        app.emit(
                                            "log:append",
                                            make_log(
                                                "info",
                                                format!(
                                                    "Twitch subscription event created: {}",
                                                    summarize_subscription_response(
                                                        &response,
                                                        subscription_type
                                                    )
                                                ),
                                            ),
                                        )
                                        .map_err(|error| error.to_string())?;
                                    }
                                    Err(error) => {
                                        app.emit(
                                            "log:append",
                                            make_log(
                                                "warn",
                                                format!(
                                                    "Twitch subscription event skipped ({subscription_type}): {error}"
                                                ),
                                            ),
                                        )
                                        .map_err(|emit_error| emit_error.to_string())?;
                                    }
                                }
                            }
                        }
                    }

                    "session_keepalive" => {
                        app.emit("log:append", make_log("info", "Twitch EventSub keepalive"))
                            .map_err(|error| error.to_string())?;
                    }

                    "notification" => {
                        let subscription_type = payload
                            .pointer("/payload/subscription/type")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let message_id = payload
                            .pointer("/metadata/message_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();

                        if let Some(event) = payload.pointer("/payload/event") {
                            match subscription_type.as_str() {
                                "channel.subscribe" | "channel.subscription.gift" => {
                                    handle_subscription_event(
                                        &app,
                                        &config,
                                        subscription_type.as_str(),
                                        message_id.as_str(),
                                        event.clone(),
                                    )?;
                                }
                                _ => {
                                    handle_redemption_event(
                                        &app,
                                        &config,
                                        subscription_type.as_str(),
                                        event.clone(),
                                    )?;
                                }
                            }
                        } else {
                            app.emit(
                                "log:append",
                                make_log(
                                    "warn",
                                    format!(
                                        "Twitch notification ignored: missing event, subscription_type={subscription_type}"
                                    ),
                                ),
                            )
                            .map_err(|error| error.to_string())?;
                        }
                    }

                    "session_reconnect" => {
                        app.emit("log:append", make_log("warn", "Twitch requested reconnect"))
                            .map_err(|error| error.to_string())?;

                        break;
                    }

                    "revocation" => {
                        app.emit(
                            "log:append",
                            make_log(
                                "error",
                                format!("Twitch EventSub subscription revoked: {payload}"),
                            ),
                        )
                        .map_err(|error| error.to_string())?;

                        break;
                    }

                    _ => {}
                }
            }

            Message::Binary(bytes) => {
                let text = String::from_utf8(bytes)
                    .map_err(|error| format!("Twitch WS binary UTF-8 failed: {error}"))?;
                app.emit(
                    "log:append",
                    make_log("warn", format!("Twitch WS binary text received: {text}")),
                )
                .map_err(|error| error.to_string())?;
            }

            Message::Ping(payload) => {
                write
                    .send(Message::Pong(payload))
                    .await
                    .map_err(|error| format!("Twitch WS pong failed: {error}"))?;
            }

            Message::Pong(_) => {}

            Message::Close(frame) => {
                app.emit(
                    "log:append",
                    make_log("warn", format!("Twitch WS close frame: {frame:?}")),
                )
                .map_err(|error| error.to_string())?;

                break;
            }

            other => {
                app.emit(
                    "log:append",
                    make_log("warn", format!("Twitch WS unsupported message: {other:?}")),
                )
                .map_err(|error| error.to_string())?;
            }
        }
    }

    app.emit(
        "log:append",
        make_log("warn", "Twitch EventSub WebSocket closed"),
    )
    .map_err(|error| error.to_string())
}

async fn subscribe_redemptions(
    client_id: &str,
    token: &str,
    broadcaster_id: &str,
    reward_id: &str,
    session_id: &str,
) -> Result<String, String> {
    let mut condition = json!({
        "broadcaster_user_id": broadcaster_id
    });

    if !reward_id.is_empty() {
        condition["reward_id"] = json!(reward_id);
    }

    create_eventsub_subscription(
        client_id,
        token,
        "channel.channel_points_custom_reward_redemption.add",
        "1",
        condition,
        session_id,
    )
    .await
}

async fn subscribe_automatic_redemptions(
    client_id: &str,
    token: &str,
    broadcaster_id: &str,
    session_id: &str,
) -> Result<String, String> {
    create_eventsub_subscription(
        client_id,
        token,
        "channel.channel_points_automatic_reward_redemption.add",
        "1",
        json!({
            "broadcaster_user_id": broadcaster_id
        }),
        session_id,
    )
    .await
}

async fn subscribe_channel_subscription_event(
    client_id: &str,
    token: &str,
    broadcaster_id: &str,
    session_id: &str,
    subscription_type: &str,
) -> Result<String, String> {
    create_eventsub_subscription(
        client_id,
        token,
        subscription_type,
        "1",
        json!({ "broadcaster_user_id": broadcaster_id }),
        session_id,
    )
    .await
}

async fn create_eventsub_subscription(
    client_id: &str,
    token: &str,
    subscription_type: &str,
    version: &str,
    condition: Value,
    session_id: &str,
) -> Result<String, String> {
    let body = json!({
        "type": subscription_type,
        "version": version,
        "condition": condition,
        "transport": {
            "method": "websocket",
            "session_id": session_id
        }
    });

    let response = Client::new()
        .post(TWITCH_EVENTSUB_URL)
        .header("Client-Id", client_id)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            format!("Twitch subscription request failed for {subscription_type}: {error}")
        })?;

    let status = response.status();

    let response_body = response.text().await.map_err(|error| {
        format!("Twitch subscription response read failed for {subscription_type}: {error}")
    })?;

    if !status.is_success() {
        if status == StatusCode::UNAUTHORIZED {
            return Err(format!(
                "Twitch OAuth token invalid for {subscription_type}: {status}: {response_body}; request={body}"
            ));
        }

        return Err(format!(
            "Twitch subscription response failed for {subscription_type}: {status}: {response_body}; request={body}"
        ));
    }

    Ok(response_body)
}

fn summarize_subscription_response(response_body: &str, fallback: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(response_body) else {
        return fallback.to_string();
    };

    let Some(subscription) = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    else {
        return fallback.to_string();
    };

    let subscription_type = subscription
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(fallback);

    let status = subscription
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    format!("{subscription_type}, status={status}")
}

fn handle_redemption_event(
    app: &AppHandle,
    config: &AppConfig,
    subscription_type: &str,
    event: Value,
) -> Result<(), String> {
    if !config.twitch.reward_rolls_enabled {
        return Ok(());
    }

    let event_id = event
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if event_id.is_empty() {
        app.emit(
            "log:append",
            make_log(
                "warn",
                format!("Twitch redemption ignored: missing event id, type={subscription_type}"),
            ),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    }

    let reward_id = event
        .pointer("/reward/id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let reward_title = event
        .pointer("/reward/title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let reward_type = event
        .pointer("/reward/type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let reward_prompt = event
        .pointer("/reward/prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let user_input = event
        .get("user_input")
        .and_then(Value::as_str)
        .or_else(|| event.pointer("/message/text").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();

    let effective_reward_title = if reward_title.is_empty() {
        reward_type.clone()
    } else {
        reward_title.clone()
    };

    let configured_reward_id = config.twitch.reward_id.trim();
    let configured_reward_title = config.twitch.reward_title.trim();

    let matches_id = !configured_reward_id.is_empty() && reward_id == configured_reward_id;

    let matches_title = !configured_reward_title.is_empty()
        && effective_reward_title.eq_ignore_ascii_case(configured_reward_title);

    let matches_prompt = reward_prompt.eq_ignore_ascii_case("MODIFIER:REWARD")
        || user_input.eq_ignore_ascii_case("MODIFIER:REWARD");

    app.emit(
        "log:append",
        make_log(
            "info",
            format!(
                "Twitch redemption received: type={subscription_type}, id={event_id}, reward_id={reward_id}, reward='{effective_reward_title}'"
            ),
        ),
    )
    .map_err(|error| error.to_string())?;

    if !(matches_id || matches_title || matches_prompt) {
        app.emit(
            "log:append",
            make_log(
                "info",
                format!(
                    "Twitch redemption ignored: reward filter did not match, configured_reward_id='{configured_reward_id}', configured_reward_title='{configured_reward_title}'"
                ),
            ),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    }

    app.emit(
        "log:append",
        make_log("info", "Twitch redemption triggers roll"),
    )
    .map_err(|error| error.to_string())?;

    emit_reward_roll(
        app,
        event_id,
        Some(reward_id).filter(|value| !value.is_empty()),
        Some(effective_reward_title).filter(|value| !value.is_empty()),
        event
            .get("user_name")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        Some(user_input).filter(|value| !value.is_empty()),
    )
}

fn handle_subscription_event(
    app: &AppHandle,
    config: &AppConfig,
    subscription_type: &str,
    message_id: &str,
    event: Value,
) -> Result<(), String> {
    if !config.twitch.subscription_rolls_enabled {
        return Ok(());
    }

    let event_id = subscription_event_id(subscription_type, message_id, &event);
    let tier = event
        .get("tier")
        .and_then(Value::as_str)
        .unwrap_or("1000")
        .to_string();
    let total = event
        .get("total")
        .or_else(|| event.get("cumulative_total"))
        .and_then(|value| value.as_u64())
        .unwrap_or(1)
        .max(1) as u32;
    let viewer_name = event
        .get("user_name")
        .or_else(|| event.get("gifter_user_name"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let multiplier = if subscription_type == "channel.subscription.gift" {
        gift_subscription_multiplier(&tier, total, config)
    } else {
        single_subscription_multiplier(&tier, config)
    };

    app.emit(
        "log:append",
        make_log(
            "info",
            format!(
                "Twitch subscription received: type={subscription_type}, id={event_id}, tier={tier}, total={total}, multiplier={multiplier}"
            ),
        ),
    )
    .map_err(|error| error.to_string())?;

    if multiplier == 0 {
        app.emit(
            "log:append",
            make_log("info", "Twitch subscription ignored: below threshold"),
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }

    emit_subscription_roll(
        app,
        event_id,
        viewer_name,
        Some(format!("{subscription_type} tier {tier} total {total}")),
        multiplier,
    )
}

fn subscription_event_id(subscription_type: &str, message_id: &str, event: &Value) -> String {
    if !message_id.is_empty() {
        return format!("twitch-sub-{message_id}");
    }
    let user_id = event
        .get("user_id")
        .or_else(|| event.get("gifter_user_id"))
        .and_then(Value::as_str)
        .unwrap_or("anonymous");
    let tier = event.get("tier").and_then(Value::as_str).unwrap_or("1000");
    let total = event
        .get("total")
        .or_else(|| event.get("cumulative_total"))
        .map(Value::to_string)
        .unwrap_or_else(|| "1".to_string());
    format!(
        "twitch-sub-{subscription_type}-{user_id}-{tier}-{total}-{}",
        Utc::now().timestamp_millis()
    )
}

fn tier_weight(tier: &str) -> u32 {
    match tier {
        "3000" => 4,
        "2000" => 2,
        _ => 1,
    }
}

fn single_subscription_multiplier(tier: &str, config: &AppConfig) -> u32 {
    let value = tier_weight(tier);
    let threshold = tier_weight(config.twitch.subscription_min_tier.as_str());
    if value < threshold {
        return 0;
    }
    (value / threshold).max(1)
}

fn gift_subscription_multiplier(tier: &str, count: u32, config: &AppConfig) -> u32 {
    let gift_tier_threshold = tier_weight(config.twitch.gift_min_tier.as_str());
    let gift_tier_value = tier_weight(tier);
    if gift_tier_value < gift_tier_threshold && count < config.twitch.gift_min_count {
        return 0;
    }

    if gift_tier_value >= gift_tier_threshold && count == 1 {
        return 1;
    }

    let weighted = count.saturating_mul(gift_tier_value);
    ((weighted as f64) / 4.0).ceil().max(1.0) as u32
}

pub fn emit_subscription_roll(
    app: &AppHandle,
    event_id: String,
    viewer_name: Option<String>,
    message: Option<String>,
    duration_multiplier: u32,
) -> Result<(), String> {
    let state = app.state::<RuntimeState>();

    if !state.remember_event(&event_id) {
        return Ok(());
    }

    let trigger = TriggerEvent {
        id: event_id,
        source: "twitch".to_string(),
        viewer_name,
        amount: None,
        currency: None,
        reward_id: None,
        reward_title: Some("Twitch subscription".to_string()),
        message,
        duration_multiplier: Some(duration_multiplier),
        created_at: Utc::now().to_rfc3339(),
    };

    emit_roll_requested(app, trigger)
}

pub fn emit_reward_roll(
    app: &AppHandle,
    event_id: String,
    reward_id: Option<String>,
    reward_title: Option<String>,
    viewer_name: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    let state = app.state::<RuntimeState>();

    if !state.remember_event(&event_id) {
        app.emit(
            "log:append",
            make_log(
                "info",
                format!("Twitch redemption ignored: duplicate event id={event_id}"),
            ),
        )
        .map_err(|error| error.to_string())?;

        return Ok(());
    }

    let trigger = TriggerEvent {
        id: event_id,
        source: "twitch".to_string(),
        viewer_name,
        amount: None,
        currency: None,
        reward_id,
        reward_title,
        message,
        duration_multiplier: None,
        created_at: Utc::now().to_rfc3339(),
    };

    emit_roll_requested(app, trigger)
}
