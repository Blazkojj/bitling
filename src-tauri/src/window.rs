//! Window placement, remembered position and click-through.

use serde::Deserialize;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::Shared;

/// Gap between the pet and the screen corner, in logical pixels.
const CORNER_MARGIN: f64 = 16.0;

/// A rectangle in logical pixels, relative to the window's top-left corner.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Parts of the window that react to the mouse (the pet, the speech bubble).
/// Everything else is click-through, so the transparent area never blocks
/// the apps underneath.
#[derive(Default)]
pub struct HitRegions(pub Mutex<Option<Vec<Rect>>>);

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Restores the saved position if it is still on a screen, else the corner.
pub fn place(window: &WebviewWindow, saved: Option<(i32, i32)>) {
    if let Some((x, y)) = saved {
        let on_screen = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|m| {
                let (p, s) = (m.position(), m.size());
                x >= p.x
                    && y >= p.y
                    && x < p.x + s.width as i32 - 32
                    && y < p.y + s.height as i32 - 32
            });
        if on_screen && window.set_position(PhysicalPosition::new(x, y)).is_ok() {
            return;
        }
    }
    if let Err(err) = place_in_corner(window) {
        eprintln!("[bitling] could not position the window: {err}");
    }
}

/// Bottom-right corner of the primary screen's work area (above the taskbar / dock).
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

pub fn reset_position(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = place_in_corner(&window);
    }
}

pub fn toggle(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        if window.is_visible().unwrap_or(true) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
}

/// Remembers where the user dragged the pet. The position is polled every
/// 1.5 s instead of listening to "moved" events: those fire hundreds of times
/// per drag, and not at all on some Linux setups.
pub fn track_position(app: &AppHandle, window: &WebviewWindow) {
    let shared = app.state::<Shared>().inner().clone();
    let window = window.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(1500));
        let Ok(pos) = window.outer_position() else {
            continue;
        };
        let mut core = shared.lock();
        if core.config.position != Some((pos.x, pos.y)) {
            core.config.position = Some((pos.x, pos.y));
            core.config.save(&core.config_path);
        }
    });
}

/// Polls the cursor and lets clicks pass through everything except the hit
/// regions reported by the frontend.
pub fn start_click_through(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut ignoring = false;
        loop {
            thread::sleep(Duration::from_millis(50));
            let Some(window) = main_window(&app) else {
                continue;
            };
            let regions = app.state::<HitRegions>();
            let inside = {
                let guard = regions.0.lock().unwrap_or_else(|e| e.into_inner());
                // Until the frontend reports its regions, the whole window is live.
                let Some(rects) = guard.as_ref() else {
                    continue;
                };
                match (
                    window.cursor_position(),
                    window.outer_position(),
                    window.scale_factor(),
                ) {
                    (Ok(cursor), Ok(origin), Ok(scale)) => {
                        let x = (cursor.x - origin.x as f64) / scale;
                        let y = (cursor.y - origin.y as f64) / scale;
                        rects
                            .iter()
                            .any(|r| x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h)
                    }
                    // No global cursor position (e.g. some Wayland setups): stay clickable.
                    _ => true,
                }
            };
            if inside == ignoring {
                ignoring = !inside;
                let _ = window.set_ignore_cursor_events(ignoring);
            }
        }
    });
}
