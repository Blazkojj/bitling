#!/usr/bin/env node
// Bitling hook for Claude Code (and anything else that can run a command).
//
//   node bitling-hook.mjs <state>      state: done | waiting | error | working | idle
//
// Reads the hook's JSON payload from stdin (if any), then POSTs
// {"state", "source", "event", "message"} to the Bitling app on
// http://127.0.0.1:47800/event (override with BITLING_PORT).
//
// Golden rule: never get in the agent's way. The script always exits 0,
// never writes to stdout (Claude Code parses hook stdout), and gives up
// quickly when Bitling is not running.
//
// `scripts/install-hooks.mjs` copies this file to ~/.bitling/ and registers
// it in Claude Code's settings. It has no dependencies on purpose.

import http from "node:http";

const STATES = new Set(["idle", "working", "done", "waiting", "error"]);
const PORT = Number(process.env.BITLING_PORT) || 47800;
const TIMEOUT_MS = 1500;
const MAX_MESSAGE = 200;

// Hard stop, whatever happens below.
setTimeout(() => process.exit(0), TIMEOUT_MS + 500).unref();

const state = process.argv[2];
if (!STATES.has(state)) {
  process.stderr.write(`bitling-hook: unknown state "${state}" (expected ${[...STATES].join(", ")})\n`);
  process.exit(0);
}

const payload = await readStdinJson();
await post({
  state,
  source: process.env.BITLING_SOURCE || "claude-code",
  event: payload?.hook_event_name ?? null,
  message: describe(payload),
});
process.exit(0);

/** A short human-readable note for the pet, taken from the hook payload. */
function describe(p) {
  if (!p) return null;
  let text = null;
  switch (p.hook_event_name) {
    case "Notification":
      text = p.message;
      break;
    case "StopFailure":
      text = p.error_message ?? p.error_type;
      break;
    case "PostToolUseFailure":
      text = [p.tool_name, firstLine(p.tool_error ?? p.error)].filter(Boolean).join(": ");
      break;
  }
  if (typeof text !== "string" || !text.trim()) return null;
  text = text.trim();
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

function firstLine(value) {
  return typeof value === "string" ? value.split("\n")[0] : null;
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
