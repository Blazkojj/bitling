// Skins recolor Bitling without touching the pixel art: each one overrides
// palette entries per state (see the character legend in sprites.ts).

import type { Palette, PetState } from "./sprites.ts";

export type SkinId = "classic" | "pastel" | "midnight" | "gameboy";

export interface Skin {
  name: string;
  /** Overrides applied to every state. */
  all?: Palette;
  /** Overrides for single states (applied after `all`). */
  states?: Partial<Record<PetState, Palette>>;
  outline?: string;
}

/** body, shade, highlight, antenna tip */
const body = (B: string, D: string, H: string, A: string): Palette => ({ B, D, H, A });

const GB_DARK = "#0f380f";

export const SKINS: Readonly<Record<SkinId, Skin>> = {
  classic: { name: "Classic" },
  pastel: {
    name: "Pastel",
    states: {
      idle: body("#a5d8ff", "#74b0e8", "#e3f3ff", "#ffb3c7"),
      working: body("#a5d8ff", "#74b0e8", "#e3f3ff", "#ffb3c7"),
      done: body("#b8f2c2", "#7fcf91", "#e8fff0", "#ffe680"),
      waiting: body("#ffe89a", "#f5c45e", "#fff8d6", "#ff8fa3"),
      error: body("#dcd6e8", "#ada3c2", "#f4f1fa", "#ada3c2"),
    },
  },
  midnight: {
    name: "Midnight",
    states: {
      idle: body("#7b5cff", "#4b32c3", "#b9a8ff", "#ff4fd8"),
      working: body("#7b5cff", "#4b32c3", "#b9a8ff", "#ff4fd8"),
      done: body("#2ef2a0", "#14a873", "#a8ffd9", "#fff35c"),
      waiting: body("#ff9f1c", "#c96f00", "#ffd79a", "#ff2e63"),
      error: body("#6b6f80", "#464a5a", "#9ca0b0", "#8a8fa0"),
    },
  },
  // Four shades of green, like a certain 1989 handheld. Moods are told apart
  // by faces and effects only.
  gameboy: {
    name: "Game Boy",
    outline: GB_DARK,
    all: {
      ...body("#8bac0f", "#306230", "#9bbc0f", GB_DARK),
      E: GB_DARK,
      L: GB_DARK,
      P: "#306230",
      R: GB_DARK,
      W: "#9bbc0f",
      y: "#9bbc0f",
      o: "#8bac0f",
      b: "#306230",
      w: "#9bbc0f",
      r: GB_DARK,
      g: "#8bac0f",
      G: "#306230",
    },
  },
};

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];

export function skinPalette(base: Palette, skin: SkinId, state: PetState): Palette {
  const s = SKINS[skin] ?? SKINS.classic;
  return { ...base, ...s.all, ...s.states?.[state] };
}
