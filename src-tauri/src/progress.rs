//! XP, levels, streaks, achievements and the JSON file they live in
//! (`~/.bitling/state.json`).

use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::achievements::{self, Achievement, Facts};
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
    /// The pet's name, picked at random on first start; edit it here.
    pub name: String,
    pub stats: Stats,
    pub streak: Streak,
    /// Ids of unlocked achievements (see achievements.rs).
    pub achievements: Vec<String>,
    /// Agents that ever reported (claude-code, gemini, ...).
    pub agents: Vec<String>,
    /// Unix time (seconds) of the last update.
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub done: u64,
    pub waiting: u64,
    pub error: u64,
    pub pets: u64,
}

/// Days in a row with at least one finished task.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Streak {
    pub current: u32,
    pub best: u32,
    /// Local calendar day (days since 0001-01-01) of the last finished task.
    pub last_day: Option<i32>,
}

/// When something happened, in the user's local time.
#[derive(Debug, Clone, Copy)]
pub struct Moment {
    pub day: i32,
    pub hour: u32,
    pub weekend: bool,
}

impl Moment {
    pub fn now() -> Self {
        let now = chrono::Local::now();
        Self {
            day: now.num_days_from_ce(),
            hour: now.hour(),
            weekend: now.weekday().number_from_monday() >= 6,
        }
    }
}

/// What recording an event changed, for the frontend's bubble.
#[derive(Debug, Default)]
pub struct Outcome {
    pub level_up: bool,
    pub unlocked: Vec<&'static Achievement>,
}

const NAMES: &[&str] = &[
    "Pip", "Mochi", "Byte", "Pixel", "Nibble", "Chip", "Momo", "Kiwi", "Bean", "Tofu", "Ziggy",
    "Bloop",
];

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
        let mut store = Self { path, saved };
        if store.saved.name.trim().is_empty() {
            // No rand crate needed: the clock's nanoseconds are random enough here.
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0);
            store.saved.name = NAMES[nanos as usize % NAMES.len()].to_string();
            store.persist();
        }
        store
    }

    pub fn name(&self) -> &str {
        &self.saved.name
    }

    pub fn progress(&self) -> Progress {
        progress_for(self.saved.xp)
    }

    /// Records an agent event from `source` (an agent name) at `at`.
    pub fn record(&mut self, state: AgentState, source: &str, at: Moment) -> Outcome {
        let before = self.progress().level;
        let new_agent = !matches!(source, "demo" | "unknown" | "")
            && !self.saved.agents.iter().any(|a| a == source);
        if new_agent {
            self.saved.agents.push(source.chars().take(40).collect());
        }
        match state {
            AgentState::Done => {
                self.saved.stats.done += 1;
                self.saved.xp += XP_PER_DONE;
                self.bump_streak(at.day);
            }
            AgentState::Waiting => self.saved.stats.waiting += 1,
            AgentState::Error => self.saved.stats.error += 1,
            AgentState::Idle | AgentState::Working if !new_agent => return Outcome::default(),
            AgentState::Idle | AgentState::Working => {}
        }
        let outcome = Outcome {
            level_up: self.progress().level > before,
            unlocked: self.unlock(Some((state, at.hour, at.weekend))),
        };
        self.persist();
        outcome
    }

    /// The user petted the pet (double-click).
    pub fn record_pet(&mut self) -> Outcome {
        self.saved.stats.pets += 1;
        let outcome = Outcome {
            level_up: false,
            unlocked: self.unlock(None),
        };
        self.persist();
        outcome
    }

    fn bump_streak(&mut self, today: i32) {
        let streak = &mut self.saved.streak;
        match streak.last_day {
            Some(day) if day == today => return,
            Some(day) if day == today - 1 => streak.current += 1,
            _ => streak.current = 1,
        }
        streak.last_day = Some(today);
        streak.best = streak.best.max(streak.current);
    }

    /// Current streak as the user sees it: 0 once a whole day was missed.
    pub fn streak_today(&self, today: i32) -> u32 {
        match self.saved.streak.last_day {
            Some(day) if today - day <= 1 => self.saved.streak.current,
            _ => 0,
        }
    }

    fn unlock(&mut self, event: Option<(AgentState, u32, bool)>) -> Vec<&'static Achievement> {
        let s = &self.saved;
        let facts = Facts {
            done: s.stats.done,
            waiting: s.stats.waiting,
            error: s.stats.error,
            pets: s.stats.pets,
            level: self.progress().level,
            best_streak: s.streak.best,
            agents: s.agents.len(),
            event,
        };
        let new = achievements::newly_unlocked(&self.saved.achievements, &facts);
        self.saved
            .achievements
            .extend(new.iter().map(|a| a.id.to_string()));
        new
    }

    fn persist(&mut self) {
        if let Err(err) = self.save() {
            eprintln!("[bitling] could not save {}: {err}", self.path.display());
        }
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

    const NOON: Moment = Moment {
        day: 739_000,
        hour: 12,
        weekend: false,
    };

    #[test]
    fn done_events_earn_xp_and_level_up() {
        let path = temp_path("levelup");
        let mut store = ProgressStore::load(path.clone());
        assert!(!store.name().is_empty(), "a name is picked on first start");
        for _ in 0..4 {
            assert!(!store.record(AgentState::Done, "claude-code", NOON).level_up);
        }
        assert!(
            store.record(AgentState::Done, "claude-code", NOON).level_up,
            "5th task reaches 50 XP = level 2"
        );
        assert!(
            !store
                .record(AgentState::Waiting, "claude-code", NOON)
                .level_up
        );
        assert!(
            !store
                .record(AgentState::Working, "claude-code", NOON)
                .level_up
        );

        let reloaded = ProgressStore::load(path.clone());
        assert_eq!(reloaded.saved.xp, 50);
        assert_eq!(reloaded.saved.level, 2);
        assert_eq!(reloaded.name(), store.name(), "the name sticks");
        assert_eq!(
            reloaded.saved.stats,
            Stats {
                done: 5,
                waiting: 1,
                error: 0,
                pets: 0
            }
        );
        assert_eq!(reloaded.saved.achievements, ["first_task"]);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn streaks_count_calendar_days() {
        let path = temp_path("streak");
        let mut store = ProgressStore::load(path.clone());
        let day = |d: i32| Moment {
            day: 739_000 + d,
            ..NOON
        };
        store.record(AgentState::Done, "claude-code", day(0));
        store.record(AgentState::Done, "claude-code", day(0));
        store.record(AgentState::Done, "claude-code", day(1));
        let third = store.record(AgentState::Done, "claude-code", day(2));
        assert_eq!(store.saved.streak.current, 3);
        assert!(third.unlocked.iter().any(|a| a.id == "streak_3"));
        assert_eq!(store.streak_today(739_003), 3, "still alive the next day");
        assert_eq!(store.streak_today(739_004), 0, "a missed day breaks it");
        store.record(AgentState::Done, "claude-code", day(5));
        assert_eq!(
            (store.saved.streak.current, store.saved.streak.best),
            (1, 3)
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn agents_pets_and_demo() {
        let path = temp_path("agents");
        let mut store = ProgressStore::load(path.clone());
        store.record(AgentState::Working, "claude-code", NOON);
        store.record(AgentState::Working, "demo", NOON);
        let second = store.record(AgentState::Working, "gemini", NOON);
        assert_eq!(store.saved.agents, ["claude-code", "gemini"]);
        assert!(second.unlocked.iter().any(|a| a.id == "polyglot"));
        for _ in 0..19 {
            assert!(store.record_pet().unlocked.is_empty());
        }
        assert_eq!(store.record_pet().unlocked[0].id, "best_friends");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{ not json").unwrap();

        let store = ProgressStore::load(path.clone());
        assert_eq!(store.saved.xp, 0);
        assert!(store.saved.achievements.is_empty());
        assert!(path.with_extension("json.corrupt").exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
