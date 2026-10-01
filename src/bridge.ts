// Everything that talks to the Tauri backend lives here, so the rest of the
// frontend also runs in a plain browser (`npm run dev`) for quick iteration.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetState } from "./sprites.ts";

/** States in the HTTP protocol; each one has its own animation. */
export type AgentState = PetState;

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
}

export interface Snapshot {
  state: AgentState;
  progress: Progress;
  port: number;
  serverError: string | null;
  demo: boolean;
}

export type MenuEntry =
  | { text: string; action?: () => void; enabled?: boolean; checked?: boolean }
  | { submenu: string; items: MenuEntry[] }
  | "separator";

export const inTauri = isTauri();

export async function getSnapshot(): Promise<Snapshot | null> {
  return inTauri ? invoke<Snapshot>("get_snapshot") : null;
}

export async function onPetEvent(handler: (event: PetEvent) => void): Promise<void> {
  if (inTauri) await listen<PetEvent>("bitling:event", (e) => handler(e.payload));
}

export function startDragging(): void {
  if (inTauri) void getCurrentWindow().startDragging();
}

export function quit(): void {
  if (inTauri) void invoke("quit");
}

/** Shows a native context menu at the cursor (no-op in the browser). */
export async function showContextMenu(entries: MenuEntry[]): Promise<void> {
  if (!inTauri) return;
  const menu = await Menu.new({ items: entries.map(toMenuItem) });
  await menu.popup();
}

// The menu API accepts plain option objects and builds native items from them.
type MenuItemSpec = NonNullable<Parameters<typeof Menu.new>[0]>["items"] extends (infer T)[] | undefined
  ? T
  : never;

function toMenuItem(entry: MenuEntry): MenuItemSpec {
  if (entry === "separator") return { item: "Separator" };
  if ("submenu" in entry) return { text: entry.submenu, items: entry.items.map(toMenuItem) };
  const { text, action, enabled = true, checked } = entry;
  return checked === undefined ? { text, action, enabled } : { text, action, enabled, checked };
}
