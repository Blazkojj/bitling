// The browser playground: the real pet (main.ts) on a pretend desktop, driven
// by buttons and a scripted "Claude Code session" through window.bitling.

import "./main.ts";
import type { PetState } from "./sprites.ts";

const api = window.bitling!;
const terminal = document.querySelector<HTMLPreElement>("#terminal")!;
const simulateButton = document.querySelector<HTMLButtonElement>("#simulate")!;

// ---------------------------------------------------------------------------
// Controls

function markOn(group: string, button: HTMLElement): void {
  document.querySelectorAll(`[data-group="${group}"] button:not([data-action])`).forEach((b) => b.classList.remove("on"));
  button.classList.add("on");
}

document.querySelectorAll<HTMLButtonElement>(".controls button").forEach((button) => {
  button.addEventListener("click", () => {
    const { state, message, skin, size, level, action } = button.dataset;
    stopSimulation();
    if (state) api.show(state as PetState, message);
    if (skin) {
      api.skin(skin as Parameters<typeof api.skin>[0]);
      markOn("skin", button);
    }
    if (size) {
      api.size(size as Parameters<typeof api.size>[0]);
      markOn("size", button);
    }
    if (level) {
      api.level(Number(level));
      markOn("level", button);
    }
    if (action === "pet") api.pet();
    if (action === "party") api.party();
  });
});

// ---------------------------------------------------------------------------
// A scripted session: terminal lines and the pet's reactions, in sync.

type Step =
  | { line: string; cls?: string; typed?: boolean }
  | { pet: PetState; say?: string }
  | { wait: number }
  | { party: true };

const SESSION: Step[] = [
  { line: "$ claude", cls: "dim" },
  { wait: 500 },
  { line: "> Fix the failing login test", typed: true },
  { pet: "working" },
  { wait: 700 },
  { line: "⏺ Read(src/auth.ts)" },
  { wait: 600 },
  { line: "⏺ Edit(src/auth.ts)" },
  { wait: 700 },
  { line: "⏺ Bash(npm test)", cls: "ask" },
  { line: "  Allow Claude to run `npm test`? (y/n)", cls: "ask" },
  { pet: "waiting", say: "Claude wants to run `npm test`. Allow?" },
  { wait: 2600 },
  { line: "  y", typed: true },
  { pet: "working" },
  { wait: 900 },
  { line: "  ✗ 2 tests failed", cls: "err" },
  { pet: "error", say: "npm test: 2 tests failed" },
  { wait: 2600 },
  { line: "⏺ Edit(src/session.ts)" },
  { pet: "working" },
  { wait: 900 },
  { line: "⏺ Bash(npm test)" },
  { wait: 800 },
  { line: "  ✓ 42 tests passed", cls: "ok" },
  { wait: 400 },
  { line: "⏺ Fixed the login bug: the session token expired one hour early." },
  { pet: "done", say: "Fixed the login bug. All 42 tests pass!" },
  { party: true },
];

let running = 0; // bumps on every start/stop, so stale timers do nothing

function stopSimulation(): void {
  running++;
  simulateButton.textContent = "▶ Simulate a Claude Code session";
}

async function simulate(): Promise<void> {
  const id = ++running;
  simulateButton.textContent = "■ Stop";
  terminal.replaceChildren();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const step of SESSION) {
    if (id !== running) return;
    if ("wait" in step) await sleep(step.wait);
    else if ("party" in step) api.party();
    else if ("pet" in step) api.show(step.pet, step.say);
    else {
      const span = document.createElement("span");
      if (step.cls) span.className = step.cls;
      terminal.append(span, "\n");
      if (step.typed) {
        for (const ch of step.line) {
          if (id !== running) return;
          span.textContent += ch;
          await sleep(35);
        }
      } else {
        span.textContent = step.line;
      }
    }
  }
  if (id === running) simulateButton.textContent = "↻ Run it again";
}

simulateButton.addEventListener("click", () => {
  if (simulateButton.textContent?.startsWith("■")) stopSimulation();
  else void simulate();
});

// Say hello, then start the show once.
api.size("large");
api.say("Hi! I'm Bitling. Press the blue button →");
setTimeout(() => {
  if (running === 0) void simulate();
}, 2500);
