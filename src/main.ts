import { AnimationPlayer } from "./animation.ts";
import {
  acknowledge,
  appVersion,
  getSnapshot,
  inTauri,
  onCommand,
  onConfig,
  onPetEvent,
  offerUpdate,
  recordPet,
  setConfig,
  setHitRegions,
  showContextMenu,
  startDragging,
  type AgentState,
  type Config,
  type Progress,
  type Rect,
} from "./bridge.ts";
import { CanvasRenderer } from "./renderer.ts";
import { composeScene, PARTY_MS, type Hud } from "./scene.ts";
import { SKIN_IDS, type SkinId } from "./skins.ts";
import { play } from "./sound.ts";
import { PET_STATES, type PetState } from "./sprites.ts";
import { checkForUpdate } from "./updates.ts";

/** Demo mode tells a little story through every state, e.g. for recording a GIF. */
const DEMO_SEQUENCE: ReadonlyArray<[PetState, number, string | null]> = [
  ["idle", 2500, null],
  ["working", 2500, "Fixing the login bug…"],
  ["waiting", 3200, "Claude wants to run `npm test`. Allow?"],
  ["working", 2000, null],
  ["error", 3200, "npm test: 2 tests failed"],
  ["working", 2000, "Trying another approach…"],
  ["done", 5000, "Fixed the login bug. All 42 tests pass!"],
];

/** How long the level / XP bar stays visible after earning XP. */
const HUD_FLASH_MS = 3000;
/** How long done / error bubbles stay up (waiting stays until handled). */
const BUBBLE_MS = 7000;
/**
 * "working" events (prompt sent, tool finished) arrive often. They only take
 * over once the current reaction was visible for at least this long, so e.g.
 * a failed tool call followed by a quick retry still shows the error.
 */
const MIN_REACTION_MS = 2000;
/** Mouse travel (px) before a press turns into a window drag instead of a click. */
const DRAG_THRESHOLD = 3;
/** Nothing happening for this long and the pet dozes off... */
const SLEEP_AFTER_MS = 10 * 60_000;
/** ...sooner at night (22:00 to 06:00). */
const NIGHT_SLEEP_AFTER_MS = 3 * 60_000;
const UPDATE_CHECK_MS = 24 * 60 * 60_000;
/** How long a petting session lasts. */
const LOVE_MS = 2400;
/** Idle tricks (look around, yawn): checked this often, with this chance. */
const TRICK_CHECK_MS = 15_000;
const TRICK_CHANCE = 0.3;
const TRICKS: ReadonlyArray<[PetState, number]> = [
  ["look", 2300],
  ["yawn", 1850],
];
const PET_LINES = ["Hehe!", "That tickles!", "♥", "More pets please!", "Purr… wait, I'm not a cat."];

const KEY_STATES: Record<string, PetState> = {
  "1": "idle",
  "2": "done",
  "3": "waiting",
  "4": "error",
  "5": "working",
  "6": "sleep",
  "7": "love",
};

const canvas = document.querySelector<HTMLCanvasElement>("#pet")!;
const bubble = document.querySelector<HTMLDivElement>("#bubble")!;
const renderer = new CanvasRenderer(canvas);
const player = new AnimationPlayer();

let progress: Progress | null = null;
let config: Config = { skin: "classic", sound: false, bubbles: true, updates: true };
let hovering = false;
let hudUntil = 0;
let partyStart = -Infinity;
let shownSince = 0;
let lastActivity = performance.now();
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let demoTimer: ReturnType<typeof setTimeout> | undefined;
let calmTimer: ReturnType<typeof setTimeout> | undefined;
let moodTimer: ReturnType<typeof setTimeout> | undefined;
let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
/** Bubbles waiting for the current one to finish (achievements after a level-up). */
const bubbleQueue: Array<[string, PetState]> = [];

// ---------------------------------------------------------------------------
// Rendering

function render(): void {
  const now = performance.now();
  const frame = player.frameAt(now);
  const showHud = progress !== null && (hovering || now < hudUntil);
  const party = now - partyStart;
  renderer.draw(
    composeScene(player.current, frame, {
      // The level label would cover the speech bubble; the XP bar stays.
      hud: showHud ? { ...toHud(progress!), label: bubble.hidden } : undefined,
      level: progress?.level,
      skin: config.skin,
      party,
    }),
  );

  // Sleep until something can change: next frame, HUD hiding, confetti moving.
  let wait = player.msUntilNextFrame(now);
  if (hudUntil > now) wait = Math.min(wait, hudUntil - now);
  if (party < PARTY_MS) wait = Math.min(wait, 60);
  clearTimeout(frameTimer);
  frameTimer = setTimeout(render, Math.max(16, wait));
}

function toHud(p: Progress): Hud {
  return { level: p.level, progress: p.levelSize > 0 ? p.levelXp / p.levelSize : 0 };
}

function setState(state: PetState): void {
  clearTimeout(calmTimer);
  clearTimeout(moodTimer);
  if (state !== player.current) {
    player.play(state, performance.now());
    shownSince = performance.now();
    if (config.sound) play(state);
    if (state !== "waiting" && bubble.classList.contains("waiting")) hideBubble();
  }
  render();
}

/** Applies a state reported by the agent (see MIN_REACTION_MS). */
function applyAgentState(state: AgentState): void {
  const remaining = shownSince + MIN_REACTION_MS - performance.now();
  const reaction = player.current === "done" || player.current === "error";
  if (state === "working" && reaction && remaining > 0) {
    clearTimeout(calmTimer);
    calmTimer = setTimeout(() => setState("working"), remaining);
    return;
  }
  setState(state);
}

/** Something happened (hover, click, key): wake up if asleep. */
function touch(): void {
  lastActivity = performance.now();
  if (player.current === "sleep") setState("idle");
}

/** Plays one of the pet's own short moods, then goes back to idle. */
function playMood(mood: PetState, ms: number): void {
  setState(mood);
  moodTimer = setTimeout(() => {
    if (player.current === mood) setState("idle");
  }, ms);
}

/** Double-click: Bitling loves being petted. */
function pet(): void {
  stopDemo();
  playMood("love", LOVE_MS);
  if (Math.random() < 0.6) say(PET_LINES[Math.floor(Math.random() * PET_LINES.length)], "done");
  if (config.sound) play("done");
  void recordPet().then(announce);
}

/** Queues one bubble per unlocked achievement. */
function announce(titles: string[]): void {
  for (const title of titles) bubbleQueue.push([`🏆 Achievement unlocked: ${title}`, "done"]);
  if (bubble.hidden) nextBubble();
}

function nextBubble(): void {
  const next = bubbleQueue.shift();
  if (next) say(next[0], next[1]);
}

/** Now and then an idle pet looks around or yawns, so it never feels frozen. */
function maybeDoATrick(): void {
  if (player.current !== "idle" || demoTimer !== undefined || hovering || !bubble.hidden) return;
  if (Math.random() > TRICK_CHANCE) return;
  const [trick, ms] = TRICKS[Math.floor(Math.random() * TRICKS.length)];
  playMood(trick, ms);
}

/** Dozes off after a long quiet time; agent events and the user wake it up. */
function maybeFallAsleep(): void {
  const hour = new Date().getHours();
  const limit = hour >= 22 || hour < 6 ? NIGHT_SLEEP_AFTER_MS : SLEEP_AFTER_MS;
  const calm = player.current === "idle" || player.current === "done";
  if (calm && demoTimer === undefined && bubble.hidden && performance.now() - lastActivity > limit) {
    setState("sleep");
  }
}

function flashHud(ms = HUD_FLASH_MS): void {
  hudUntil = performance.now() + ms;
  render();
}

function celebrate(): void {
  partyStart = performance.now();
  flashHud(PARTY_MS + 1000);
  if (config.sound) play("levelup");
}

// ---------------------------------------------------------------------------
// Speech bubble

function say(text: string | null, kind: PetState, sticky = false): void {
  if (!text || !config.bubbles) return;
  const span = document.createElement("span");
  span.textContent = text;
  bubble.replaceChildren(span);
  bubble.className = kind;
  bubble.hidden = false;
  // Restart the pop-in animation.
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";
  clearTimeout(bubbleTimer);
  if (!sticky) bubbleTimer = setTimeout(hideBubble, BUBBLE_MS);
  updateHitRegions();
}

function hideBubble(): void {
  clearTimeout(bubbleTimer);
  bubble.hidden = true;
  bubble.className = "";
  updateHitRegions();
  // Show the next queued bubble after a short pause.
  if (bubbleQueue.length) setTimeout(() => bubble.hidden && nextBubble(), 400);
}

async function checkUpdates(): Promise<void> {
  const version = await appVersion();
  if (!version || !config.updates) return;
  const release = await checkForUpdate(version);
  if (!release) return;
  offerUpdate(release.version, release.url);
  say(`Bitling ${release.version} is out! Right-click me to download it.`, "done");
}

function defaultMessage(state: PetState, levelUp: boolean, level: number): string | null {
  if (levelUp) return `Level up! I'm level ${level} now ✨`;
  if (state === "waiting") return "I need your OK!";
  if (state === "error") return "Uh-oh, something broke.";
  if (state === "done") return "All done!";
  return null;
}

/** Only the pet and the bubble catch the mouse; the rest is click-through. */
function updateHitRegions(): void {
  const rects: Rect[] = [];
  const add = (el: Element) => {
    const r = el.getBoundingClientRect();
    rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  };
  add(canvas);
  if (!bubble.hidden) add(bubble);
  setHitRegions(rects);
}

// ---------------------------------------------------------------------------
// Demo mode

function startDemo(): void {
  stopDemo();
  let i = 0;
  const next = () => {
    const [state, ms, message] = DEMO_SEQUENCE[i++ % DEMO_SEQUENCE.length];
    setState(state);
    if (message) say(message, state, state === "waiting");
    if (state === "done") celebrate();
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
    hideBubble();
    setState("idle");
  }
}

function showManually(state: PetState): void {
  stopDemo();
  setState(state);
}

function applyConfig(next: Config): void {
  config = next;
  if (!config.bubbles) hideBubble();
  render();
}

// ---------------------------------------------------------------------------
// Input: drag to move, click to acknowledge, right-click for the menu,
// keys for testing.

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
  lastActivity = performance.now();
  // A plain click means "seen it": calm the pet down.
  acknowledge();
  hideBubble();
  showManually("idle");
});

canvas.addEventListener("mouseenter", () => {
  hovering = true;
  touch();
  render();
});

canvas.addEventListener("mouseleave", () => {
  hovering = false;
  press = null;
  render();
});

const openMenu = (e: MouseEvent) => {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
};
canvas.addEventListener("contextmenu", openMenu);
bubble.addEventListener("contextmenu", openMenu);
bubble.addEventListener("click", hideBubble);
canvas.addEventListener("dblclick", pet);

window.addEventListener("keydown", (e) => {
  lastActivity = performance.now();
  const state = KEY_STATES[e.key];
  if (state) showManually(state);
  else if (e.key === "d" || e.key === "D") toggleDemo();
  else if (e.key === "s" || e.key === "S") {
    // Cycle skins.
    const skin = SKIN_IDS[(SKIN_IDS.indexOf(config.skin) + 1) % SKIN_IDS.length];
    if (inTauri) setConfig({ skin });
    else applyConfig({ ...config, skin });
  } else if (e.key === "l" || e.key === "L") celebrate();
});

// ---------------------------------------------------------------------------
// Startup

async function main(): Promise<void> {
  player.play("idle", performance.now());
  render();
  updateHitRegions();

  await onPetEvent((event) => {
    progress = event.progress;
    lastActivity = performance.now();
    stopDemo(); // a real agent event always wins over the demo loop
    applyAgentState(event.state);
    // The bubble talks about this event (one session), even when another
    // session's pending approval keeps the pet in "waiting".
    const kind = event.eventState;
    let message = event.message ?? defaultMessage(kind, event.levelUp, event.progress.level);
    // With several agents at work, say which project this is about.
    if (message && event.project && event.sessions > 1) message = `[${event.project}] ${message}`;
    if (event.levelUp) {
      celebrate();
      say(defaultMessage(kind, true, event.progress.level), "done");
    } else if (kind === "done" || kind === "error" || kind === "waiting") {
      say(message, kind, kind === "waiting");
      if (kind === "done") flashHud();
    }
    if (event.achievements.length) announce(event.achievements);
  });
  await onConfig(applyConfig);
  await onCommand((command) => {
    if (command === "demo") toggleDemo();
    else if (command.startsWith("state:")) showManually(command.slice(6) as PetState);
  });

  const snapshot = await getSnapshot();
  if (snapshot) {
    progress = snapshot.progress;
    applyConfig(snapshot.config);
    setState(snapshot.state);
    if (snapshot.serverError) say(`⚠ ${snapshot.serverError}`, "error");
    else say(`Hi! I'm ${snapshot.name}. I'll keep an eye on your agents.`, "done");
  }

  // Browser preview helpers: ?demo, ?state=done, ?hud, ?skin=gameboy, ?level=12, ?say=Hello
  const params = new URLSearchParams(location.search);
  if (!inTauri) {
    const skin = params.get("skin") as SkinId | null;
    if (skin && SKIN_IDS.includes(skin)) applyConfig({ ...config, skin });
    const level = Number(params.get("level") ?? 0);
    if (level || params.has("hud")) progress = { xp: 130, level: level || 3, levelXp: 30, levelSize: 150 };
    if (params.has("hud")) hovering = true;
  }
  const pinned = params.get("state") as PetState | null;
  if (pinned && PET_STATES.includes(pinned)) showManually(pinned);
  if (params.has("say")) say(params.get("say"), pinned ?? "done", true);
  if (params.has("demo") || snapshot?.demo) startDemo();
  render();

  setInterval(maybeFallAsleep, 20_000);
  setInterval(maybeDoATrick, TRICK_CHECK_MS);
  void checkUpdates();
  setInterval(() => void checkUpdates(), UPDATE_CHECK_MS);
}

void main();
