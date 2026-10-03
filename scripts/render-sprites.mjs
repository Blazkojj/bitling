#!/usr/bin/env node
// Renders every animation frame into PNG files, using the exact same scene
// composition as the app. Needs Node >= 22.18 (imports TypeScript directly).
//
//   node scripts/render-sprites.mjs              -> docs/sprites.png
//   node scripts/render-sprites.mjs --preview    -> also docs/preview-{light,dark}.png
//                                                  (big, on light + dark backgrounds;
//                                                  handy while editing, not committed)
//   node scripts/render-sprites.mjs --icon       -> src-tauri/app-icon.png
//                                                  (then: npx tauri icon src-tauri/app-icon.png)
//   node scripts/render-sprites.mjs --gif        -> docs/states.gif (animated README preview)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeScene, SCENE_H, SCENE_W } from "../src/scene.ts";
import { ANIMATIONS, PET_STATES } from "../src/sprites.ts";
import { encodePng, parseColor } from "./lib/png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const optionValue = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
// --skin pastel, --level 10: preview skins and evolutions
const sceneOpts = { skin: optionValue("--skin"), level: Number(optionValue("--level") ?? 1) };

/** Paints scenes into a grid: rows = states, columns = frames. */
function renderSheet({ scale, gap, background }) {
  const cols = Math.max(...PET_STATES.map((s) => ANIMATIONS[s].frames.length));
  const cellW = SCENE_W * scale + gap;
  const cellH = SCENE_H * scale + gap;
  const width = cols * cellW + gap;
  const height = PET_STATES.length * cellH + gap;
  const rgba = new Uint8Array(width * height * 4);
  if (background) fillRect(rgba, width, 0, 0, width, height, parseColor(background));

  PET_STATES.forEach((state, row) => {
    ANIMATIONS[state].frames.forEach((_, col) => {
      const scene = composeScene(state, col, sceneOpts);
      const ox = gap + col * cellW;
      const oy = gap + row * cellH;
      scene.forEach((color, i) => {
        if (!color) return;
        const x = ox + (i % SCENE_W) * scale;
        const y = oy + Math.floor(i / SCENE_W) * scale;
        fillRect(rgba, width, x, y, scale, scale, parseColor(color));
      });
    });
  });
  return { width, height, rgba };
}

/** Alpha-blends a solid rectangle into the RGBA buffer. */
function fillRect(rgba, width, x0, y0, w, h, [r, g, b, a]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      const alpha = a / 255;
      const keep = rgba[i + 3] / 255;
      const outA = alpha + keep * (1 - alpha);
      for (let c = 0; c < 3; c++) {
        const src = [r, g, b][c];
        rgba[i + c] = outA === 0 ? 0 : Math.round((src * alpha + rgba[i + c] * keep * (1 - alpha)) / outA);
      }
      rgba[i + 3] = Math.round(outA * 255);
    }
  }
}

function write(file, { width, height, rgba }) {
  const out = path.join(root, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePng(width, height, rgba));
  console.log(`wrote ${file} (${width}x${height})`);
}

write("docs/sprites.png", renderSheet({ scale: 4, gap: 8, background: null }));

if (args.has("--preview")) {
  write("docs/preview-light.png", renderSheet({ scale: 8, gap: 16, background: "#f4f4f4" }));
  write("docs/preview-dark.png", renderSheet({ scale: 8, gap: 16, background: "#202124" }));
}

if (args.has("--gif")) {
  writeStatesGif("docs/states.gif");
}

/**
 * All four states side by side, animated with their real timings. Uses a
 * solid background because GIF has no partial transparency (for the shadow).
 */
async function writeStatesGif(file) {
  const { default: gifenc } = await import("gifenc");
  const states = ["idle", "working", "waiting", "done", "error", "sleep", "love"];
  const scale = 6;
  const gap = 12;
  const rows = SCENE_H - 1; // the bottom row is only used by the hover HUD
  const width = states.length * (SCENE_W * scale + gap) + gap;
  const height = rows * scale + gap * 2;
  const background = parseColor("#f6f8fa");
  const TICK = 20; // ms; every step duration is a multiple of this
  const DURATION = 6480; // two full idle loops

  // Pass 1: sample the timeline, merging identical consecutive frames.
  const frames = [];
  let previous = null;
  for (let t = 0; t < DURATION; t += TICK) {
    const rgba = new Uint8Array(width * height * 4);
    fillRect(rgba, width, 0, 0, width, height, background);
    states.forEach((state, col) => {
      const scene = composeScene(state, frameAtTime(state, t));
      const ox = gap + col * (SCENE_W * scale + gap);
      scene.forEach((color, i) => {
        const y = Math.floor(i / SCENE_W);
        if (!color || y >= rows) return;
        fillRect(rgba, width, ox + (i % SCENE_W) * scale, gap + y * scale, scale, scale, parseColor(color));
      });
    });
    const key = Buffer.from(rgba).toString("base64");
    if (key === previous) frames[frames.length - 1].delay += TICK;
    else frames.push({ rgba, delay: TICK });
    previous = key;
  }

  // Pass 2: one global palette (the art only uses a handful of colors).
  const palette = [];
  const paletteIndex = new Map();
  const gif = gifenc.GIFEncoder();
  frames.forEach(({ rgba, delay }, n) => {
    const index = new Uint8Array(width * height);
    for (let i = 0; i < index.length; i++) {
      const rgb = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
      if (!paletteIndex.has(rgb)) {
        paletteIndex.set(rgb, palette.length);
        palette.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
      }
      index[i] = paletteIndex.get(rgb);
    }
    frames[n].index = index;
  });
  if (palette.length > 256) throw new Error("too many colors for a GIF");
  frames.forEach(({ index, delay }, n) => {
    gif.writeFrame(index, width, height, n === 0 ? { palette, delay, repeat: 0 } : { delay });
  });
  gif.finish();
  const out = path.join(root, file);
  fs.writeFileSync(out, gif.bytes());
  console.log(`wrote ${file} (${width}x${height}, ${frames.length} frames, ${palette.length} colors)`);
}

/** Frame shown at time t (ms) when looping an animation without jitter. */
function frameAtTime(state, t) {
  const steps = ANIMATIONS[state].steps;
  const total = steps.reduce((sum, step) => sum + step.ms, 0);
  let rest = t % total;
  for (const step of steps) {
    if (rest < step.ms) return step.frame;
    rest -= step.ms;
  }
  return steps[0].frame;
}

if (args.has("--icon")) {
  // Idle frame, cropped to the creature and centered on a square canvas.
  const scene = composeScene("idle", 0);
  const size = 1024;
  const scale = 56;
  const rgba = new Uint8Array(size * size * 4);
  const xs = [], ys = [];
  scene.forEach((c, i) => {
    if (c && !c.startsWith("rgba")) { xs.push(i % SCENE_W); ys.push(Math.floor(i / SCENE_W)); }
  });
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const ox = Math.round((size - (maxX - minX + 1) * scale) / 2);
  const oy = Math.round((size - (maxY - minY + 1) * scale) / 2);
  scene.forEach((color, i) => {
    if (!color || color.startsWith("rgba")) return; // skip the shadow
    const x = ox + (i % SCENE_W - minX) * scale;
    const y = oy + (Math.floor(i / SCENE_W) - minY) * scale;
    fillRect(rgba, size, x, y, scale, scale, parseColor(color));
  });
  write("src-tauri/app-icon.png", { width: size, height: size, rgba });
}
