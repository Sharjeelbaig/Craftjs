/**
 * Damage, knockback and the rules that stop a player being killed instantly.
 */

/** Seconds of invulnerability granted by any hit. */
export const INVULNERABILITY_SECONDS = 0.5;

/** Blocks of free fall before landing starts to hurt. */
export const SAFE_FALL_DISTANCE = 3.5;

/** Anything that can take damage. */
export interface Damageable {
  health: number;
  /** Remaining invulnerability; also drives the hit flash. */
  hurtTimer: number;
}

export interface Knockable {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

export interface DamageResult {
  /** False when the hit was absorbed by invulnerability frames. */
  readonly applied: boolean;
  readonly amount: number;
  readonly fatal: boolean;
}

const ABSORBED: DamageResult = Object.freeze({ applied: false, amount: 0, fatal: false });

/**
 * Applies damage unless the target is still invulnerable from a previous hit.
 *
 * The invulnerability window is what makes contact damage survivable: without
 * it, standing next to a creature applies damage every tick and a full health
 * bar disappears in well under a second.
 */
export function applyDamage(
  target: Damageable,
  amount: number,
  invulnerabilitySeconds = INVULNERABILITY_SECONDS,
): DamageResult {
  if (!Number.isFinite(amount) || amount <= 0) return ABSORBED;
  if (target.hurtTimer > 0) return ABSORBED;
  if (target.health <= 0) return ABSORBED;

  target.health = Math.max(0, target.health - amount);
  target.hurtTimer = invulnerabilitySeconds;

  return { applied: true, amount, fatal: target.health <= 0 };
}

/**
 * Pushes a body away from a point in the horizontal plane, with a small lift.
 *
 * The lift matters: pure horizontal knockback against a wall does nothing,
 * and the hit reads as if it did not land.
 */
export function applyKnockback(
  body: Knockable,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  strength: number,
): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);

  // Attacker and target exactly aligned: pick an arbitrary but stable push.
  const dirX = distance > 1e-4 ? dx / distance : 1;
  const dirZ = distance > 1e-4 ? dz / distance : 0;

  body.velocityX = dirX * strength;
  body.velocityZ = dirZ * strength;
  body.velocityY = Math.max(body.velocityY, strength * 0.45);
}

/** Damage taken from landing after a fall of `distance` blocks. */
export function fallDamageFor(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const excess = distance - SAFE_FALL_DISTANCE;
  return excess <= 0 ? 0 : Math.floor(excess);
}
