import { BlockId, BlockRegistry } from '../world/BlockType';
import type { World } from '../world/World';
import { CHUNK_HEIGHT, WORLD_MAX_Y } from '../world/WorldConstants';
import {
  HOSTILE_TYPES,
  PASSIVE_TYPES,
  type EntityDefinition,
  type EntityTypeId,
} from './EntityType';

export interface SpawnRequest {
  readonly type: EntityTypeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface SpawnSettings {
  /** Creatures never appear closer than this to the player. */
  readonly minRadius: number;
  /** Nor further away than this. */
  readonly maxRadius: number;
  readonly maxPassive: number;
  readonly maxHostile: number;
  /** Candidate positions sampled per attempt before giving up. */
  readonly attemptsPerCycle: number;
  /** Seconds between spawn cycles. */
  readonly cycleSeconds: number;
  /** Creatures beyond this distance are removed. */
  readonly despawnRadius: number;
  /**
   * Whether hostiles may appear in sheltered darkness during the day. Without
   * this the only way to meet one is to survive until nightfall above ground.
   */
  readonly darkSpawns: boolean;
  /** Lowest level searched when looking for a sheltered spawn. */
  readonly undergroundFloor: number;
}

export const DEFAULT_SPAWN_SETTINGS: SpawnSettings = Object.freeze({
  // Close enough to be seen and heard on a night with fog, far enough that
  // nothing materialises in the player's face.
  minRadius: 14,
  maxRadius: 44,
  maxPassive: 14,
  maxHostile: 10,
  attemptsPerCycle: 14,
  cycleSeconds: 3,
  despawnRadius: 88,
  darkSpawns: true,
  undergroundFloor: 5,
});

/** Share of night cycles that look underground rather than at the surface. */
const NIGHT_SHELTERED_SHARE = 0.3;

/** Share of daylight cycles that look for sheltered hostiles. */
const DAY_SHELTERED_SHARE = 0.5;

export interface SpawnContext {
  readonly world: World;
  readonly playerX: number;
  readonly playerY: number;
  readonly playerZ: number;
  readonly isNight: boolean;
  /** False in modes where nothing hunts the player. */
  readonly hostilesAllowed: boolean;
  readonly passiveCount: number;
  readonly hostileCount: number;
  readonly random: () => number;
}

/** A candidate standing position, and whether it can see the sky. */
interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly skyExposed: boolean;
}

/**
 * Decides where and what to spawn.
 *
 * Kept separate from the entity store so the rules — population caps, the
 * exclusion ring around the player, valid ground, and which creatures a given
 * light condition permits — can be tested directly against a hand-built world.
 */
export class MobSpawner {
  private readonly settings: SpawnSettings;
  private timer = 0;

  constructor(settings: Partial<SpawnSettings> = {}) {
    this.settings = { ...DEFAULT_SPAWN_SETTINGS, ...settings };
  }

  get despawnRadius(): number {
    return this.settings.despawnRadius;
  }

  /** Advances the spawn clock; returns true when a cycle is due. */
  tick(dt: number): boolean {
    this.timer += dt;
    if (this.timer < this.settings.cycleSeconds) return false;
    this.timer = 0;
    return true;
  }

  /**
   * Produces the creatures to add this cycle. Returns an empty array when
   * every population is at cap or no valid ground was found.
   */
  plan(context: SpawnContext): SpawnRequest[] {
    const settings = this.settings;
    const wantHostile =
      context.hostilesAllowed && context.hostileCount < settings.maxHostile;
    const wantPassive = !context.isNight && context.passiveCount < settings.maxPassive;

    // The search area is committed to before any attempt, not interleaved with
    // them. Alternating inside the loop lets whichever area succeeds first win
    // every cycle — which in daylight is always the open surface, so a player
    // in a mine would never see anything spawn.
    const sheltered = this.chooseShelteredCycle(context, wantHostile, wantPassive);
    if (sheltered === null) return [];

    for (let attempt = 0; attempt < settings.attemptsPerCycle; attempt++) {
      const point = sheltered
        ? this.sampleSheltered(context)
        : this.sampleSurface(context);
      if (point === null) continue;

      // Hostiles need darkness: night sky, or a roof over their heads.
      const hostile = wantHostile && (context.isNight || !point.skyExposed);
      const pool = hostile ? HOSTILE_TYPES : wantPassive && point.skyExposed ? PASSIVE_TYPES : null;
      if (pool === null || pool.length === 0) continue;

      const definition = chooseWeighted(pool, context.random());
      if (!this.hasHeadroom(context.world, point.x, point.y, point.z, definition)) continue;

      const remaining = hostile
        ? settings.maxHostile - context.hostileCount
        : settings.maxPassive - context.passiveCount;
      return this.buildGroup(context, definition, point, remaining);
    }

    return [];
  }

  /**
   * Whether this cycle hunts for sheltered ground, open ground, or neither.
   *
   * Night is mostly spent on the surface, because that is where the player is
   * and where the classic experience lives; daylight splits its attempts evenly
   * so mines stay populated without starving the meadows.
   */
  private chooseShelteredCycle(
    context: SpawnContext,
    wantHostile: boolean,
    wantPassive: boolean,
  ): boolean | null {
    const canShelter = wantHostile && this.settings.darkSpawns;

    if (context.isNight) {
      if (!wantHostile) return null;
      return canShelter && context.random() < NIGHT_SHELTERED_SHARE;
    }

    if (canShelter && wantPassive) return context.random() < DAY_SHELTERED_SHARE;
    if (canShelter) return true;
    return wantPassive ? false : null;
  }

  /** A random point in the ring around the player, snapped to the surface. */
  private sampleSurface(context: SpawnContext): Candidate | null {
    const point = this.sampleColumn(context);
    if (point === null) return null;

    // Unloaded terrain has no surface to stand on.
    const surface = context.world.surfaceHeightAt(point.x, point.z);
    if (surface === null) return null;
    if (surface <= 0 || surface > WORLD_MAX_Y - 4) return null;
    if (!this.isValidGround(context.world, point.x, surface, point.z)) return null;

    return { x: point.x, y: surface, z: point.z, skyExposed: true };
  }

  /**
   * A standable pocket beneath the surface: a cave, a mine, or anywhere the
   * player has built a roof. Scanned downward from just under the terrain so
   * the first hit is the shallowest — the pocket nearest the player.
   */
  private sampleSheltered(context: SpawnContext): Candidate | null {
    const point = this.sampleColumn(context);
    if (point === null) return null;

    const surface = context.world.surfaceHeightAt(point.x, point.z);
    if (surface === null) return null;

    const top = Math.min(surface - 2, Math.floor(context.playerY) + 12);
    const floor = this.settings.undergroundFloor;
    if (top <= floor) return null;

    for (let y = top; y >= floor; y--) {
      if (!this.isValidGround(context.world, point.x, y, point.z)) continue;
      if (isSkyExposed(context.world, point.x, y, point.z)) continue;
      return { x: point.x, y, z: point.z, skyExposed: false };
    }
    return null;
  }

  /** Picks a block column in the exclusion ring around the player. */
  private sampleColumn(context: SpawnContext): { x: number; z: number } | null {
    const { minRadius, maxRadius } = this.settings;
    const angle = context.random() * Math.PI * 2;
    const radius = minRadius + context.random() * (maxRadius - minRadius);

    const x = Math.floor(context.playerX + Math.cos(angle) * radius) + 0.5;
    const z = Math.floor(context.playerZ + Math.sin(angle) * radius) + 0.5;
    return context.world.isLoadedAt(x, z) ? { x, z } : null;
  }

  /**
   * Ground must be solid and dry. Spawning into a lake produces a creature
   * that immediately drifts away.
   */
  private isValidGround(world: World, x: number, y: number, z: number): boolean {
    const below = world.getBlock(x, y - 1, z);
    if (!BlockRegistry.isSolid(below)) return false;
    if (below === BlockId.Leaves) return false;
    return world.getBlock(x, y, z) === BlockId.Air;
  }

  /**
   * Clear headroom for the creature's full height. Spawning into a ceiling
   * produces one that suffocates or is shoved through the floor.
   */
  private hasHeadroom(
    world: World,
    x: number,
    y: number,
    z: number,
    definition: EntityDefinition,
  ): boolean {
    const headroom = Math.ceil(definition.height);
    for (let offset = 0; offset < headroom; offset++) {
      if (world.getBlock(x, y + offset, z) !== BlockId.Air) return false;
    }
    return true;
  }

  private buildGroup(
    context: SpawnContext,
    definition: EntityDefinition,
    origin: Candidate,
    remaining: number,
  ): SpawnRequest[] {
    const span = definition.groupMax - definition.groupMin;
    const size = Math.min(
      remaining,
      definition.groupMin + Math.floor(context.random() * (span + 1)),
    );

    const requests: SpawnRequest[] = [];
    for (let i = 0; i < size; i++) {
      // Scatter the group slightly rather than stacking them on one block.
      const offsetX = i === 0 ? 0 : Math.round((context.random() - 0.5) * 4);
      const offsetZ = i === 0 ? 0 : Math.round((context.random() - 0.5) * 4);
      const x = origin.x + offsetX;
      const z = origin.z + offsetZ;

      // A sheltered group keeps its own level; a surface group re-snaps to the
      // terrain so members do not hang off the side of a slope.
      const y = origin.skyExposed ? context.world.surfaceHeightAt(x, z) : origin.y;
      if (y === null) continue;
      if (!this.isValidGround(context.world, x, y, z)) continue;
      if (!this.hasHeadroom(context.world, x, y, z, definition)) continue;

      requests.push({
        type: definition.id,
        x,
        y,
        z,
        yaw: context.random() * Math.PI * 2,
      });
    }

    return requests;
  }
}

/**
 * True when nothing opaque stands between this cell and the sky.
 *
 * This is the engine's stand-in for a light level: there is no propagated
 * lighting model, so "can see the sky" is what separates a lit meadow from a
 * cave or a roofed-in base.
 */
export function isSkyExposed(world: World, x: number, y: number, z: number): boolean {
  for (let above = Math.floor(y) + 1; above < CHUNK_HEIGHT; above++) {
    if (BlockRegistry.isOpaque(world.getBlock(x, above, z))) return false;
  }
  return true;
}

function chooseWeighted(
  pool: readonly EntityDefinition[],
  random: number,
): EntityDefinition {
  let total = 0;
  for (const definition of pool) total += Math.max(0, definition.spawnWeight);
  if (total <= 0) return pool[0];

  let cursor = Math.max(0, Math.min(0.999999999, random)) * total;
  for (const definition of pool) {
    cursor -= Math.max(0, definition.spawnWeight);
    if (cursor < 0) return definition;
  }
  return pool[pool.length - 1];
}
