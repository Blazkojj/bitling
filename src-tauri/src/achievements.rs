//! Achievements: small goals that unlock over time and pop up in the bubble.

use crate::protocol::AgentState;

#[derive(Debug, PartialEq, Eq)]
pub struct Achievement {
    pub id: &'static str,
    pub title: &'static str,
    /// How to get it (shown for locked ones in the menu).
    pub hint: &'static str,
}

const fn a(id: &'static str, title: &'static str, hint: &'static str) -> Achievement {
    Achievement { id, title, hint }
}

pub const ALL: &[Achievement] = &[
    a("first_task", "Hello, world", "Finish your first task"),
    a("ten_tasks", "Getting things done", "Finish 10 tasks"),
    a("fifty_tasks", "Machine", "Finish 50 tasks"),
    a("hundred_tasks", "Centurion", "Finish 100 tasks"),
    a("streak_3", "On a roll", "Finish tasks 3 days in a row"),
    a("streak_7", "Unstoppable", "Finish tasks 7 days in a row"),
    a("streak_30", "Habit formed", "Finish tasks 30 days in a row"),
    a(
        "night_owl",
        "Night owl",
        "Finish a task between midnight and 5 am",
    ),
    a(
        "early_bird",
        "Early bird",
        "Finish a task between 5 and 8 am",
    ),
    a(
        "weekend_warrior",
        "Weekend warrior",
        "Finish a task on a weekend",
    ),
    a("gatekeeper", "Gatekeeper", "Answer 25 approval requests"),
    a("survivor", "Survivor", "Live through 10 errors"),
    a("best_friends", "Best friends", "Pet Bitling 20 times"),
    a(
        "polyglot",
        "Polyglot",
        "Use Bitling with 2 different agents",
    ),
    a("sprout", "Sprouted", "Reach level 5"),
    a("royalty", "Royalty", "Reach level 10"),
];

/// Everything the rules look at, gathered by the progress store.
pub struct Facts {
    pub done: u64,
    pub waiting: u64,
    pub error: u64,
    pub pets: u64,
    pub level: u32,
    pub best_streak: u32,
    pub agents: usize,
    /// The event being recorded, with the local hour and weekday it happened at.
    pub event: Option<(AgentState, u32, bool)>,
}

fn earned(id: &str, f: &Facts) -> bool {
    let done_at = |hours: std::ops::Range<u32>| matches!(f.event, Some((AgentState::Done, h, _)) if hours.contains(&h));
    match id {
        "first_task" => f.done >= 1,
        "ten_tasks" => f.done >= 10,
        "fifty_tasks" => f.done >= 50,
        "hundred_tasks" => f.done >= 100,
        "streak_3" => f.best_streak >= 3,
        "streak_7" => f.best_streak >= 7,
        "streak_30" => f.best_streak >= 30,
        "night_owl" => done_at(0..5),
        "early_bird" => done_at(5..8),
        "weekend_warrior" => matches!(f.event, Some((AgentState::Done, _, true))),
        "gatekeeper" => f.waiting >= 25,
        "survivor" => f.error >= 10,
        "best_friends" => f.pets >= 20,
        "polyglot" => f.agents >= 2,
        "sprout" => f.level >= 5,
        "royalty" => f.level >= 10,
        _ => false,
    }
}

/// Achievements earned now that are not in `unlocked` yet.
pub fn newly_unlocked(unlocked: &[String], facts: &Facts) -> Vec<&'static Achievement> {
    ALL.iter()
        .filter(|a| !unlocked.iter().any(|id| id == a.id) && earned(a.id, facts))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts {
            done: 0,
            waiting: 0,
            error: 0,
            pets: 0,
            level: 1,
            best_streak: 0,
            agents: 0,
            event: None,
        }
    }

    fn ids(list: Vec<&Achievement>) -> Vec<&str> {
        list.iter().map(|a| a.id).collect()
    }

    #[test]
    fn counters_unlock_once() {
        let f = Facts {
            done: 10,
            ..facts()
        };
        assert_eq!(ids(newly_unlocked(&[], &f)), ["first_task", "ten_tasks"]);
        let already = vec!["first_task".to_string()];
        assert_eq!(ids(newly_unlocked(&already, &f)), ["ten_tasks"]);
    }

    #[test]
    fn time_based_ones_need_a_done_event() {
        let night = Facts {
            event: Some((AgentState::Done, 2, false)),
            done: 1,
            ..facts()
        };
        assert!(ids(newly_unlocked(&[], &night)).contains(&"night_owl"));
        let error_at_night = Facts {
            event: Some((AgentState::Error, 2, true)),
            ..facts()
        };
        assert!(newly_unlocked(&[], &error_at_night).is_empty());
        let weekend = Facts {
            event: Some((AgentState::Done, 14, true)),
            ..facts()
        };
        assert_eq!(ids(newly_unlocked(&[], &weekend)), ["weekend_warrior"]);
    }

    #[test]
    fn ids_are_unique() {
        for (i, a) in ALL.iter().enumerate() {
            assert!(
                ALL[i + 1..].iter().all(|b| b.id != a.id),
                "duplicate {}",
                a.id
            );
        }
    }
}
