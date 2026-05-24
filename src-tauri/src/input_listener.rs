use rdev::{listen, Button, Event, EventType};
use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static INPUT_LISTENER_STARTED: OnceLock<()> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MouseInputPayload {
    kind: &'static str,
    x: Option<f64>,
    y: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardInputPayload {
    key_code: String,
}

pub fn start(app: AppHandle) {
    if INPUT_LISTENER_STARTED.set(()).is_err() {
        return;
    }

    let _ = app.emit(
        "log:append",
        crate::runtime::make_log("info", "Global input listener started"),
    );

    std::thread::spawn(move || {
        let emit_app = app.clone();
        let result = listen(move |event| handle_event(&emit_app, event));
        if let Err(error) = result {
            let _ = app.emit(
                "log:append",
                crate::runtime::make_log(
                    "warn",
                    format!("Global input listener failed: {error:?}"),
                ),
            );
        }
    });
}

fn handle_event(app: &AppHandle, event: Event) {
    match event.event_type {
        EventType::ButtonPress(Button::Left) => emit_mouse(app, "leftDown"),
        EventType::ButtonPress(Button::Right) => emit_mouse(app, "rightDown"),
        EventType::ButtonPress(Button::Middle) => emit_mouse(app, "middleDown"),
        EventType::Wheel { delta_y, .. } if delta_y > 0 => emit_mouse(app, "wheelUp"),
        EventType::Wheel { delta_y, .. } if delta_y < 0 => emit_mouse(app, "wheelDown"),
        EventType::MouseMove { x, y } => {
            let _ = app.emit(
                "input:mouse",
                MouseInputPayload {
                    kind: "move",
                    x: Some(x),
                    y: Some(y),
                },
            );
        }
        EventType::KeyPress(key) => {
            let _ = app.emit(
                "input:keyboard",
                KeyboardInputPayload {
                    key_code: format!("{key:?}"),
                },
            );
        }
        _ => {}
    }
}

fn emit_mouse(app: &AppHandle, kind: &'static str) {
    let _ = app.emit(
        "input:mouse",
        MouseInputPayload {
            kind,
            x: None,
            y: None,
        },
    );
}
