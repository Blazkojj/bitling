//! XP, levels and the JSON file they live in (`~/.bitling/state.json`).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::AgentState;

/// XP for every finished agent task.
pub const XP_PER_DONE: u64 = 10;

/// What gets written to disk. Unknown fields are ignored and missing ones
/// default, so older/newer versions of the file keep loading.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SavedState {
    pub version: u32,
    pub xp: u64,
    /// Derived from `xp`; stored only so the file is easy to read by humans.
    pub level: u32,
    pub stats: Stats,
    /// Unix time (seconds) of the last update.
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub done: u64,
    pub waiting: u64,
    pub error: u64,
}

/// Level info sent to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub xp: u64,
    pub level: u32,
    /// XP earned inside the current level.
    pub level_xp: u64,
    /// XP needed to go from the current level to the next one.
    pub level_size: u64,
}

/// Total XP needed to reach `level` (level 1 starts at 0).
/// Each level takes 50 XP more than the previous one: 0, 50, 150, 300, 500...
pub fn xp_for_level(level: u32) -> u64 {
    let l = u64::from(level.max(1));
    25 * l * (l - 1)
}

pub fn progress_for(xp: u64) -> Progress {
    let mut level = 1;
    while xp_for_level(level + 1) <= xp {
        level += 1;
    }
    let start = xp_for_level(level);
    Progress {
        xp,
        level,
        level_xp: xp - start,
        level_size: xp_for_level(level + 1) - start,
    }
}

pub struct ProgressStore {
    path: PathBuf,
    pub saved: SavedState,
}

impl ProgressStore {
    /// Loads the state file, or starts fresh if it is missing. A corrupt file
    /// is moved aside (state.json.corrupt) instead of crashing the pet.
    pub fn load(path: PathBuf) -> Self {
        let saved = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                eprintln!(
                    "[bitling] {} is not valid ({err}); starting fresh",
                    path.display()
                );
                let _ = fs::rename(&path, path.with_extension("json.corrupt"));
                SavedState::default()
            }),
            Err(_) => SavedState::default(),
        };
        Self { path, saved }
    }

    pub fn progress(&self) -> Progress {
        progress_for(self.saved.xp)
    }

    /// Records an agent event. Returns true if it caused a level-up.
    pub fn record(&mut self, state: AgentState) -> bool {
        let before = self.progress().level;
        match state {
            AgentState::Done => {
                self.saved.stats.done += 1;
                self.saved.xp += XP_PER_DONE;
            }
            AgentState::Waiting => self.saved.stats.waiting += 1,
            AgentState::Error => self.saved.stats.error += 1,
            AgentState::Idle | AgentState::Working => return false,
        }
        let level = self.progress().level;
        if let Err(err) = self.save() {
            eprintln!("[bitling] could not save {}: {err}", self.path.display());
        }
        level > before
    }

    fn save(&mut self) -> io::Result<()> {
        self.saved.version = 1;
        self.saved.level = self.progress().level;
        self.saved.updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        write_atomically(&self.path, &serde_json::to_vec_pretty(&self.saved)?)
    }
}

/// Writes to a temp file first and renames it, so a crash mid-write can never
/// leave a half-written state.json behind.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bitling-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("state.json")
    }

    #[test]
    fn level_curve() {
        assert_eq!(xp_for_level(1), 0);
        assert_eq!(xp_for_level(2), 50);
        assert_eq!(xp_for_level(3), 150);
        assert_eq!(xp_for_level(4), 300);

        assert_eq!(
            progress_for(0),
            Progress {
                xp: 0,
                level: 1,
                level_xp: 0,
                level_size: 50
            }
        );
        assert_eq!(progress_for(49).level, 1);
        assert_eq!(
            progress_for(50),
            Progress {
                xp: 50,
                level: 2,
                level_xp: 0,
                level_size: 100
            }
        );
        assert_eq!(
            progress_for(160),
            Progress {
                xp: 160,
                level: 3,
                level_xp: 10,
                level_size: 150
            }
        );
    }

    #[test]
    fn done_events_earn_xp_and_level_up() {
        let path = temp_path("levelup");
        let mut store = ProgressStore::load(path.clone());
        for _ in 0..4 {
            assert!(!store.record(AgentState::Done));
        }
        assert!(
            store.record(AgentState::Done),
            "5th task reaches 50 XP = level 2"
        );
        assert!(!store.record(AgentState::Waiting));
        assert!(!store.record(AgentState::Working));

        let reloaded = ProgressStore::load(path.clone());
        assert_eq!(reloaded.saved.xp, 50);
        assert_eq!(reloaded.saved.level, 2);
        assert_eq!(
            reloaded.saved.stats,
            Stats {
                done: 5,
                waiting: 1,
                error: 0
            }
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{ not json").unwrap();

        let store = ProgressStore::load(path.clone());
        assert_eq!(store.saved, SavedState::default());
        assert!(path.with_extension("json.corrupt").exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
