//! User preferences in `~/.bitling/config.json` (XP lives in state.json).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    /// One of the skins in src/skins.ts.
    pub skin: String,
    /// Chiptune sound effects (off by default: nobody likes surprise beeps).
    pub sound: bool,
    /// Speech bubbles with the agent's message.
    pub bubbles: bool,
    /// Look for a newer release on GitHub once a day.
    pub updates: bool,
    /// Pet size: "small", "normal" or "large" (see window::SIZES).
    pub size: String,
    /// Last window position (physical pixels), restored on start.
    pub position: Option<(i32, i32)>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            skin: "classic".into(),
            sound: false,
            bubbles: true,
            updates: true,
            size: "normal".into(),
            position: None,
        }
    }
}

/// Partial update sent by the frontend (`set_config`).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatch {
    pub skin: Option<String>,
    pub sound: Option<bool>,
    pub bubbles: Option<bool>,
    pub updates: Option<bool>,
    pub size: Option<String>,
}

impl Config {
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) {
        let result = (|| -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            let tmp: PathBuf = path.with_extension("json.tmp");
            fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
            fs::rename(&tmp, path)
        })();
        if let Err(err) = result {
            eprintln!("[bitling] could not save {}: {err}", path.display());
        }
    }

    pub fn apply(&mut self, patch: ConfigPatch) {
        if let Some(skin) = patch.skin {
            self.skin = skin;
        }
        if let Some(sound) = patch.sound {
            self.sound = sound;
        }
        if let Some(bubbles) = patch.bubbles {
            self.bubbles = bubbles;
        }
        if let Some(updates) = patch.updates {
            self.updates = updates;
        }
        if let Some(size) = patch.size {
            self.size = size;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("bitling-config-{}", std::process::id()));
        let path = dir.join("config.json");
        assert_eq!(Config::load(&path), Config::default());

        let mut config = Config::default();
        config.apply(ConfigPatch {
            skin: Some("gameboy".into()),
            sound: Some(true),
            bubbles: None,
            updates: Some(false),
            size: Some("large".into()),
        });
        config.position = Some((10, -20));
        config.save(&path);
        assert_eq!(Config::load(&path), config);

        // Unknown or missing fields don't break loading.
        fs::write(&path, br#"{"sound": true, "future": 1}"#).unwrap();
        let loaded = Config::load(&path);
        assert!(loaded.sound && loaded.bubbles && loaded.skin == "classic");
        let _ = fs::remove_dir_all(dir);
    }
}
