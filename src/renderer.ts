import { PIXEL_SCALE, SCENE_H, SCENE_W, type Scene } from "./scene.ts";

/** Paints scenes onto a canvas as crisp, integer-aligned big pixels. */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cell = PIXEL_SCALE;
  private lastKey = "";

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Matches the backing store to the device pixel ratio, so one big pixel is
   * always a whole number of physical pixels (no blurry edges on HiDPI).
   */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.cell = Math.max(1, Math.round(PIXEL_SCALE * dpr));
    this.canvas.width = SCENE_W * this.cell;
    this.canvas.height = SCENE_H * this.cell;
    this.canvas.style.width = `${SCENE_W * PIXEL_SCALE}px`;
    this.canvas.style.height = `${SCENE_H * PIXEL_SCALE}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.lastKey = "";
  }

  draw(scene: Scene): void {
    // Skip identical frames: most timer ticks don't change anything visible.
    const key = scene.join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const { ctx, cell } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    scene.forEach((color, i) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect((i % SCENE_W) * cell, Math.floor(i / SCENE_W) * cell, cell, cell);
    });
  }
}
