/**
 * Keeps the frame rate playable by trading render distance for speed.
 *
 * A fixed render distance is a gamble on hardware: too high and weak machines
 * stutter permanently, too low and strong machines get a needlessly small
 * world. Measuring the actual frame rate and adjusting is the only setting
 * that is correct on every device.
 */
export interface GovernorSettings {
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Sustained fps below this triggers a reduction. */
  readonly lowFps: number;
  /** Sustained fps above this allows growing back. */
  readonly highFps: number;
  /** Seconds the condition must hold before acting. */
  readonly reactionSeconds: number;
  /** Seconds to wait after a change before considering another. */
  readonly settleSeconds: number;
}

export const DEFAULT_GOVERNOR: GovernorSettings = Object.freeze({
  minDistance: 4,
  maxDistance: 12,
  lowFps: 34,
  highFps: 57,
  reactionSeconds: 4,
  settleSeconds: 6,
});

export class PerformanceGovernor {
  private readonly settings: GovernorSettings;
  private distance: number;

  private lowTime = 0;
  private highTime = 0;
  private settleTime = 0;
  /** Never grow back past a distance that already proved too slow. */
  private ceiling: number;

  constructor(initialDistance: number, settings: Partial<GovernorSettings> = {}) {
    this.settings = { ...DEFAULT_GOVERNOR, ...settings };
    this.distance = clampInt(initialDistance, this.settings.minDistance, this.settings.maxDistance);
    this.ceiling = this.settings.maxDistance;
  }

  get renderDistance(): number {
    return this.distance;
  }

  /**
   * Feeds one frame's measurement in.
   * Returns the new render distance when it changed, or null.
   */
  update(fps: number, dt: number): number | null {
    if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(dt) || dt <= 0) return null;

    if (this.settleTime > 0) {
      this.settleTime -= dt;
      return null;
    }

    const { lowFps, highFps, reactionSeconds } = this.settings;

    if (fps < lowFps) {
      this.lowTime += dt;
      this.highTime = 0;
    } else if (fps > highFps) {
      this.highTime += dt;
      this.lowTime = 0;
    } else {
      this.lowTime = 0;
      this.highTime = 0;
      return null;
    }

    if (this.lowTime >= reactionSeconds && this.distance > this.settings.minDistance) {
      // Remember that this distance was too slow, so the governor cannot
      // oscillate back up to it and stutter again.
      this.ceiling = this.distance - 1;
      return this.applyChange(this.distance - 1);
    }

    if (this.highTime >= reactionSeconds && this.distance < this.ceiling) {
      return this.applyChange(this.distance + 1);
    }

    return null;
  }

  /** Called when the player changes the setting explicitly. */
  override(distance: number): number {
    this.distance = clampInt(distance, this.settings.minDistance, this.settings.maxDistance);
    this.ceiling = this.settings.maxDistance;
    this.lowTime = 0;
    this.highTime = 0;
    this.settleTime = this.settings.settleSeconds;
    return this.distance;
  }

  private applyChange(next: number): number {
    this.distance = clampInt(next, this.settings.minDistance, this.settings.maxDistance);
    this.lowTime = 0;
    this.highTime = 0;
    this.settleTime = this.settings.settleSeconds;
    return this.distance;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
