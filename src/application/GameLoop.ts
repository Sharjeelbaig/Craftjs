/** Wall-clock source, injectable so the loop can be driven in tests. */
export interface LoopClock {
  now(): number;
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export const browserClock: LoopClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface GameLoopHandlers {
  /** Deterministic simulation step. Always called with exactly `fixedStep`. */
  update(fixedStep: number): void;
  /**
   * Presentation step. `alpha` is the fraction of the way into the next
   * simulation tick, for interpolating rendered positions.
   */
  render(alpha: number, frameTime: number): void;
}

export interface GameLoopSettings {
  /** Simulation rate in Hz. */
  readonly tickRate: number;
  /**
   * Upper bound on simulation steps per frame. Once exceeded the loop drops
   * accumulated time instead of trying to catch up — without this, a slow
   * frame causes more work next frame, which causes a slower frame, and the
   * page locks up permanently.
   */
  readonly maxStepsPerFrame: number;
  /** Longest frame delta accepted, in seconds. Guards against tab suspension. */
  readonly maxFrameTime: number;
}

export const DEFAULT_LOOP: GameLoopSettings = Object.freeze({
  tickRate: 60,
  maxStepsPerFrame: 5,
  maxFrameTime: 0.25,
});

/**
 * Fixed-timestep game loop with a decoupled render step.
 *
 * Simulation advances in constant increments so physics is reproducible and
 * independent of display refresh rate, while rendering runs as fast as the
 * browser allows and interpolates between ticks for smooth motion.
 */
export class GameLoop {
  private readonly handlers: GameLoopHandlers;
  private readonly clock: LoopClock;
  private readonly settings: GameLoopSettings;
  private readonly fixedStep: number;

  private handle: number | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  private frameCount = 0;
  private fpsWindowStart = 0;
  private _fps = 0;
  private _frameTimeMs = 0;

  constructor(
    handlers: GameLoopHandlers,
    clock: LoopClock = browserClock,
    settings: Partial<GameLoopSettings> = {},
  ) {
    this.handlers = handlers;
    this.clock = clock;
    this.settings = { ...DEFAULT_LOOP, ...settings };
    this.fixedStep = 1 / this.settings.tickRate;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get fps(): number {
    return this._fps;
  }

  get frameTimeMs(): number {
    return this._frameTimeMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.clock.now();
    this.fpsWindowStart = this.lastTime;
    this.accumulator = 0;
    this.frameCount = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      this.clock.cancel(this.handle);
      this.handle = null;
    }
  }

  /**
   * Discards accumulated time without stopping. Call after a pause or a long
   * synchronous operation so the loop does not try to simulate the gap.
   */
  resetTiming(): void {
    this.lastTime = this.clock.now();
    this.accumulator = 0;
  }

  private schedule(): void {
    this.handle = this.clock.request(this.tick);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.schedule();

    const current = this.clock.now();
    let frameTime = (current - this.lastTime) / 1000;
    this.lastTime = current;

    // A tab restored from the background reports a huge delta; simulating it
    // would teleport the player and stall the frame.
    if (frameTime > this.settings.maxFrameTime) frameTime = this.settings.maxFrameTime;
    if (frameTime < 0) frameTime = 0;

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.settings.maxStepsPerFrame) {
      this.handlers.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps++;
    }

    // Ran out of budget: abandon the backlog rather than compounding it.
    if (this.accumulator > this.fixedStep * this.settings.maxStepsPerFrame) {
      this.accumulator = 0;
    }

    this.handlers.render(this.accumulator / this.fixedStep, frameTime);

    this._frameTimeMs = this.clock.now() - current;
    this.updateFpsCounter(current);
  };

  private updateFpsCounter(current: number): void {
    this.frameCount++;
    const elapsed = current - this.fpsWindowStart;
    if (elapsed >= 500) {
      this._fps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.fpsWindowStart = current;
    }
  }
}
