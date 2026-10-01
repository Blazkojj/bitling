//! "Connect Claude Code" from the app itself: adds `type: "http"` hooks that
//! post straight to Bitling, so binary users don't need Node.js.
//!
//! Mirrors scripts/lib/claude-settings.mjs (the Node installer); both can
//! remove each other's hooks.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Query string that marks hook URLs as ours.
const URL_MARKER: &str = "via=bitling";
/// Marker of the Node hook script installed by scripts/install-hooks.mjs.
const SCRIPT_MARKER: &str = "bitling-hook.mjs";

/// (event, matcher). Keep in sync with HOOK_EVENTS in scripts/lib/claude-settings.mjs;
/// protocol.rs maps the raw payloads to pet states.
const EVENTS: &[(&str, Option<&str>)] = &[
    ("Stop", None),
    ("Notification", Some("permission_prompt|elicitation_dialog")),
    ("StopFailure", None),
    ("PostToolUseFailure", None),
    ("UserPromptSubmit", None),
    ("PostToolUse", None),
];

/// `$CLAUDE_CONFIG_DIR/settings.json`, default `~/.claude/settings.json`.
pub fn settings_path(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"))
        .join("settings.json")
}

fn is_ours(hook: &Value) -> bool {
    let has = |key: &str, marker: &str| {
        hook.get(key)
            .and_then(Value::as_str)
            .is_some_and(|s| s.contains(marker))
    };
    has("url", URL_MARKER) || has("command", SCRIPT_MARKER)
}

/// Removes Bitling's hooks; returns how many were removed.
pub fn remove_hooks(settings: &mut Value) -> usize {
    let mut removed = 0;
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return 0;
    };
    for groups in hooks.values_mut() {
        let Some(list) = groups.as_array_mut() else {
            continue;
        };
        list.retain_mut(|group| {
            let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            let before = inner.len();
            inner.retain(|hook| !is_ours(hook));
            removed += before - inner.len();
            before == 0 || !inner.is_empty()
        });
    }
    hooks.retain(|_, groups| groups.as_array().is_none_or(|l| !l.is_empty()));
    if hooks.is_empty() {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("hooks");
        }
    }
    removed
}

/// Adds (or replaces) Bitling's HTTP hooks.
pub fn add_hooks(settings: &mut Value, port: u16) {
    remove_hooks(settings);
    if !settings.is_object() {
        *settings = Value::Object(Map::new());
    }
    let url = format!("http://127.0.0.1:{port}/event?{URL_MARKER}");
    let obj = settings.as_object_mut().expect("object");
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().expect("object");
    for (event, matcher) in EVENTS {
        let mut group = Map::new();
        if let Some(m) = matcher {
            group.insert("matcher".into(), json!(m));
        }
        group.insert(
            "hooks".into(),
            json!([{ "type": "http", "url": url, "timeout": 3 }]),
        );
        let list = hooks.entry(*event).or_insert_with(|| json!([]));
        if let Some(list) = list.as_array_mut() {
            list.push(Value::Object(group));
        }
    }
}

pub fn count_hooks(settings: &Value) -> usize {
    let mut copy = settings.clone();
    remove_hooks(&mut copy)
}

// ---------------------------------------------------------------------------
// File side

pub fn read_settings(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Err(_) => Ok(json!({})),
        Ok(text) if text.trim().is_empty() => Ok(json!({})),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) if v.is_object() => Ok(v),
            _ => Err(format!(
                "{} is not valid JSON; fix it first, nothing was changed.",
                path.display()
            )),
        },
    }
}

/// Backs up the current file (never overwriting an older backup) and writes `settings`.
/// Returns the backup path, if a file existed.
pub fn write_with_backup(path: &Path, settings: &Value) -> Result<Option<PathBuf>, String> {
    let backup = if path.exists() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut candidate = PathBuf::from(format!("{}.bitling-backup-{stamp}", path.display()));
        let mut n = 2;
        while candidate.exists() {
            candidate = PathBuf::from(format!("{}.bitling-backup-{stamp}-{n}", path.display()));
            n += 1;
        }
        fs::copy(path, &candidate).map_err(|e| format!("backup failed: {e}"))?;
        Some(candidate)
    } else {
        None
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(path, text).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_is_idempotent_and_keeps_user_hooks() {
        let mut s = json!({
            "model": "opus",
            "hooks": { "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "prettier" }] }] }
        });
        add_hooks(&mut s, 47800);
        add_hooks(&mut s, 47800);
        assert_eq!(count_hooks(&s), EVENTS.len());
        assert_eq!(s["model"], "opus");
        assert_eq!(
            s["hooks"]["PostToolUse"][0]["hooks"][0]["command"],
            "prettier"
        );
        assert_eq!(
            s["hooks"]["Stop"][0]["hooks"][0]["url"],
            "http://127.0.0.1:47800/event?via=bitling"
        );
        // Key order of the user's file is preserved.
        assert_eq!(s.as_object().unwrap().keys().next().unwrap(), "model");
    }

    #[test]
    fn remove_restores_original_and_handles_node_hooks() {
        let original = json!({ "theme": "dark" });
        let mut s = original.clone();
        add_hooks(&mut s, 47800);
        // A hook from the Node installer is recognised too.
        s["hooks"]["Stop"][0]["hooks"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "type": "command", "command": "node \"/x/bitling-hook.mjs\" done" }));
        assert_eq!(remove_hooks(&mut s), EVENTS.len() + 1);
        assert_eq!(s, original);
    }

    #[test]
    fn invalid_json_is_refused() {
        let dir = std::env::temp_dir().join(format!("bitling-claude-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, "{ nope").unwrap();
        assert!(read_settings(&path).is_err());
        fs::write(&path, "{\"a\":1}").unwrap();
        let backup = write_with_backup(&path, &json!({"a": 2})).unwrap().unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), "{\"a\":1}");
        let _ = fs::remove_dir_all(dir);
    }
}
