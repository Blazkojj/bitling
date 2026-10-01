import { AnimationPlayer } from "./animation.ts";
import {
  getSnapshot,
  inTauri,
  onPetEvent,
  quit,
  showContextMenu,
  startDragging,
  type AgentState,
  type Progress,
} from "./bridge.ts";
import { CanvasRenderer } from "./renderer.ts";
import { composeScene, type Hud } from "./scene.ts";
import { PET_STATES, type PetState } from "./sprites.ts";

/** Demo mode loops through every state, e.g. for recording a GIF. */
const DEMO_SEQUENCE: ReadonlyArray<[PetState, number]> = [
  ["idle", 3000],
  ["waiting", 3000],
  ["done", 3000],
  ["error", 3000],
];

/** How long the level / XP bar stays visible after earning XP. */
const HUD_FLASH_MS = 3000;
/**
 * "working" events (prompt sent, tool finished) arrive often. They only calm
 * the pet down once the current reaction was visible for at least this long,
 * so e.g. a failed tool call followed by a quick retry still shows the error.
 */
const MIN_REACTION_MS = 2000;
/** Mouse travel (px) before a press turns into a window drag instead of a click. */
const DRAG_THRESHOLD = 3;

const LABELS: Record<PetState, string> = {
  idle: "Idle",
  working: "Working",
  done: "Done",
  waiting: "Waiting for you",
  error: "Error",
};

const KEY_STATES: Record<string, PetState> = { "1": "idle", "2": "done", "3": "waiting", "4": "error" };

const canvas = document.querySelector<HTMLCanvasElement>("#pet")!;
const renderer = new CanvasRenderer(canvas);
const player = new AnimationPlayer();

let progress: Progress | null = null;
let serverNote: string | null = null;
let hovering = false;
let hudUntil = 0;
let shownSince = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let demoTimer: ReturnType<typeof setTimeout> | undefined;
let calmTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Rendering

function render(): void {
  const now = performance.now();
  const frame = player.frameAt(now);
  const showHud = progress !== null && (hovering || now < hudUntil);
  renderer.draw(composeScene(player.current, frame, { hud: showHud ? toHud(progress!) : undefined, level: progress?.level }));

  // Sleep until something can change: the next frame or the HUD hiding.
  let wait = player.msUntilNextFrame(now);
  if (hudUntil > now) wait = Math.min(wait, hudUntil - now);
  clearTimeout(frameTimer);
  frameTimer = setTimeout(render, Math.max(16, wait));
}

function toHud(p: Progress): Hud {
  return { level: p.level, progress: p.levelSize > 0 ? p.levelXp / p.levelSize : 0 };
}

function setState(state: AgentState): void {
  clearTimeout(calmTimer);
  const visual: PetState = state;
  // Re-sending the current state must not restart its animation.
  if (visual !== player.current) {
    player.play(visual, performance.now());
    shownSince = performance.now();
  }
  render();
}

/** Applies a state reported by the agent (see MIN_REACTION_MS). */
function applyAgentState(state: AgentState): void {
  const remaining = shownSince + MIN_REACTION_MS - performance.now();
  if (state === "working" && player.current !== "idle" && remaining > 0) {
    clearTimeout(calmTimer);
    calmTimer = setTimeout(() => setState("working"), remaining);
    return;
  }
  setState(state);
}

function flashHud(ms = HUD_FLASH_MS): void {
  hudUntil = performance.now() + ms;
  render();
}

// ---------------------------------------------------------------------------
// Demo mode

function startDemo(): void {
  stopDemo();
  let i = 0;
  const next = () => {
    const [state, ms] = DEMO_SEQUENCE[i++ % DEMO_SEQUENCE.length];
    setState(state);
    demoTimer = setTimeout(next, ms);
  };
  next();
}

function stopDemo(): void {
  clearTimeout(demoTimer);
  demoTimer = undefined;
}

function toggleDemo(): void {
  if (demoTimer === undefined) startDemo();
  else {
    stopDemo();
    setState("idle");
  }
}

function showManually(state: PetState): void {
  stopDemo();
  setState(state);
}

// ---------------------------------------------------------------------------
// Input: drag to move, click to acknowledge, right-click for the menu,
// keys 1-4 / D for testing.

let press: { x: number; y: number } | null = null;

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) press = { x: e.screenX, y: e.screenY };
});

canvas.addEventListener("mousemove", (e) => {
  if (!press || (e.buttons & 1) === 0) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) > DRAG_THRESHOLD) {
    press = null;
    startDragging();
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !press) return;
  press = null;
  // A plain click means "seen it": calm the pet down.
  showManually("idle");
});

canvas.addEventListener("mouseenter", () => {
  hovering = true;
  render();
});

canvas.addEventListener("mouseleave", () => {
  hovering = false;
  press = null;
  render();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  void showContextMenu([
    { text: progress ? `Level ${progress.level} · ${progress.xp} XP` : "Bitling", enabled: false },
    ...(serverNote ? [{ text: serverNote, enabled: false }] : []),
    "separator",
    { text: "Demo mode", checked: demoTimer !== undefined, action: toggleDemo },
    {
      submenu: "Show state",
      items: PET_STATES.map((s) => ({ text: LABELS[s], action: () => showManually(s) })),
    },
    "separator",
    { text: "Quit Bitling", action: quit },
  ]);
});

window.addEventListener("keydown", (e) => {
  const state = KEY_STATES[e.key];
  if (state) showManually(state);
  else if (e.key === "d" || e.key === "D") toggleDemo();
});

// ---------------------------------------------------------------------------
// Startup

async function main(): Promise<void> {
  player.play("idle", performance.now());
  render();

  await onPetEvent((event) => {
    progress = event.progress;
    stopDemo(); // a real agent event always wins over the demo loop
    applyAgentState(event.state);
    if (event.levelUp) flashHud(HUD_FLASH_MS * 2);
    else if (event.state === "done") flashHud();
  });

  const snapshot = await getSnapshot();
  if (snapshot) {
    progress = snapshot.progress;
    serverNote = snapshot.serverError
      ? `⚠ ${snapshot.serverError}`
      : `Listening on 127.0.0.1:${snapshot.port}`;
    setState(snapshot.state);
  }

  // Browser preview helpers: ?demo, ?state=done, ?hud
  const params = new URLSearchParams(location.search);
  const pinned = params.get("state") as PetState | null;
  if (pinned && PET_STATES.includes(pinned)) showManually(pinned);
  if (params.has("demo") || snapshot?.demo) startDemo();
  if (params.has("hud") && !inTauri) {
    progress = { xp: 130, level: 3, levelXp: 30, levelSize: 150 };
    hovering = true;
    render();
  }
}

void main();
