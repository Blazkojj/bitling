// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod achievements;
mod claude_hooks;
mod config;
mod menu;
mod progress;
mod protocol;
mod server;
mod sessions;
mod window;

use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

use config::{Config, ConfigPatch};
use progress::{Moment, Outcome, Progress, ProgressStore};
use protocol::{AgentState, IncomingEvent};
use sessions::Sessions;

/// Pet state shared by the HTTP thread, menus and Tauri commands.
pub struct Core {
    state: AgentState,
    store: ProgressStore,
    sessions: Sessions,
    config: Config,
    config_path: PathBuf,
    /// A newer release found by the frontend's update check.
    update: Option<Update>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Update {
    version: String,
    url: String,
}

/// Only release pages of this repository may be opened from the menu.
const RELEASES_URL: &str = "https://github.com/Blazkojj/bitling/releases";

#[derive(Clone)]
pub struct Shared(Arc<Mutex<Core>>);

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Core> {
        // A panic while holding the lock must not take the whole pet down.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Facts about this run, fixed at startup.
pub struct RunInfo {
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
    sessions: usize,
    /// Folder the agent works in, for bubbles when several sessions run.
    project: Option<String>,
    /// The state of this event itself (`state` aggregates all sessions).
    event_state: AgentState,
    /// Titles of achievements this event unlocked.
    achievements: Vec<String>,
}

fn titles(outcome: &Outcome) -> Vec<String> {
    outcome
        .unlocked
        .iter()
        .map(|a| a.title.to_string())
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    state: AgentState,
    progress: Progress,
    port: u16,
    server_error: Option<String>,
    demo: bool,
    config: Config,
    /// The pet's name (state.json).
    name: String,
}

/// Bridges HTTP requests to the shared state and the frontend.
struct AppSink {
    app: AppHandle,
    shared: Shared,
}

impl server::EventSink for AppSink {
    fn on_event(&self, event: IncomingEvent) -> Value {
        let (state, progress, outcome, sessions) = {
            let mut core = self.shared.lock();
            let state = core
                .sessions
                .update(event.session.as_deref(), event.state, Instant::now());
            core.state = state;
            // Demo traffic (scripts/demo.mjs) must not farm XP or achievements.
            let outcome = if event.source == "demo" {
                Outcome::default()
            } else {
                core.store.record(event.state, &event.source, Moment::now())
            };
            (
                state,
                core.store.progress(),
                outcome,
                core.sessions.active(),
            )
        };
        let level_up = outcome.level_up;
        let payload = PetEvent {
            event_state: event.state,
            state,
            source: event.source,
            message: event.message,
            progress,
            level_up,
            sessions,
            project: event.project,
            achievements: titles(&outcome),
        };
        if let Err(err) = self.app.emit("bitling:event", payload) {
            eprintln!("[bitling] could not reach the pet window: {err}");
        }
        if level_up || !outcome.unlocked.is_empty() {
            menu::refresh_tray(&self.app);
        }
        json!({ "ok": true, "state": state, "xp": progress.xp, "level": progress.level, "levelUp": level_up })
    }

    fn show(&self) {
        if let Some(window) = window::main_window(&self.app) {
            let _ = window.show();
        }
    }

    fn snapshot(&self) -> Value {
        let core = self.shared.lock();
        json!({ "ok": true, "state": core.state, "progress": core.store.progress(), "sessions": core.sessions.active() })
    }
}

/// Saves a config change and tells the frontend about it.
pub fn update_config(app: &AppHandle, patch: ConfigPatch) {
    let config = {
        let shared = app.state::<Shared>();
        let mut core = shared.lock();
        core.config.apply(patch);
        core.config.save(&core.config_path);
        core.config.clone()
    };
    let _ = app.emit("bitling:config", config);
    menu::refresh_tray(app);
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
        config: core.config.clone(),
        name: core.store.name().to_string(),
    }
}

/// Double-click petting; returns the titles of achievements it unlocked.
#[tauri::command]
fn pet(app: AppHandle, shared: State<'_, Shared>) -> Vec<String> {
    let outcome = shared.lock().store.record_pet();
    if !outcome.unlocked.is_empty() {
        menu::refresh_tray(&app);
    }
    titles(&outcome)
}

#[tauri::command]
fn set_config(app: AppHandle, patch: ConfigPatch) {
    update_config(&app, patch);
}

/// The user clicked the pet: "seen it". Pending states of all sessions are cleared.
#[tauri::command]
fn acknowledge(shared: State<'_, Shared>) {
    let mut core = shared.lock();
    core.sessions.clear();
    core.state = AgentState::Idle;
}

/// Shows the native menu at the cursor (`x`, `y` in CSS pixels of the window).
#[tauri::command]
fn popup_menu(app: AppHandle, window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    let menu = menu::build(&app).map_err(|e| e.to_string())?;
    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// The frontend found a newer release; offer it in the menu.
#[tauri::command]
fn offer_update(app: AppHandle, shared: State<'_, Shared>, update: Update) -> Result<(), String> {
    if !update.url.starts_with(RELEASES_URL) {
        return Err("not a Bitling release URL".into());
    }
    shared.lock().update = Some(update);
    menu::refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn set_hit_regions(regions: State<'_, window::HitRegions>, rects: Vec<window::Rect>) {
    *regions.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(rects);
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

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !v.is_empty() && v != "0" && v != "false")
}

fn main() {
    tauri::Builder::default()
        // Must come first: a second launch just brings the existing pet back.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = window::main_window(app) {
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .manage(window::HitRegions::default())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            set_config,
            acknowledge,
            pet,
            popup_menu,
            set_hit_regions,
            offer_update,
            quit
        ])
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .setup(|app| {
            // A desk pet should not occupy a Dock slot on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let dir = data_dir(&handle);
            let config_path = dir.join("config.json");
            let core = Core {
                state: AgentState::Idle,
                store: ProgressStore::load(dir.join("state.json")),
                sessions: Sessions::default(),
                config: Config::load(&config_path),
                config_path,
                update: None,
            };
            let saved_position = core.config.position;
            let shared = Shared(Arc::new(Mutex::new(core)));
            app.manage(shared.clone());

            let port = std::env::var("BITLING_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(server::DEFAULT_PORT);
            let server_error = server::start(
                port,
                AppSink {
                    app: handle.clone(),
                    shared,
                },
            )
            .err();
            // Already running? (The single-instance plugin needs D-Bus on Linux;
            // this also covers systems without it.) Wake that pet and leave.
            if server_error.is_some() && server::wake_existing(port) {
                eprintln!("[bitling] already running, showing the existing pet");
                std::process::exit(0);
            }
            let server_error =
                server_error.inspect(|err| eprintln!("[bitling] HTTP endpoint disabled: {err}"));
            if server_error.is_none() {
                eprintln!("[bitling] listening on http://127.0.0.1:{port}");
            }
            app.manage(RunInfo {
                port,
                server_error,
                demo: env_flag("BITLING_DEMO") || std::env::args().any(|a| a == "--demo"),
            });

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Bitling")
                .menu(&menu::build(&handle)?)
                .build(app)?;

            if let Some(window) = window::main_window(&handle) {
                window::place(&window, saved_position);
                window::track_position(&handle, &window);
                window.show()?;
            }
            window::start_click_through(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Bitling");
}
