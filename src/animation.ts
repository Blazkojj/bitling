import { ANIMATIONS, type PetState, type Step } from "./sprites.ts";

/**
 * Walks through an animation's steps in real time.
 *
 * Instead of redrawing at 60 fps, the caller asks how long the current frame
 * lasts and sleeps until then: a desk pet should cost ~0% CPU.
 */
export class AnimationPlayer {
  private state: PetState = "idle";
  private step = 0;
  private stepEndsAt = 0;

  get current(): PetState {
    return this.state;
  }

  play(state: PetState, now: number): void {
    this.state = state;
    this.step = 0;
    this.stepEndsAt = now + duration(this.steps()[0]);
  }

  /** Frame index to draw at time `now` (advances the animation as needed). */
  frameAt(now: number): number {
    const steps = this.steps();
    if (now - this.stepEndsAt > 10_000) {
      // We were asleep for a long time (hidden window, suspended laptop):
      // resync instead of fast-forwarding through hundreds of steps.
      this.stepEndsAt = now;
    }
    while (now >= this.stepEndsAt) {
      this.step = (this.step + 1) % steps.length;
      this.stepEndsAt += duration(steps[this.step]);
    }
    return steps[this.step].frame;
  }

  /** Milliseconds until the next frame change. */
  msUntilNextFrame(now: number): number {
    return Math.max(0, this.stepEndsAt - now);
  }

  private steps(): readonly Step[] {
    return ANIMATIONS[this.state].steps;
  }
}

function duration(step: Step): number {
  return step.ms + (step.jitter ? Math.random() * step.jitter : 0);
}
