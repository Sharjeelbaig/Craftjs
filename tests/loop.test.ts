import { describe, expect, it } from 'vitest';
import { GameLoop, type GameLoopSettings, type LoopClock } from '@application/GameLoop';

/** Manually advanced clock and frame scheduler. */
class FakeClock implements LoopClock {
  private time = 0;
  private pending: ((timestamp: number) => void) | null = null;
  private nextHandle = 1;

  now(): number {
    return this.time;
  }

  request(callback: (timestamp: number) => void): number {
    this.pending = callback;
    return this.nextHandle++;
  }

  cancel(): void {
    this.pending = null;
  }

  /** Advances the clock by `ms` and runs exactly one scheduled frame. */
  advance(ms: number): void {
    this.time += ms;
    const callback = this.pending;
    this.pending = null;
    callback?.(this.time);
  }

  get hasPendingFrame(): boolean {
    return this.pending !== null;
  }
}

interface Recorder {
  updates: number[];
  renders: number[];
}

function build(settings: Partial<GameLoopSettings> = {}) {
  const clock = new FakeClock();
  const recorder: Recorder = { updates: [], renders: [] };
  const loop = new GameLoop(
    {
      update: (step) => recorder.updates.push(step),
      render: (alpha) => recorder.renders.push(alpha),
    },
    clock,
    settings,
  );
  return { clock, recorder, loop };
}

describe('GameLoop', () => {
  it('runs one simulation step per tick interval', () => {
    const { clock, recorder, loop } = build({ tickRate: 60 });
    loop.start();

    clock.advance(1000 / 60);
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.updates[0]).toBeCloseTo(1 / 60);
    expect(recorder.renders).toHaveLength(1);
  });

  it('always steps by the fixed timestep, whatever the frame time', () => {
    const { clock, recorder, loop } = build({ tickRate: 60 });
    loop.start();

    clock.advance(7);
    clock.advance(23);
    clock.advance(4);
    clock.advance(31);

    for (const step of recorder.updates) expect(step).toBeCloseTo(1 / 60);
  });

  it('renders exactly once per frame regardless of step count', () => {
    const { clock, recorder, loop } = build({ tickRate: 60 });
    loop.start();

    clock.advance(50); // roughly three simulation steps
    expect(recorder.updates.length).toBe(3);
    expect(recorder.renders).toHaveLength(1);
  });

  it('reports an interpolation alpha inside [0, 1)', () => {
    const { clock, recorder, loop } = build({ tickRate: 60 });
    loop.start();

    for (let i = 0; i < 20; i++) clock.advance(7);
    for (const alpha of recorder.renders) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('caps steps per frame so a slow frame cannot spiral', () => {
    const { clock, recorder, loop } = build({ tickRate: 60, maxStepsPerFrame: 5 });
    loop.start();

    // Ten seconds of stalled wall clock.
    clock.advance(10_000);
    expect(recorder.updates.length).toBeLessThanOrEqual(5);

    // The backlog is dropped rather than carried, so the next frame runs the
    // one step its own duration earned — not a catch-up burst.
    const before = recorder.updates.length;
    clock.advance(20);
    expect(recorder.updates.length - before).toBe(1);
  });

  it('clamps a huge frame delta from a suspended tab', () => {
    const { clock, recorder, loop } = build({
      tickRate: 60,
      maxFrameTime: 0.25,
      maxStepsPerFrame: 100,
    });
    loop.start();

    clock.advance(60_000); // one minute in the background
    // 0.25 s of clamped time at 60 Hz is 15 steps, not 3600.
    expect(recorder.updates.length).toBe(15);
  });

  it('keeps scheduling frames until stopped', () => {
    const { clock, loop } = build();
    loop.start();
    expect(clock.hasPendingFrame).toBe(true);

    clock.advance(16);
    expect(clock.hasPendingFrame).toBe(true);

    loop.stop();
    expect(clock.hasPendingFrame).toBe(false);
    expect(loop.isRunning).toBe(false);
  });

  it('ignores a second start', () => {
    const { clock, recorder, loop } = build();
    loop.start();
    loop.start();

    clock.advance(1000 / 60);
    // A double-scheduled loop would run the frame twice.
    expect(recorder.renders).toHaveLength(1);
  });

  it('drops accumulated time when timing is reset', () => {
    const { clock, recorder, loop } = build({ tickRate: 60 });
    loop.start();

    clock.advance(10);
    const before = recorder.updates.length;

    loop.resetTiming();
    clock.advance(10);
    // 10 ms is under one tick, and the earlier 10 ms was discarded.
    expect(recorder.updates.length).toBe(before);
  });

  it('measures frames per second over a window', () => {
    const { clock, loop } = build({ tickRate: 60 });
    loop.start();

    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    expect(loop.fps).toBeGreaterThan(50);
    expect(loop.fps).toBeLessThan(70);
  });
});
