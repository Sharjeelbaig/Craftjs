/**
 * Sleeping rules.
 *
 * A bed is the only way to skip a night, so the conditions under which it
 * works are gameplay-critical and belong in the domain: the same answer must
 * come back whether the request arrives from a click, a test, or a future
 * remote peer.
 */

/** Time fraction sleeping wakes the player at — first light. */
export const WAKE_FRACTION = 0.02;

/** A hostile within this distance keeps the player awake. */
export const MONSTER_WATCH_RADIUS = 9;

export const SleepRejection = {
  /** The sun is up and the weather is fine. */
  NotTired: 'notTired',
  /** A hostile creature is too close. */
  Monsters: 'monsters',
  /** The bed is out of reach. */
  OutOfRange: 'outOfRange',
} as const;

export type SleepRejection = (typeof SleepRejection)[keyof typeof SleepRejection];

export interface SleepContext {
  readonly isNight: boolean;
  /** Storms darken the sky enough to rest through, as in the original. */
  readonly isStorming: boolean;
  /** Distance from the player to the bed, in blocks. */
  readonly distance: number;
  readonly reach: number;
  /** Distance to the closest hostile creature, or null when none are near. */
  readonly nearestHostileDistance: number | null;
}

export type SleepOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SleepRejection };

const ALLOWED: SleepOutcome = Object.freeze({ ok: true });

/**
 * Whether the player may lie down right now.
 *
 * Checked in the order the player will understand it: reachability first
 * because that is about aim, then time because that is the rule they know, then
 * monsters because that is the one they need to act on.
 */
export function canSleep(context: SleepContext): SleepOutcome {
  if (!Number.isFinite(context.distance) || context.distance > context.reach) {
    return { ok: false, reason: SleepRejection.OutOfRange };
  }
  if (!context.isNight && !context.isStorming) {
    return { ok: false, reason: SleepRejection.NotTired };
  }
  if (
    context.nearestHostileDistance !== null &&
    context.nearestHostileDistance <= MONSTER_WATCH_RADIUS
  ) {
    return { ok: false, reason: SleepRejection.Monsters };
  }
  return ALLOWED;
}

/** Player-facing explanation for a refused sleep. */
export function sleepRejectionMessage(reason: SleepRejection): string {
  switch (reason) {
    case SleepRejection.NotTired:
      return 'You can only sleep at night or during a storm';
    case SleepRejection.Monsters:
      return 'There are monsters nearby';
    case SleepRejection.OutOfRange:
      return 'That bed is too far away';
  }
}
