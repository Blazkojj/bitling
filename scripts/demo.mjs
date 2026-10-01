#!/usr/bin/env node
// Drives a running Bitling over HTTP without any agent: great for testing the
// whole pipeline and for recording the demo GIF.
//
//   npm run demo                 play a short story through every state
//   npm run demo -- --loop       ...and keep looping (Ctrl+C to stop)
//   npm run demo -- waiting      set a single state (idle|working|done|waiting|error)
//
// Demo events use source "demo", so they never earn XP.

import http from "node:http";

const PORT = Number(process.env.BITLING_PORT) || 47800;
const STATES = ["idle", "working", "done", "waiting", "error"];

/** [state, how long to hold it (ms), what the agent is "doing"] */
const STORY = [
  ["idle", 2500, "Bitling is chilling in the corner"],
  ["working", 1500, "You ask Claude to fix a bug"],
  ["waiting", 3500, "Claude wants to run `npm test` and needs your OK"],
  ["working", 1500, "You approve, Claude keeps going"],
  ["error", 3500, "A tool call failed"],
  ["working", 1500, "Claude recovers"],
  ["done", 4000, "Task finished!"],
];

const args = process.argv.slice(2);
const single = args.find((a) => !a.startsWith("--"));

if (!(await isRunning())) {
  console.error(`Bitling is not listening on 127.0.0.1:${PORT}. Start it first with \`npm run app\`.`);
  process.exit(1);
}

if (single) {
  if (!STATES.includes(single)) {
    console.error(`Unknown state "${single}". Use one of: ${STATES.join(", ")}`);
    process.exit(1);
  }
  await send(single, "set from the command line");
  console.log(`Bitling is now: ${single}`);
} else {
  do {
    for (const [state, ms, story] of STORY) {
      console.log(`${state.padEnd(8)} ${story}`);
      await send(state, story);
      await sleep(ms);
    }
  } while (args.includes("--loop"));
  await send("idle", "demo finished");
}

function send(state, message) {
  return request("POST", "/event", { state, source: "demo", message });
}

async function isRunning() {
  try {
    return (await request("GET", "/health")).app === "bitling";
  } catch {
    return false;
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method,
        timeout: 2000,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`unexpected response: ${text}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(data);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
