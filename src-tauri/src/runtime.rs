use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::task::JoinHandle;

#[derive(Default)]
pub struct RuntimeState {
    pub is_playing: Mutex<bool>,
    pub processed_event_ids: Mutex<VecDeque<String>>,
    pub pending_rolls: Mutex<VecDeque<TriggerEvent>>,
    pub twitch_task: Mutex<Option<JoinHandle<()>>>,
    pub twitch_chat_task: Mutex<Option<JoinHandle<()>>>,
    pub donation_task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerEvent {
    pub id: String,
    pub source: String,
    pub viewer_name: Option<String>,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub reward_id: Option<String>,
    pub reward_title: Option<String>,
    pub message: Option<String>,
    pub duration_multiplier: Option<u32>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLog {
    pub id: String,
    pub level: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageEvent {
    pub id: String,
    pub source: String,
    pub viewer_name: String,
    pub message: String,
    pub created_at: String,
}

pub fn make_log(level: &str, message: impl Into<String>) -> AppLog {
    AppLog {
        id: uuid::Uuid::new_v4().to_string(),
        level: level.to_string(),
        message: message.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

impl RuntimeState {
    pub fn remember_event(&self, id: &str) -> bool {
        let mut ids = self
            .processed_event_ids
            .lock()
            .expect("processed ids poisoned");
        if ids.iter().any(|known| known == id) {
            return false;
        }
        ids.push_back(id.to_string());
        while ids.len() > 200 {
            ids.pop_front();
        }
        true
    }

    pub fn push_pending_roll(&self, trigger: TriggerEvent) {
        let mut pending = self.pending_rolls.lock().expect("pending rolls poisoned");
        if pending.iter().any(|known| known.id == trigger.id) {
            return;
        }
        pending.push_back(trigger);
        while pending.len() > 100 {
            pending.pop_front();
        }
    }

    pub fn ack_pending_roll(&self, trigger_id: &str) {
        let mut pending = self.pending_rolls.lock().expect("pending rolls poisoned");
        pending.retain(|trigger| trigger.id != trigger_id);
    }

    pub fn drain_pending_rolls(&self) -> Vec<TriggerEvent> {
        let pending = self.pending_rolls.lock().expect("pending rolls poisoned");
        pending.iter().cloned().collect()
    }

    pub fn clear_pending_rolls(&self) {
        self.pending_rolls
            .lock()
            .expect("pending rolls poisoned")
            .clear();
    }
}

pub fn emit_roll_requested(app: &AppHandle, trigger: TriggerEvent) -> Result<(), String> {
    let multiplier = trigger.duration_multiplier.unwrap_or(1).max(1);
    let mut remaining = multiplier;
    let mut part = 1;

    while remaining > 0 {
        let current_multiplier = remaining.min(6);
        remaining -= current_multiplier;
        let mut next = trigger.clone();
        next.duration_multiplier = Some(current_multiplier);
        if multiplier > 6 {
            next.id = format!("{}-part-{part}", trigger.id);
            next.message = Some(format!(
                "{}{}duration x{}",
                trigger
                    .message
                    .as_ref()
                    .map(|message| format!("{message}; "))
                    .unwrap_or_default(),
                if remaining > 0 { "split roll; " } else { "" },
                current_multiplier
            ));
        }

        let state = app.state::<RuntimeState>();
        state.push_pending_roll(next.clone());
        app.emit("trigger:received", &next)
            .map_err(|error| error.to_string())?;
        app.emit("roll:requested", next)
            .map_err(|error| error.to_string())?;
        part += 1;
    }

    Ok(())
}
