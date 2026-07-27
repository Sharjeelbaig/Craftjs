import { applyDamage, applyKnockback, fallDamageFor } from '@domain/combat/Combat';
import type { Mob } from '@domain/entity/Mob';
import { attackDamageFor } from '@domain/inventory/Tool';
import type { ItemId } from '@domain/inventory/Item';
import {
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_KNOCKBACK,
  PLAYER_REACH,
  type Player,
} from '@domain/player/Player';
import type { EntityManager, PlayerHit } from './EntityManager';

/** Backwards push the player takes from a creature's hit. */
const PLAYER_KNOCKBACK_TAKEN = 5.5;

/** Widening of a creature's box when testing whether the crosshair is on it. */
const AIM_FORGIVENESS = 0.25;

export interface AttackOutcome {
  readonly hit: boolean;
  readonly killed: boolean;
  readonly targetName: string | null;
  /** Damage the swing actually dealt; zero on a miss. */
  readonly damage: number;
}

const MISSED: AttackOutcome = Object.freeze({
  hit: false,
  killed: false,
  targetName: null,
  damage: 0,
});

/**
 * Resolves fighting in both directions.
 *
 * Kept apart from `EntityManager` so the creature simulation does not need to
 * know the player's rules, and apart from `WorldEditor` so a swing at a
 * creature can never accidentally edit the world behind it.
 */
export class CombatService {
  private readonly entities: EntityManager;

  constructor(entities: EntityManager) {
    this.entities = entities;
  }

  /**
   * The creature under the crosshair, or null.
   *
   * Uses a ray/box test against each nearby creature rather than the voxel
   * raycaster: creatures are not grid-aligned, and a voxel walk would miss
   * anything standing between block centres.
   */
  findTarget(player: Player): Mob | null {
    const eye = player.eyePosition;
    const direction = player.lookDirection;
    // The crosshair sits inside whatever the player is riding, so a swing from
    // the saddle would otherwise always land on their own mount.
    const ridden = this.entities.ridden;

    let closest: Mob | null = null;
    let closestDistance = PLAYER_REACH;

    for (const mob of this.entities.all()) {
      if (!mob.isAlive || mob === ridden) continue;

      const definition = mob.definition;
      const half = definition.width / 2 + AIM_FORGIVENESS;
      const distance = intersectRayBox(
        eye.x,
        eye.y,
        eye.z,
        direction.x,
        direction.y,
        direction.z,
        mob.x - half,
        mob.y - AIM_FORGIVENESS,
        mob.z - half,
        mob.x + half,
        mob.y + definition.height + AIM_FORGIVENESS,
        mob.z + half,
        closestDistance,
      );

      if (distance === null) continue;
      closest = mob;
      closestDistance = distance;
    }

    return closest;
  }

  /**
   * Swings at the targeted creature. Returns what happened.
   *
   * The held item sets the damage, so a sword is worth carrying and worth
   * seeing in hand. An empty hand falls back to the bare-handed value.
   */
  attack(player: Player, weapon: ItemId | null = null): AttackOutcome {
    if (player.isDead || player.attackCooldown > 0) return MISSED;

    const target = this.findTarget(player);
    if (target === null) return MISSED;

    player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    const name = target.definition.name;
    const damage = attackDamageFor(weapon) ?? PLAYER_ATTACK_DAMAGE;
    const killed = this.entities.damage(target, damage, player.x, player.z, PLAYER_KNOCKBACK);

    return { hit: true, killed, targetName: name, damage };
  }

  /**
   * Applies creature attacks to the player.
   *
   * Invulnerability frames mean only the first hit of a tick lands, so being
   * surrounded is dangerous but not instantly fatal.
   */
  applyHits(player: Player, hits: readonly PlayerHit[]): boolean {
    if (!player.rules.takesDamage || player.isDead) return false;

    let died = false;
    for (const hit of hits) {
      const result = applyDamage(player, hit.amount);
      if (!result.applied) continue;

      applyKnockback(player, hit.sourceX, hit.sourceZ, player.x, player.z, PLAYER_KNOCKBACK_TAKEN);
      if (result.fatal) died = true;
    }
    return died;
  }

  /** Applies fall damage for a landing. Returns true when it was fatal. */
  applyFallDamage(player: Player, distance: number): boolean {
    if (!player.rules.takesDamage) return false;
    const damage = fallDamageFor(distance);
    if (damage <= 0) return false;

    // Fall damage bypasses invulnerability frames: otherwise a player struck
    // moments before landing would take no damage from a lethal drop.
    const previous = player.hurtTimer;
    player.hurtTimer = 0;
    const result = applyDamage(player, damage);
    player.hurtTimer = Math.max(player.hurtTimer, previous);

    return result.fatal;
  }
}

/**
 * Slab-method ray/AABB intersection.
 *
 * Returns the entry distance, or null when the ray misses or the hit is
 * beyond `maxDistance`.
 */
function intersectRayBox(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxDistance: number,
): number | null {
  let near = 0;
  let far = maxDistance;

  // Division by zero yields ±Infinity here, which the comparisons below handle
  // correctly for rays exactly parallel to an axis.
  const axes: readonly [number, number, number, number][] = [
    [originX, dirX, minX, maxX],
    [originY, dirY, minY, maxY],
    [originZ, dirZ, minZ, maxZ],
  ];

  for (const [origin, direction, low, high] of axes) {
    if (direction === 0) {
      if (origin < low || origin > high) return null;
      continue;
    }
    const inverse = 1 / direction;
    let t0 = (low - origin) * inverse;
    let t1 = (high - origin) * inverse;
    if (t0 > t1) [t0, t1] = [t1, t0];

    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near > far) return null;
  }

  return near <= maxDistance ? near : null;
}
