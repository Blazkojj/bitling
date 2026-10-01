//! One native menu, shown both from the tray icon and on right-click.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::{claude_hooks, config::ConfigPatch, RunInfo, Shared};

/// Skins offered in the menu; ids must match src/skins.ts.
const SKINS: &[(&str, &str)] = &[
    ("classic", "Classic"),
    ("pastel", "Pastel"),
    ("midnight", "Midnight"),
    ("gameboy", "Game Boy"),
];
const STATES: &[(&str, &str)] = &[
    ("idle", "Idle"),
    ("working", "Working"),
    ("done", "Done"),
    ("waiting", "Waiting for you"),
    ("error", "Error"),
];

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let shared = app.state::<Shared>();
    let info = app.state::<RunInfo>();
    let (progress, sessions, config) = {
        let core = shared.lock();
        (
            core.store.progress(),
            core.sessions.active(),
            core.config.clone(),
        )
    };
    let connected = claude_connected(app);
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let header = format!("Bitling · Level {} · {} XP", progress.level, progress.xp);
    let status = match &info.server_error {
        Some(err) => format!("⚠ {err}"),
        None if sessions > 1 => format!("Watching {sessions} agent sessions"),
        None => format!("Listening on 127.0.0.1:{}", info.port),
    };

    let skins = Submenu::with_id(app, "skins", "Skin", true)?;
    for (id, name) in SKINS {
        skins.append(&CheckMenuItem::with_id(
            app,
            format!("skin:{id}"),
            *name,
            true,
            config.skin == *id,
            None::<&str>,
        )?)?;
    }
    let states = Submenu::with_id(app, "states", "Show state", true)?;
    for (id, name) in STATES {
        states.append(&MenuItem::with_id(
            app,
            format!("state:{id}"),
            *name,
            true,
            None::<&str>,
        )?)?;
    }

    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "header", header, false, None::<&str>)?,
            &MenuItem::with_id(app, "status", status, false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "demo", "Play demo", true, None::<&str>)?,
            &states,
            &skins,
            &CheckMenuItem::with_id(
                app,
                "sound",
                "Sound effects",
                true,
                config.sound,
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "bubbles",
                "Speech bubbles",
                true,
                config.bubbles,
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "autostart",
                "Launch at login",
                true,
                autostart,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                if connected { "disconnect" } else { "connect" },
                if connected {
                    "Disconnect Claude Code"
                } else {
                    "Connect Claude Code…"
                },
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "toggle", "Show / hide Bitling", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "reset-position",
                "Move back to the corner",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Bitling", true, None::<&str>)?,
        ],
    )
}

/// Rebuilds the tray menu so checkmarks and labels stay current.
pub fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn handle(app: &AppHandle, id: &str) {
    let shared = app.state::<Shared>();
    match id {
        "quit" => app.exit(0),
        "demo" => {
            let _ = app.emit("bitling:command", "demo");
        }
        "toggle" => crate::window::toggle(app),
        "reset-position" => crate::window::reset_position(app),
        "connect" => connect_claude(app),
        "disconnect" => disconnect_claude(app),
        "autostart" => {
            let auto = app.autolaunch();
            let result = if auto.is_enabled().unwrap_or(false) {
                auto.disable()
            } else {
                auto.enable()
            };
            if let Err(err) = result {
                eprintln!("[bitling] launch at login: {err}");
            }
        }
        "sound" | "bubbles" => {
            let current = shared.lock().config.clone();
            let patch = if id == "sound" {
                ConfigPatch {
                    sound: Some(!current.sound),
                    ..Default::default()
                }
            } else {
                ConfigPatch {
                    bubbles: Some(!current.bubbles),
                    ..Default::default()
                }
            };
            crate::update_config(app, patch);
        }
        _ => {
            if let Some(skin) = id.strip_prefix("skin:") {
                crate::update_config(
                    app,
                    ConfigPatch {
                        skin: Some(skin.into()),
                        ..Default::default()
                    },
                );
            } else if let Some(state) = id.strip_prefix("state:") {
                let _ = app.emit("bitling:command", format!("state:{state}"));
            }
        }
    }
    refresh_tray(app);
}

fn home(app: &AppHandle) -> std::path::PathBuf {
    app.path().home_dir().unwrap_or_default()
}

fn claude_connected(app: &AppHandle) -> bool {
    let path = claude_hooks::settings_path(&home(app));
    claude_hooks::read_settings(&path).is_ok_and(|s| claude_hooks::count_hooks(&s) > 0)
}

fn info_dialog(app: &AppHandle, title: &str, text: String, kind: MessageDialogKind) {
    app.dialog()
        .message(text)
        .title(title)
        .kind(kind)
        .show(|_| {});
}

fn connect_claude(app: &AppHandle) {
    let path = claude_hooks::settings_path(&home(app));
    let mut settings = match claude_hooks::read_settings(&path) {
        Ok(s) => s,
        Err(err) => return info_dialog(app, "Connect Claude Code", err, MessageDialogKind::Error),
    };
    let port = app.state::<RunInfo>().port;
    let question = format!(
        "Bitling will add 6 small hooks to\n{}\n\nThey tell the pet when Claude finishes, needs your approval or hits an error. \
         A backup of the file is saved next to it, and you can disconnect any time.",
        path.display()
    );
    let handle = app.clone();
    app.dialog()
        .message(question)
        .title("Connect Claude Code")
        .buttons(MessageDialogButtons::OkCancelCustom("Connect".into(), "Cancel".into()))
        .show(move |ok| {
            if !ok {
                return;
            }
            claude_hooks::add_hooks(&mut settings, port);
            match claude_hooks::write_with_backup(&path, &settings) {
                Ok(_) => info_dialog(
                    &handle,
                    "Connected!",
                    "Bitling is now connected to Claude Code.\nRestart your Claude Code sessions (or open /hooks) and give Claude a task.".into(),
                    MessageDialogKind::Info,
                ),
                Err(err) => info_dialog(&handle, "Connect Claude Code", err, MessageDialogKind::Error),
            }
            refresh_tray(&handle);
        });
}

fn disconnect_claude(app: &AppHandle) {
    let path = claude_hooks::settings_path(&home(app));
    let result = claude_hooks::read_settings(&path).and_then(|mut settings| {
        claude_hooks::remove_hooks(&mut settings);
        claude_hooks::write_with_backup(&path, &settings)
    });
    if let Err(err) = result {
        info_dialog(app, "Disconnect Claude Code", err, MessageDialogKind::Error);
    }
}
