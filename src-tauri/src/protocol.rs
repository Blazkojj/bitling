//! The tiny JSON protocol spoken on `POST /event`.
//!
//! Two shapes are accepted:
//!
//! 1. Bitling's own, agent-agnostic format (sent by `hooks/bitling-hook.mjs`,
//!    `scripts/demo.mjs`, or plain `curl`):
//!    `{"state": "done", "source": "claude-code", "message": "optional text",
//!      "session": "optional id, so several agent sessions can share one pet"}`
//!
//! 2. A raw Claude Code hook payload, e.g. from an `"type": "http"` hook that
//!    posts straight to Bitling without any script:
//!    `{"hook_event_name": "Stop", "session_id": "...", ...}`

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Longest message we keep; hook payloads can contain whole assistant replies.
const MAX_MESSAGE_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    /// Nothing going on.
    Idle,
    /// The agent is busy (prompt submitted, tool finished).
    Working,
    /// The agent finished its task.
    Done,
    /// The agent needs the user (permission prompt, question).
    Waiting,
    /// Something failed.
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingEvent {
    pub state: AgentState,
    pub source: String,
    pub message: Option<String>,
    /// Agent session the event belongs to (Claude Code's `session_id`).
    pub session: Option<String>,
}

/// Parses a request body. `Ok(None)` means "valid, but nothing to show"
/// (e.g. a Claude Code hook event Bitling does not care about).
pub fn parse_event(body: &[u8]) -> Result<Option<IncomingEvent>, String> {
    let value: Value = serde_json::from_slice(body).map_err(|e| format!("invalid JSON: {e}"))?;
    let obj = value.as_object().ok_or("expected a JSON object")?;

    if let Some(state) = obj.get("state") {
        let state: AgentState = serde_json::from_value(state.clone()).map_err(|_| {
            format!("unknown state {state}; expected one of idle, working, done, waiting, error")
        })?;
        return Ok(Some(IncomingEvent {
            state,
            source: str_field(&value, "source")
                .unwrap_or("unknown")
                .chars()
                .take(40)
                .collect(),
            message: str_field(&value, "message").map(trim_message),
            session: str_field(&value, "session").map(short_id),
        }));
    }

    if let Some(event) = str_field(&value, "hook_event_name") {
        return Ok(from_claude_hook(event, &value));
    }

    Err("missing \"state\" (or \"hook_event_name\" for raw Claude Code hooks)".into())
}

/// Maps a raw Claude Code hook payload to a pet state.
/// Keep in sync with the event table in `scripts/install-hooks.mjs`.
fn from_claude_hook(event: &str, payload: &Value) -> Option<IncomingEvent> {
    let (state, message) = match event {
        "Stop" => (
            AgentState::Done,
            str_field(payload, "last_assistant_message").and_then(first_line),
        ),
        "Notification" => {
            // The field name differs between Claude Code versions.
            let kind =
                str_field(payload, "notification_type").or_else(|| str_field(payload, "type"));
            match kind {
                Some("permission_prompt" | "elicitation_dialog") | None => {
                    (AgentState::Waiting, str_field(payload, "message"))
                }
                Some(_) => return None,
            }
        }
        "PermissionRequest" => (AgentState::Waiting, str_field(payload, "tool_name")),
        "StopFailure" => (AgentState::Error, str_field(payload, "error_message")),
        "PostToolUseFailure" => {
            // Documented as `tool_error`; Claude Code 2.1 actually sends `error`.
            let error = str_field(payload, "error").or_else(|| str_field(payload, "tool_error"));
            (AgentState::Error, error)
        }
        "UserPromptSubmit" | "PostToolUse" => (AgentState::Working, None),
        _ => return None,
    };
    Some(IncomingEvent {
        state,
        source: "claude-code".into(),
        message: message.map(trim_message),
        session: str_field(payload, "session_id").map(short_id),
    })
}

/// First non-empty line of a (markdown) reply, without leading markup.
/// Used as the speech bubble after a finished task.
pub fn first_line(text: &str) -> Option<&str> {
    text.lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['#', '*', '-', '>', '`', ' '])
                .trim()
        })
        .find(|line| !line.is_empty())
}

fn short_id(id: &str) -> String {
    id.chars().take(64).collect()
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str().filter(|s| !s.trim().is_empty())
}

fn trim_message(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= MAX_MESSAGE_CHARS {
        return text.to_string();
    }
    let mut short: String = text.chars().take(MAX_MESSAGE_CHARS - 1).collect();
    short.push('…');
    short
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<Option<IncomingEvent>, String> {
        parse_event(json.as_bytes())
    }

    #[test]
    fn parses_bitling_format() {
        let event = parse(
            r#"{"state":"waiting","source":"claude-code","message":"Bash needs permission"}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(event.state, AgentState::Waiting);
        assert_eq!(event.source, "claude-code");
        assert_eq!(event.message.as_deref(), Some("Bash needs permission"));
    }

    #[test]
    fn source_defaults_to_unknown() {
        let event = parse(r#"{"state":"done"}"#).unwrap().unwrap();
        assert_eq!(event.source, "unknown");
        assert_eq!(event.message, None);
    }

    #[test]
    fn rejects_unknown_state_and_bad_json() {
        assert!(parse(r#"{"state":"sleepy"}"#).is_err());
        assert!(parse("not json").is_err());
        assert!(parse("[1,2]").is_err());
        assert!(parse(r#"{"hello":"world"}"#).is_err());
    }

    #[test]
    fn maps_raw_claude_code_hooks() {
        let state = |json: &str| parse(json).unwrap().map(|e| e.state);
        assert_eq!(
            state(r#"{"hook_event_name":"Stop"}"#),
            Some(AgentState::Done)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#),
            Some(AgentState::Waiting)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","type":"permission_prompt"}"#),
            Some(AgentState::Waiting)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"idle_prompt"}"#),
            None
        );
        assert_eq!(
            state(r#"{"hook_event_name":"StopFailure","error_type":"rate_limit"}"#),
            Some(AgentState::Error)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"PostToolUse"}"#),
            Some(AgentState::Working)
        );
        assert_eq!(state(r#"{"hook_event_name":"SessionEnd"}"#), None);
    }

    #[test]
    fn tool_failure_message_from_real_payload() {
        // Shape captured from Claude Code 2.1.287.
        let event = parse(
            r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","error":"Exit code 1","is_interrupt":false}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(event.state, AgentState::Error);
        assert_eq!(event.message.as_deref(), Some("Exit code 1"));
    }

    #[test]
    fn sessions_and_done_summary() {
        let event = parse(
            r#"{"hook_event_name":"Stop","session_id":"abc","last_assistant_message":"\n## Fixed the login bug\n\nDetails..."}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(event.session.as_deref(), Some("abc"));
        assert_eq!(event.message.as_deref(), Some("Fixed the login bug"));

        let event = parse(r#"{"state":"waiting","session":"s1"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(event.session.as_deref(), Some("s1"));
    }

    #[test]
    fn long_messages_are_trimmed() {
        let long = "x".repeat(1000);
        let event = parse(&format!(r#"{{"state":"error","message":"{long}"}}"#))
            .unwrap()
            .unwrap();
        assert_eq!(event.message.unwrap().chars().count(), MAX_MESSAGE_CHARS);
    }
}
