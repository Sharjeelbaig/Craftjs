import { clamp } from '../shared/Vec3';

/** Length of a full day/night cycle, in seconds. */
export const DAY_LENGTH_SECONDS = 600;

/** Ambient light at the darkest point of the night. */
const NIGHT_LIGHT = 0.24;
const FULL_LIGHT = 1;

/** Sun height below which hostile mobs may spawn. */
const NIGHT_THRESHOLD = -0.05;

export const DayPhase = {
  Dawn: 'dawn',
  Day: 'day',
  Dusk: 'dusk',
  Night: 'night',
} as const;

export type DayPhase = (typeof DayPhase)[keyof typeof DayPhase];

/**
 * The world clock.
 *
 * Drives ambient light, sky colour and hostile mob spawning from a single
 * value, so those three can never disagree — a lit sky with spawning zombies,
 * or darkness at noon, is not representable.
 *
 * Fraction 0 is dawn, 0.25 noon, 0.5 dusk, 0.75 midnight.
 */
export class TimeOfDay {
  private seconds: number;

  constructor(startFraction = 0.08) {
    this.seconds = wrap(startFraction) * DAY_LENGTH_SECONDS;
  }

  get fraction(): number {
    return this.seconds / DAY_LENGTH_SECONDS;
  }

  set fraction(value: number) {
    this.seconds = wrap(value) * DAY_LENGTH_SECONDS;
  }

  /** Height of the sun in [-1, 1]; 1 is directly overhead. */
  get sunHeight(): number {
    return Math.sin(this.fraction * Math.PI * 2);
  }

  /**
   * Horizontal leg of the sun's position in [-1, 1].
   *
   * The companion to `sunHeight`: together they are a point on the sun's
   * circle. Height is a sine and so repeats on both sides of noon, which is
   * enough to shade the world but not to say where the sun actually is.
   */
  get sunHorizontal(): number {
    return Math.cos(this.fraction * Math.PI * 2);
  }

  /** Ambient light multiplier applied to all baked vertex lighting. */
  get lightLevel(): number {
    // Smooth ramp across dawn and dusk rather than a hard switch, so the
    // transition reads as a sunrise instead of a light being flipped.
    const t = smoothstep(-0.22, 0.28, this.sunHeight);
    return NIGHT_LIGHT + (FULL_LIGHT - NIGHT_LIGHT) * t;
  }

  get isNight(): boolean {
    return this.sunHeight < NIGHT_THRESHOLD;
  }

  get phase(): DayPhase {
    const height = this.sunHeight;
    if (height >= 0.28) return DayPhase.Day;
    if (height < NIGHT_THRESHOLD) return DayPhase.Night;
    // Rising half of the cycle is dawn, falling half is dusk.
    return this.fraction < 0.5 ? DayPhase.Dawn : DayPhase.Dusk;
  }

  /** Clock reading as `HH:MM`, with fraction 0 mapped to 06:00. */
  get clock(): string {
    const hours24 = (this.fraction * 24 + 6) % 24;
    const hours = Math.floor(hours24);
    const minutes = Math.floor((hours24 - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.seconds = (this.seconds + deltaSeconds) % DAY_LENGTH_SECONDS;
  }

  toJSON(): number {
    return this.fraction;
  }
}

function wrap(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return ((fraction % 1) + 1) % 1;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
