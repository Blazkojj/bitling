// Everything that talks to the Tauri backend lives here, so the rest of the
// frontend also runs in a plain browser (`npm run dev`) for quick iteration.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SkinId } from "./skins.ts";
import type { OwnMood, PetState } from "./sprites.ts";

/** States in the HTTP protocol (the pet's own moods never come from agents). */
export type AgentState = Exclude<PetState, OwnMood>;

export interface Progress {
  xp: number;
  level: number;
  /** XP earned inside the current level. */
  levelXp: number;
  /** XP the current level needs in total before the next one. */
  levelSize: number;
}

/** Payload of the `bitling:event` event emitted by the backend. */
export interface PetEvent {
  state: AgentState;
  source: string;
  message: string | null;
  progress: Progress;
  levelUp: boolean;
  /** Agent sessions currently reporting to the pet. */
  sessions: number;
  /** State of this very event; `state` is what the pet shows across all sessions. */
  eventState: AgentState;
  /** Folder the agent works in, e.g. "my-app". */
  project: string | null;
  /** Titles of achievements this event unlocked. */
  achievements: string[];
}

export interface Config {
  skin: SkinId;
  sound: boolean;
  bubbles: boolean;
  updates: boolean;
  size: PetSize;
}

export type PetSize = "small" | "normal" | "large";

/** CSS pixels per big pixel for each size. Keep in sync with window::SIZES in Rust. */
export const SCALES: Record<PetSize, number> = { small: 6, normal: 8, large: 11 };

export interface Snapshot {
  state: AgentState;
  progress: Progress;
  port: number;
  serverError: string | null;
  demo: boolean;
  config: Config;
  /** The pet's name. */
  name: string;
}

/** A rectangle in CSS pixels relative to the window. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inTauri = isTauri();

export async function getSnapshot(): Promise<Snapshot | null> {
  return inTauri ? invoke<Snapshot>("get_snapshot") : null;
}

export async function onPetEvent(handler: (event: PetEvent) => void): Promise<void> {
  if (inTauri) await listen<PetEvent>("bitling:event", (e) => handler(e.payload));
}

export async function onConfig(handler: (config: Config) => void): Promise<void> {
  if (inTauri) await listen<Config>("bitling:config", (e) => handler(e.payload));
}

/** Commands from the native menu: "demo" or "state:<name>". */
export async function onCommand(handler: (command: string) => void): Promise<void> {
  if (inTauri) await listen<string>("bitling:command", (e) => handler(e.payload));
}

export function startDragging(): void {
  if (inTauri) void getCurrentWindow().startDragging();
}

/** Native menu (the same one as in the tray). */
export function showContextMenu(x: number, y: number): void {
  if (inTauri) void invoke("popup_menu", { x, y });
}

/** Counts a petting; resolves to the titles of achievements it unlocked. */
export async function recordPet(): Promise<string[]> {
  return inTauri ? invoke<string[]>("pet") : [];
}

export function acknowledge(): void {
  if (inTauri) void invoke("acknowledge");
}

export function setConfig(patch: Partial<Config>): void {
  if (inTauri) void invoke("set_config", { patch });
}

/** Offers a newer release in the menu (the backend only accepts Bitling release URLs). */
export function offerUpdate(version: string, url: string): void {
  if (inTauri) void invoke("offer_update", { update: { version, url } });
}

export async function appVersion(): Promise<string | null> {
  if (!inTauri) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Tells the backend which parts of the window should catch the mouse. */
export function setHitRegions(rects: Rect[]): void {
  if (inTauri) void invoke("set_hit_regions", { rects });
}
