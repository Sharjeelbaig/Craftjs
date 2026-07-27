export const WeatherKind = {
  Clear: 'clear',
  Rain: 'rain',
  Storm: 'storm',
} as const;

export type WeatherKind = (typeof WeatherKind)[keyof typeof WeatherKind];

export interface WeatherSnapshot {
  readonly kind: WeatherKind;
  readonly secondsRemaining: number;
}

const MIN_DURATION = 75;
const DURATION_SPREAD = 105;

/**
 * Seeded, low-frequency weather state. No adapter knowledge and no per-frame
 * allocation; the presentation decides how rain or a storm should look.
 */
export class Weather {
  kind: WeatherKind = WeatherKind.Clear;
  secondsRemaining: number;
  private state: number;

  constructor(seed: number, snapshot?: Partial<WeatherSnapshot>) {
    this.state = (seed ^ 0x6d2b79f5) | 0;
    this.secondsRemaining = this.nextDuration();
    if (snapshot !== undefined) this.restore(snapshot);
  }

  advance(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    this.secondsRemaining -= dt;
    if (this.secondsRemaining > 0) return false;

    const roll = this.random();
    this.kind =
      this.kind === WeatherKind.Clear
        ? roll < 0.72
          ? WeatherKind.Rain
          : WeatherKind.Storm
        : WeatherKind.Clear;
    this.secondsRemaining = this.nextDuration();
    return true;
  }

  get skyDarkening(): number {
    if (this.kind === WeatherKind.Storm) return 0.42;
    if (this.kind === WeatherKind.Rain) return 0.2;
    return 0;
  }

  get fogMultiplier(): number {
    if (this.kind === WeatherKind.Storm) return 0.48;
    if (this.kind === WeatherKind.Rain) return 0.68;
    return 1;
  }

  /** Ends the current spell. Sleeping through a storm is what clears it. */
  clear(): boolean {
    if (this.kind === WeatherKind.Clear) return false;
    this.kind = WeatherKind.Clear;
    this.secondsRemaining = this.nextDuration();
    return true;
  }

  snapshot(): WeatherSnapshot {
    return { kind: this.kind, secondsRemaining: this.secondsRemaining };
  }

  restore(snapshot: Partial<WeatherSnapshot>): void {
    if (Object.values(WeatherKind).includes(snapshot.kind as WeatherKind)) {
      this.kind = snapshot.kind as WeatherKind;
    }
    const remaining = Number(snapshot.secondsRemaining);
    if (Number.isFinite(remaining) && remaining > 0) {
      this.secondsRemaining = Math.min(remaining, MIN_DURATION + DURATION_SPREAD);
    }
  }

  private nextDuration(): number {
    return MIN_DURATION + this.random() * DURATION_SPREAD;
  }

  private random(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}
