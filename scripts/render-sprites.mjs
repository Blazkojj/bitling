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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeScene, SCENE_H, SCENE_W } from "../src/scene.ts";
import { ANIMATIONS, PET_STATES } from "../src/sprites.ts";
import { encodePng, parseColor } from "./lib/png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

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
      const scene = composeScene(state, col);
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
