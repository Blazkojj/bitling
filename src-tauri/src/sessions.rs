//! Several agent sessions (terminals, tabs) can talk to one pet at once.
//! This module decides what the pet shows when they disagree.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::protocol::AgentState;

/// Sessions we haven't heard from for this long are forgotten.
const SESSION_TTL: Duration = Duration::from_secs(2 * 60 * 60);
/// Events without a session id are tracked under this key.
const ANONYMOUS: &str = "";

#[derive(Default)]
pub struct Sessions {
    states: HashMap<String, (AgentState, Instant)>,
}

impl Sessions {
    /// Records an event and returns the state the pet should show:
    /// a session that waits for the user always wins (you must not miss it),
    /// otherwise the newest event is shown.
    pub fn update(&mut self, session: Option<&str>, state: AgentState, now: Instant) -> AgentState {
        self.states
            .retain(|_, (_, at)| now.duration_since(*at) < SESSION_TTL);
        self.states
            .insert(session.unwrap_or(ANONYMOUS).to_string(), (state, now));
        if self.states.values().any(|(s, _)| *s == AgentState::Waiting) {
            AgentState::Waiting
        } else {
            state
        }
    }

    /// Number of sessions that are known and not idle.
    pub fn active(&self) -> usize {
        self.states
            .iter()
            .filter(|(id, (s, _))| !id.is_empty() && *s != AgentState::Idle)
            .count()
    }

    /// Forget everything (e.g. the user clicked the pet: "seen it").
    pub fn clear(&mut self) {
        self.states.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AgentState::*;

    #[test]
    fn newest_event_wins() {
        let mut s = Sessions::default();
        let now = Instant::now();
        assert_eq!(s.update(Some("a"), Working, now), Working);
        assert_eq!(s.update(Some("b"), Done, now), Done);
        assert_eq!(s.active(), 2);
    }

    #[test]
    fn waiting_session_wins_until_it_moves_on() {
        let mut s = Sessions::default();
        let now = Instant::now();
        s.update(Some("a"), Waiting, now);
        // Another session finishing does not hide the pending approval.
        assert_eq!(s.update(Some("b"), Done, now), Waiting);
        // Approved: session a works again, nobody waits any more.
        assert_eq!(s.update(Some("a"), Working, now), Working);
    }

    #[test]
    fn stale_sessions_are_forgotten() {
        let mut s = Sessions::default();
        let start = Instant::now();
        s.update(Some("a"), Waiting, start);
        let later = start + SESSION_TTL + Duration::from_secs(1);
        assert_eq!(s.update(Some("b"), Done, later), Done);
        assert_eq!(s.active(), 1);
    }
}
