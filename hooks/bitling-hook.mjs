#!/usr/bin/env node
// Bitling hook for Claude Code, Gemini CLI, Codex CLI, Cursor, Aider (and
// anything else that can run a command).
//
//   node bitling-hook.mjs <state> [--source claude-code|gemini|codex|cursor|aider]
//
// state: done | waiting | error | working | idle
//
// Reads the agent's JSON payload from stdin (Claude Code, Gemini CLI) or from
// the last argument (Codex `notify`), then POSTs
// {"state", "source", "event", "message", "session"} to the Bitling app on
// http://127.0.0.1:47800/event (override with BITLING_PORT).
//
// Golden rule: never get in the agent's way. The script always exits 0,
// writes nothing to stdout (Claude Code parses it) except the JSON Gemini CLI
// and Cursor expect, and gives up quickly when Bitling is not running.
//
// `scripts/install-hooks.mjs` copies this file to ~/.bitling/ and registers
// it with the agent. It has no dependencies on purpose.

import http from "node:http";

const STATES = new Set(["idle", "working", "done", "waiting", "error"]);
const PORT = Number(process.env.BITLING_PORT) || 47800;
const TIMEOUT_MS = 1500;
const MAX_MESSAGE = 200;

// Hard stop, whatever happens below.
setTimeout(() => process.exit(0), TIMEOUT_MS + 500).unref();

const args = process.argv.slice(2);
let state = args[0];
let payload = null;
const sourceFlag = args.indexOf("--source");
const source = (sourceFlag >= 0 && args[sourceFlag + 1]) || process.env.BITLING_SOURCE || "claude-code";

if (!STATES.has(state)) {
  process.stderr.write(`bitling-hook: unknown state "${state}" (expected ${[...STATES].join(", ")})\n`);
  finish();
}

// Codex passes its payload as the last argument; the others use stdin.
const last = args[args.length - 1];
payload = last?.startsWith("{") ? parseJson(last) : await readStdinJson();

// Gemini reports failed tools through AfterTool, not a separate event.
if (payload?.hook_event_name === "AfterTool" && payload.tool_response?.error) state = "error";
// Cursor's stop hook carries how the turn ended.
if (payload?.hook_event_name === "stop" && payload.status === "error") state = "error";
if (payload?.hook_event_name === "stop" && payload.status === "aborted") state = "idle";

await post({
  state,
  source,
  event: payload?.hook_event_name ?? payload?.type ?? null,
  message: describe(payload),
  session: payload?.session_id ?? payload?.["thread-id"] ?? null,
});
finish();

function finish() {
  if (source === "gemini") process.stdout.write("{}");
  // Cursor reads a decision from beforeSubmitPrompt: always let the prompt through.
  if (source === "cursor") {
    process.stdout.write(payload?.hook_event_name === "beforeSubmitPrompt" ? '{"continue":true}' : "{}");
  }
  process.exit(0);
}

/** A short human-readable note for the pet's speech bubble. */
function describe(p) {
  if (!p) return null;
  let text = null;
  switch (p.hook_event_name ?? p.type) {
    case "Notification":
      text = p.message;
      break;
    case "Stop": // Claude Code
      text = firstLine(p.last_assistant_message);
      break;
    case "AfterAgent": // Gemini CLI
      text = firstLine(p.prompt_response);
      break;
    case "agent-turn-complete": // Codex CLI
      text = firstLine(p["last-assistant-message"]);
      break;
    case "StopFailure":
      text = p.error_message ?? p.error_type;
      break;
    case "PostToolUseFailure":
      text = [p.tool_name, firstLine(p.error ?? p.tool_error)].filter(Boolean).join(": ");
      break;
    case "AfterTool":
      if (p.tool_response?.error) text = [p.tool_name, firstLine(String(p.tool_response.error))].join(": ");
      break;
  }
  if (typeof text !== "string" || !text.trim()) return null;
  text = text.trim();
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/** First non-empty line of a (markdown) text, without leading markup. */
function firstLine(value) {
  if (typeof value !== "string") return null;
  for (const line of value.split("\n")) {
    const clean = line.trim().replace(/^[#*>`\- ]+/, "").trim();
    if (clean) return clean;
  }
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Reads all of stdin as JSON; resolves null for a TTY, empty or invalid input. */
function readStdinJson() {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    const done = () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    };
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", done);
    process.stdin.on("error", () => resolve(null));
    // Don't wait forever if the caller never closes stdin.
    setTimeout(done, 500).unref();
  });
}

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/event",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", resolve); // Bitling not running: that's fine.
    req.end(data);
  });
}
