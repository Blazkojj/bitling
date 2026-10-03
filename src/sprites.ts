// Bitling's pixel art, written as plain ASCII so anyone can tweak it in a PR.
//
// Every sprite is a 10x9 grid. Each character is one "big pixel" that is
// scaled x8 on screen. The outline around the creature is NOT drawn here:
// scene.ts adds it automatically around every opaque pixel, which keeps the
// art readable on both light and dark wallpapers.
//
// Characters:
//   .  transparent        B  body            D  body shade
//   H  body highlight     E  ink (eyes, mouth, antenna stalk)
//   A  antenna tip        L  legs            P  pink (cheeks, tongue)
//   R  alert red          W  white           g/G leaf green (accessories)

/** Moods the pet has on its own (agents never send them). */
export type OwnMood = "sleep" | "love" | "look" | "yawn";
export type PetState = "idle" | "working" | "done" | "waiting" | "error" | OwnMood;

export const PET_STATES: readonly PetState[] = [
  "idle",
  "working",
  "done",
  "waiting",
  "error",
  "sleep",
  "love",
  "look",
  "yawn",
];

export const SPRITE_W = 10;
export const SPRITE_H = 9;

/** SPRITE_H rows, each SPRITE_W characters long. */
export type Grid = readonly string[];

/** Maps sprite/stamp characters to CSS colors. */
export type Palette = Readonly<Record<string, string>>;

/** Small decorations drawn around the creature (sparkles, "!", sweat drop). */
export type StampName =
  | "sparkle"
  | "twinkle"
  | "bang"
  | "drop"
  | "dot1"
  | "dot2"
  | "dot3"
  | "z"
  | "Z"
  | "heart";

/** Stamps drawn after the outline pass: thin glyphs that an outline would fill in. */
export const FLOATING_STAMPS: ReadonlySet<StampName> = new Set(["z", "Z"]);

export interface Fx {
  stamp: StampName;
  /** Position relative to the sprite's top-left corner, in big pixels. */
  x: number;
  y: number;
}

export interface Frame {
  sprite: Grid;
  /** Whole-sprite offset in big pixels (jumps, shakes). */
  dx?: number;
  dy?: number;
  fx?: readonly Fx[];
}

/** One step of an animation: which frame to show and for how long. */
export interface Step {
  frame: number;
  ms: number;
  /** Optional random extra time (0..jitter ms) so idle blinks feel alive. */
  jitter?: number;
}

export interface Animation {
  palette: Palette;
  frames: readonly Frame[];
  /** Played in order and looped. */
  steps: readonly Step[];
}

// ---------------------------------------------------------------------------
// Colors (a PICO-8 flavoured palette)

export const OUTLINE = "#1d2b53";
export const SHADOW = "rgba(29, 43, 83, 0.28)";

const COMMON: Palette = {
  E: "#1d2b53",
  L: "#1d2b53",
  P: "#ff77a8",
  R: "#ff004d",
  W: "#fff1e8",
  // stamp colors
  y: "#ffec27",
  o: "#ffa300",
  b: "#29adff",
  w: "#fff1e8",
  r: "#ff004d",
  g: "#00e436",
  G: "#008751",
};

const palette = (body: string, shade: string, highlight: string, tip: string): Palette => ({
  ...COMMON,
  B: body,
  D: shade,
  H: highlight,
  A: tip,
});

// ---------------------------------------------------------------------------
// Decorations. Same character rules as sprites; drawn on top of the creature.

export const STAMPS: Readonly<Record<StampName, Grid>> = {
  sparkle: [
    ".y.",
    "ywy",
    ".y.",
  ],
  twinkle: [
    "w",
  ],
  bang: [
    "r",
    "r",
    "r",
    ".",
    "r",
  ],
  // "thinking..." dots, shown one after another
  dot1: ["w...."],
  dot2: ["w.w.."],
  dot3: ["w.w.w"],
  heart: ["P.P", "PPP", ".P."],
  // Zzz while sleeping (drawn without an outline, see FLOATING_STAMPS)
  z: ["bbb", ".b.", "b..", "bbb"],
  Z: ["bbb", "..b", ".b.", "b..", "bbb"],
  drop: [
    ".b",
    "bw",
    "bb",
  ],
};

// ---------------------------------------------------------------------------
// idle: calm blinking, swaying antenna, gentle breathing

const IDLE_OPEN: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHEBBEBB.",
  ".BBEBBEBD.",
  ".BBBBBBBD.",
  ".BBBEEBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// Body squashed down by one pixel, antenna leaning the other way.
const IDLE_BREATHE: Grid = [
  "..........",
  "....A.....",
  ".....E....",
  "..HHBBBB..",
  ".BHEBBEBB.",
  ".BBEBBEBD.",
  ".BBBEEBBD.",
  "..DDDDDD..",
  "..L....L..",
];

const IDLE_BLINK: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHBBBBBB.",
  ".BBEBBEBD.",
  ".BBBBBBBD.",
  ".BBBEEBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// sleep: closed eyes, antenna drooping to the side, slow breathing, Zzz

const SLEEP_IN: Grid = [
  "..........",
  "..........",
  "....AE....",
  "..HHBBBB..",
  ".BHBBBBBB.",
  ".BEEBBEED.",
  ".BBBBBBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// Breathing out: one pixel flatter.
const SLEEP_OUT: Grid = [
  "..........",
  "..........",
  "..........",
  "...AE.....",
  ".HHBBBBBB.",
  ".BEEBBEED.",
  ".BBBBBBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// love: being petted (double-click): happy eyes, blush, little hops, hearts

const LOVE: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHBBBBBB.",
  ".BBEBBEBD.",
  ".BEBBBBED.",
  ".BPBEEBPD.",
  "..DDPPDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// idle tricks: looking around, yawning

const LOOK_LEFT: Grid = [
  ".....A....",
  ".....E....",
  "..HHBBBB..",
  ".BEBBEBBB.",
  ".BEBBEBBD.",
  ".BBBBBBBD.",
  ".BBEEBBBD.",
  "..DDDDDD..",
  "..L....L..",
];

const LOOK_RIGHT: Grid = [
  ".......A..",
  "......E...",
  "..HHBBBB..",
  ".BHBEBBEB.",
  ".BBBEBBED.",
  ".BBBBBBBD.",
  ".BBBBEEBD.",
  "..DDDDDD..",
  "..L....L..",
];

const YAWN: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHBBBBBB.",
  ".BBEBBEBD.",
  ".BBBEEBBD.",
  ".BBEPPEBD.",
  "..DDEEDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// working: focused eyes glancing up, busy antenna, "..." thinking dots

const WORK_FOCUS: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHEBBEBB.",
  ".BBBBBBBD.",
  ".BBBBBBBD.",
  ".BBBBEBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// Antenna tip flashes while it "computes".
const WORK_FLASH: Grid = [
  "......W...",
  ".....E....",
  "..HHBBBB..",
  ".BHBEBBEB.",
  ".BBBBBBBD.",
  ".BBBBBBBD.",
  ".BBBBEBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// done: green, big smile, jumping, sparkles

const DONE_SMILE: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHEBBEBB.",
  ".BBEBBEBD.",
  ".BPBBBBPD.",
  ".BBBEEBBD.",
  "..DDPPDD..",
  "..L....L..",
];

// Arms up, legs tucked: drawn 2px higher by the frame offset.
const DONE_JUMP: Grid = [
  "......A...",
  ".....E....",
  "B.HHBBBB.B",
  "BBHEBBEBBB",
  ".BBEBBEBD.",
  ".BPBBBBPD.",
  ".BBBEEBBD.",
  "..DDPPDD..",
  "...L..L...",
];

// Happy squinting eyes: ^ ^
const DONE_SQUINT: Grid = [
  "......A...",
  ".....E....",
  "..HHBBBB..",
  ".BHBBBBBB.",
  ".BBEBBEBD.",
  ".BEBBBBED.",
  ".BPBEEBPD.",
  "..DDPPDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// waiting: yellow, wide open eyes looking around, "!" above the head

// The white glint moves between frames, so the eyes seem to dart around.
const WAIT_LOOK_LEFT: Grid = [
  ".....R....",
  ".....E....",
  "..HHBBBB..",
  ".BWEBBWEB.",
  ".BEEBBEED.",
  ".BEEBBEED.",
  ".BBBBBBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// Antenna tip flashes white.
const WAIT_LOOK_RIGHT: Grid = [
  ".....W....",
  ".....E....",
  "..HHBBBB..",
  ".BEWBBEWB.",
  ".BEEBBEED.",
  ".BEEBBEED.",
  ".BBBBBBBD.",
  "..DDDDDD..",
  "..L....L..",
];

// ---------------------------------------------------------------------------
// error: pale, deflated, X eyes, drooping antenna, sweat drop

// The body is one row shorter and wider than usual: it has deflated.
const ERROR_SLUMP: Grid = [
  "..........",
  "...DD.....",
  "..A..D....",
  ".BBBBBBBB.",
  "BEBEBBEBEB",
  "BBEBBBBEBD",
  "BEBEBBEBED",
  ".DDDDDDDD.",
  "..L....L..",
];

// The wilted antenna wobbles.
const ERROR_WOBBLE: Grid = [
  "..........",
  "....D.....",
  "...A.D....",
  ".BBBBBBBB.",
  "BEBEBBEBEB",
  "BBEBBBBEBD",
  "BEBEBBEBED",
  ".DDDDDDDD.",
  "..L....L..",
];

// ---------------------------------------------------------------------------

const IDLE_PALETTE = palette("#29adff", "#1a75c9", "#a8e4ff", "#ff77a8");

export const ANIMATIONS: Readonly<Record<PetState, Animation>> = {
  love: {
    palette: IDLE_PALETTE,
    frames: [
      // Hearts float up from both sides of the head.
      { sprite: LOVE, dy: -1, fx: [{ stamp: "heart", x: -2, y: -1 }] },
      { sprite: LOVE, fx: [{ stamp: "heart", x: -2, y: -3 }, { stamp: "heart", x: 9, y: -1 }] },
      { sprite: LOVE, dy: -1, fx: [{ stamp: "heart", x: -1, y: -5 }, { stamp: "heart", x: 9, y: -3 }] },
      { sprite: LOVE, fx: [{ stamp: "heart", x: 9, y: -5 }] },
    ],
    steps: [
      { frame: 0, ms: 300 },
      { frame: 1, ms: 300 },
      { frame: 2, ms: 300 },
      { frame: 3, ms: 300 },
    ],
  },
  look: {
    palette: IDLE_PALETTE,
    frames: [{ sprite: LOOK_LEFT }, { sprite: IDLE_OPEN }, { sprite: LOOK_RIGHT }],
    steps: [
      { frame: 0, ms: 900 },
      { frame: 1, ms: 250 },
      { frame: 2, ms: 900 },
      { frame: 1, ms: 250 },
    ],
  },
  yawn: {
    palette: IDLE_PALETTE,
    frames: [{ sprite: IDLE_BLINK }, { sprite: YAWN, dy: -1 }],
    steps: [
      { frame: 0, ms: 250 },
      { frame: 1, ms: 1300 },
      { frame: 0, ms: 300 },
    ],
  },
  sleep: {
    palette: palette("#29adff", "#1a75c9", "#a8e4ff", "#ff77a8"),
    frames: [
      { sprite: SLEEP_IN, fx: [{ stamp: "z", x: 8, y: -1 }] },
      { sprite: SLEEP_OUT, fx: [{ stamp: "z", x: 8, y: 0 }, { stamp: "Z", x: 10, y: -6 }] },
    ],
    steps: [
      { frame: 0, ms: 1400 },
      { frame: 1, ms: 1400 },
    ],
  },
  idle: {
    palette: palette("#29adff", "#1a75c9", "#a8e4ff", "#ff77a8"),
    frames: [{ sprite: IDLE_OPEN }, { sprite: IDLE_BREATHE }, { sprite: IDLE_BLINK }],
    steps: [
      { frame: 0, ms: 700 },
      { frame: 1, ms: 700 },
      { frame: 0, ms: 700 },
      { frame: 1, ms: 700 },
      { frame: 0, ms: 300, jitter: 1500 },
      { frame: 2, ms: 140 },
    ],
  },
  working: {
    palette: palette("#29adff", "#1a75c9", "#a8e4ff", "#ff77a8"),
    frames: [
      { sprite: WORK_FOCUS, fx: [{ stamp: "dot1", x: 7, y: -1 }] },
      { sprite: WORK_FLASH, fx: [{ stamp: "dot2", x: 7, y: -1 }] },
      { sprite: WORK_FOCUS, fx: [{ stamp: "dot3", x: 7, y: -1 }] },
    ],
    steps: [
      { frame: 0, ms: 420 },
      { frame: 1, ms: 420 },
      { frame: 2, ms: 420 },
    ],
  },
  done: {
    palette: palette("#00e436", "#008751", "#b8ffc0", "#ffec27"),
    frames: [
      {
        sprite: DONE_SMILE,
        fx: [{ stamp: "sparkle", x: -3, y: 0 }, { stamp: "twinkle", x: 11, y: 5 }],
      },
      {
        sprite: DONE_JUMP,
        dy: -2,
        fx: [{ stamp: "twinkle", x: -2, y: 4 }, { stamp: "sparkle", x: 10, y: -1 }],
      },
      {
        sprite: DONE_SQUINT,
        fx: [{ stamp: "sparkle", x: -3, y: 5 }, { stamp: "twinkle", x: 11, y: 0 }],
      },
    ],
    steps: [
      { frame: 0, ms: 260 },
      { frame: 1, ms: 260 },
      { frame: 2, ms: 260 },
      { frame: 1, ms: 260 },
    ],
  },
  waiting: {
    palette: palette("#ffec27", "#ffa300", "#fff7b0", "#ff004d"),
    frames: [
      { sprite: WAIT_LOOK_LEFT, fx: [{ stamp: "bang", x: 10, y: -2 }] },
      { sprite: WAIT_LOOK_RIGHT, dx: 1, fx: [{ stamp: "bang", x: 10, y: -3 }] },
      { sprite: WAIT_LOOK_LEFT, dx: -1, fx: [{ stamp: "bang", x: 10, y: -2 }] },
    ],
    steps: [
      { frame: 0, ms: 420 },
      { frame: 1, ms: 320 },
      { frame: 0, ms: 420 },
      { frame: 2, ms: 320 },
    ],
  },
  error: {
    palette: palette("#c2c3c7", "#8b8a9c", "#e8e8ee", "#83769c"),
    frames: [
      { sprite: ERROR_SLUMP, fx: [{ stamp: "drop", x: 10, y: 0 }] },
      { sprite: ERROR_WOBBLE, fx: [{ stamp: "drop", x: 10, y: 1 }] },
      { sprite: ERROR_SLUMP, fx: [{ stamp: "drop", x: 10, y: 2 }] },
      { sprite: ERROR_WOBBLE, dx: -1, fx: [{ stamp: "drop", x: 10, y: 3 }] },
    ],
    steps: [
      { frame: 0, ms: 520 },
      { frame: 1, ms: 520 },
      { frame: 2, ms: 520 },
      { frame: 3, ms: 520 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Evolutions: accessories earned with levels, drawn on top of the head.

export interface Accessory {
  minLevel: number;
  grid: Grid;
  /** Column (in sprite coordinates) of the accessory's left edge. */
  x: number;
}

export const ACCESSORIES: readonly Accessory[] = [
  // Level 5: a little sprout on the head
  { minLevel: 5, x: 7, grid: [".g", "gG"] },
  // Level 10: a tiny crown
  { minLevel: 10, x: 2, grid: ["y.y", "yyy"] },
];
