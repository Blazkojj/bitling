//! Local HTTP endpoint that agent hooks talk to.
//!
//!   GET  /health  -> {"ok":true,"app":"bitling","version":"..."}
//!   GET  /state   -> current state and XP
//!   POST /event   -> {"state":"done"} (see protocol.rs)
//!
//! Only binds to 127.0.0.1. POST requests must be `Content-Type:
//! application/json`: a web page cannot send that cross-origin without a CORS
//! preflight, which we never approve, so random websites can't poke the pet.

use serde_json::{json, Value};
use std::io::Read;
use std::thread;
use tiny_http::{Header, Method, Response, Server};

use crate::protocol::{parse_event, IncomingEvent};

pub const DEFAULT_PORT: u16 = 47800;
/// Raw Claude Code payloads can include a full assistant reply; cap them.
const MAX_BODY_BYTES: u64 = 1024 * 1024;

/// Callbacks into the app, kept abstract so the routing can be unit tested.
pub trait EventSink: Send + 'static {
    /// Applies an event and returns the JSON body for the response.
    fn on_event(&self, event: IncomingEvent) -> Value;
    fn snapshot(&self) -> Value;
    /// Bring the pet window back (a second launch asks the first one).
    fn show(&self);
}

/// Binds the port (so the caller learns about "address in use" right away)
/// and serves requests on a background thread.
pub fn start(port: u16, sink: impl EventSink) -> Result<(), String> {
    let server =
        Server::http(("127.0.0.1", port)).map_err(|e| format!("Port {port} unavailable: {e}"))?;
    thread::Builder::new()
        .name("bitling-http".into())
        .spawn(move || {
            for mut request in server.incoming_requests() {
                let content_type = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Content-Type"))
                    .map(|h| h.value.as_str().to_owned());

                let mut body = Vec::new();
                let read = request
                    .as_reader()
                    .take(MAX_BODY_BYTES + 1)
                    .read_to_end(&mut body);
                let (status, reply) = if read.is_err() {
                    (400, error("could not read request body"))
                } else if body.len() as u64 > MAX_BODY_BYTES {
                    (413, error("request body too large"))
                } else {
                    route(
                        request.method(),
                        request.url(),
                        content_type.as_deref(),
                        &body,
                        &sink,
                    )
                };

                let header =
                    Header::from_bytes("Content-Type", "application/json").expect("static header");
                let response = Response::from_string(reply.to_string())
                    .with_status_code(status)
                    .with_header(header);
                if let Err(err) = request.respond(response) {
                    eprintln!("[bitling] failed to answer HTTP request: {err}");
                }
            }
        })
        .map_err(|e| format!("could not start HTTP thread: {e}"))?;
    Ok(())
}

fn route(
    method: &Method,
    url: &str,
    content_type: Option<&str>,
    body: &[u8],
    sink: &impl EventSink,
) -> (u16, Value) {
    let path = url.split('?').next().unwrap_or("");
    match (method, path) {
        (Method::Get, "/" | "/health") => (
            200,
            json!({ "ok": true, "app": "bitling", "version": env!("CARGO_PKG_VERSION") }),
        ),
        (Method::Get, "/state") => (200, sink.snapshot()),
        (Method::Post, "/show") => {
            sink.show();
            (200, json!({ "ok": true }))
        }
        (Method::Post, "/event") => {
            let is_json = content_type
                .is_some_and(|ct| ct.to_ascii_lowercase().starts_with("application/json"));
            if !is_json {
                return (415, error("Content-Type must be application/json"));
            }
            match parse_event(body) {
                Ok(Some(event)) => (200, sink.on_event(event)),
                Ok(None) => (202, json!({ "ok": true, "ignored": true })),
                Err(message) => (400, error(&message)),
            }
        }
        (_, "/" | "/health" | "/state" | "/event" | "/show") => (405, error("method not allowed")),
        _ => (404, error("not found")),
    }
}

/// True if another Bitling already answers on `port`; it is asked to show itself.
/// Used as a single-instance fallback that works without D-Bus.
pub fn wake_existing(port: u16) -> bool {
    use std::io::Write;
    use std::net::TcpStream;
    use std::time::Duration;
    let ask = |request: &str| -> Option<String> {
        let mut stream =
            TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500))
                .ok()?;
        stream
            .set_read_timeout(Some(Duration::from_millis(800)))
            .ok()?;
        stream.write_all(request.as_bytes()).ok()?;
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        Some(reply)
    };
    let health = ask("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    if !health.is_some_and(|r| r.contains("\"app\":\"bitling\"")) {
        return false;
    }
    ask("POST /show HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    true
}

fn error(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AgentState;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<IncomingEvent>>);

    impl EventSink for Recorder {
        fn on_event(&self, event: IncomingEvent) -> Value {
            self.0.lock().unwrap().push(event);
            json!({ "ok": true })
        }
        fn snapshot(&self) -> Value {
            json!({ "state": "idle" })
        }
        fn show(&self) {}
    }

    const JSON: Option<&str> = Some("application/json");

    #[test]
    fn health_and_state() {
        let sink = Recorder::default();
        assert_eq!(route(&Method::Get, "/health", None, b"", &sink).0, 200);
        assert_eq!(
            route(&Method::Get, "/state", None, b"", &sink).1["state"],
            "idle"
        );
        assert_eq!(route(&Method::Get, "/nope", None, b"", &sink).0, 404);
        assert_eq!(route(&Method::Delete, "/event", JSON, b"", &sink).0, 405);
    }

    #[test]
    fn post_event() {
        let sink = Recorder::default();
        let (status, _) = route(
            &Method::Post,
            "/event",
            Some("application/json; charset=utf-8"),
            br#"{"state":"done"}"#,
            &sink,
        );
        assert_eq!(status, 200);
        assert_eq!(sink.0.lock().unwrap()[0].state, AgentState::Done);
    }

    #[test]
    fn post_requires_json_content_type() {
        let sink = Recorder::default();
        assert_eq!(
            route(
                &Method::Post,
                "/event",
                Some("text/plain"),
                br#"{"state":"done"}"#,
                &sink
            )
            .0,
            415
        );
        assert_eq!(
            route(&Method::Post, "/event", None, br#"{"state":"done"}"#, &sink).0,
            415
        );
        assert!(sink.0.lock().unwrap().is_empty());
    }

    #[test]
    fn bad_and_ignored_events() {
        let sink = Recorder::default();
        assert_eq!(
            route(&Method::Post, "/event", JSON, br#"{"state":"nope"}"#, &sink).0,
            400
        );
        assert_eq!(
            route(
                &Method::Post,
                "/event",
                JSON,
                br#"{"hook_event_name":"SessionEnd"}"#,
                &sink
            )
            .0,
            202
        );
        assert!(sink.0.lock().unwrap().is_empty());
    }
}
