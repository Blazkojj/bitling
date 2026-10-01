// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod progress;
mod protocol;
mod server;

use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

use progress::{Progress, ProgressStore};
use protocol::{AgentState, IncomingEvent};

/// Gap between the pet and the screen corner, in logical pixels.
const CORNER_MARGIN: f64 = 16.0;

/// Pet state shared by the HTTP thread and Tauri commands.
struct Core {
    state: AgentState,
    store: ProgressStore,
}

#[derive(Clone)]
struct Shared(Arc<Mutex<Core>>);

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Core> {
        // A panic while holding the lock must not take the whole pet down.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Facts about this run, fixed at startup.
struct RunInfo {
    port: u16,
    server_error: Option<String>,
    demo: bool,
}

/// Payload of the `bitling:event` event (see `PetEvent` in src/bridge.ts).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetEvent {
    state: AgentState,
    source: String,
    message: Option<String>,
    progress: Progress,
    level_up: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    state: AgentState,
    progress: Progress,
    port: u16,
    server_error: Option<String>,
    demo: bool,
}

/// Bridges HTTP requests to the shared state and the frontend.
struct AppSink {
    app: AppHandle,
    shared: Shared,
}

impl server::EventSink for AppSink {
    fn on_event(&self, event: IncomingEvent) -> Value {
        let (progress, level_up) = {
            let mut core = self.shared.lock();
            core.state = event.state;
            // Demo traffic (scripts/demo.mjs) must not farm XP.
            let level_up = event.source != "demo" && core.store.record(event.state);
            (core.store.progress(), level_up)
        };
        let payload = PetEvent {
            state: event.state,
            source: event.source,
            message: event.message,
            progress,
            level_up,
        };
        if let Err(err) = self.app.emit("bitling:event", payload) {
            eprintln!("[bitling] could not reach the pet window: {err}");
        }
        json!({ "ok": true, "state": event.state, "xp": progress.xp, "level": progress.level, "levelUp": level_up })
    }

    fn snapshot(&self) -> Value {
        let core = self.shared.lock();
        json!({ "ok": true, "state": core.state, "progress": core.store.progress() })
    }
}

#[tauri::command]
fn get_snapshot(shared: State<'_, Shared>, info: State<'_, RunInfo>) -> Snapshot {
    let core = shared.lock();
    Snapshot {
        state: core.state,
        progress: core.store.progress(),
        port: info.port,
        server_error: info.server_error.clone(),
        demo: info.demo,
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// `~/.bitling`, or `$BITLING_HOME` when set (handy for testing).
fn data_dir(app: &AppHandle) -> PathBuf {
    if let Some(dir) = std::env::var_os("BITLING_HOME") {
        return PathBuf::from(dir);
    }
    app.path()
        .home_dir()
        .map(|home| home.join(".bitling"))
        .unwrap_or_else(|_| PathBuf::from(".bitling"))
}

/// Moves the window to the bottom-right corner of the primary screen's work
/// area (i.e. above the taskbar / dock).
fn place_in_corner(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area();
    // The window has no decorations, so inner size == outer size. (On Linux,
    // outer_size() reports 0x0 until the window manager has mapped it.)
    let size = window.inner_size()?;
    let margin = (CORNER_MARGIN * monitor.scale_factor()).round() as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    window.set_position(PhysicalPosition::new(x, y))
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !v.is_empty() && v != "0" && v != "false")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_snapshot, quit])
        .setup(|app| {
            // A desk pet should not occupy a Dock slot on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let store = ProgressStore::load(data_dir(&handle).join("state.json"));
            let shared = Shared(Arc::new(Mutex::new(Core {
                state: AgentState::Idle,
                store,
            })));
            app.manage(shared.clone());

            let port = std::env::var("BITLING_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(server::DEFAULT_PORT);
            let server_error = server::start(
                port,
                AppSink {
                    app: handle,
                    shared,
                },
            )
            .err()
            .inspect(|err| {
                eprintln!("[bitling] HTTP endpoint disabled: {err} (is Bitling already running?)")
            });
            if server_error.is_none() {
                eprintln!("[bitling] listening on http://127.0.0.1:{port}");
            }
            app.manage(RunInfo {
                port,
                server_error,
                demo: env_flag("BITLING_DEMO") || std::env::args().any(|a| a == "--demo"),
            });

            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = place_in_corner(&window) {
                    eprintln!("[bitling] could not position the window: {err}");
                }
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Bitling");
}
