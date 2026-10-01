// Tiny chiptune jingles synthesized with WebAudio: no sound files to ship.
// Off by default; toggled from the menu ("Sound effects").

import type { PetState } from "./sprites.ts";

type Note = [freq: number, ms: number];

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, A4 = 440, F4 = 349.23, D5 = 587.33;

const JINGLES: Partial<Record<PetState | "levelup", { wave: OscillatorType; notes: Note[] }>> = {
  done: { wave: "square", notes: [[C5, 70], [E5, 70], [G5, 70], [C6, 160]] },
  waiting: { wave: "triangle", notes: [[A4 * 2, 90], [0, 60], [A4 * 2, 90]] },
  error: { wave: "sawtooth", notes: [[D5, 110], [A4, 110], [F4, 220]] },
  levelup: { wave: "square", notes: [[C5, 80], [E5, 80], [G5, 80], [C6, 80], [G5, 80], [C6, 260]] },
};

let ctx: AudioContext | null = null;

export function play(kind: PetState | "levelup"): void {
  const jingle = JINGLES[kind];
  if (!jingle) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume(); // may start suspended until the first user gesture
    let t = ctx.currentTime + 0.02;
    for (const [freq, ms] of jingle.notes) {
      const dur = ms / 1000;
      if (freq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = jingle.wave;
        osc.frequency.value = freq;
        // Quiet, with a short fade so notes don't click.
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
      }
      t += dur;
    }
  } catch {
    // No audio device: the pet stays silent.
  }
}
