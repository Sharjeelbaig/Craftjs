import { BlockId, BlockRegistry } from '../world/BlockType';
import type { World } from '../world/World';
import { WORLD_MAX_Y } from '../world/WorldConstants';
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
}

export const DEFAULT_SPAWN_SETTINGS: SpawnSettings = Object.freeze({
  minRadius: 22,
  maxRadius: 46,
  maxPassive: 14,
  maxHostile: 10,
  attemptsPerCycle: 12,
  cycleSeconds: 3,
  despawnRadius: 88,
});

export interface SpawnContext {
  readonly world: World;
  readonly playerX: number;
  readonly playerZ: number;
  readonly isNight: boolean;
  readonly passiveCount: number;
  readonly hostileCount: number;
  readonly random: () => number;
}

/**
 * Decides where and what to spawn.
 *
 * Kept separate from the entity store so the rules — population caps, the
 * exclusion ring around the player, valid ground — can be tested directly
 * against a hand-built world.
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
    const hostile = context.isNight && context.hostileCount < settings.maxHostile;
    const passive = !context.isNight && context.passiveCount < settings.maxPassive;

    // Passives only appear in daylight and hostiles only at night, so the two
    // populations never compete for the same spawn cycle.
    const pool = hostile ? HOSTILE_TYPES : passive ? PASSIVE_TYPES : null;
    if (pool === null || pool.length === 0) return [];

    const remaining = hostile
      ? settings.maxHostile - context.hostileCount
      : settings.maxPassive - context.passiveCount;

    for (let attempt = 0; attempt < settings.attemptsPerCycle; attempt++) {
      const point = this.samplePosition(context);
      if (point === null) continue;

      const definition = chooseWeighted(pool, context.random());
      if (!this.isValidGround(context.world, point.x, point.y, point.z, definition)) continue;

      return this.buildGroup(context, definition, point, remaining);
    }

    return [];
  }

  /** A random point in the ring around the player, snapped to the surface. */
  private samplePosition(
    context: SpawnContext,
  ): { x: number; y: number; z: number } | null {
    const { minRadius, maxRadius } = this.settings;
    const angle = context.random() * Math.PI * 2;
    const radius = minRadius + context.random() * (maxRadius - minRadius);

    const x = Math.floor(context.playerX + Math.cos(angle) * radius) + 0.5;
    const z = Math.floor(context.playerZ + Math.sin(angle) * radius) + 0.5;

    // Unloaded terrain has no surface to stand on.
    const surface = context.world.surfaceHeightAt(x, z);
    if (surface === null) return null;
    if (surface <= 0 || surface > WORLD_MAX_Y - 4) return null;

    return { x, y: surface, z };
  }

  /**
   * Ground must be solid, dry, and have clear headroom for the creature.
   * Spawning into a wall or a lake produces a creature that immediately
   * suffocates or drifts away.
   */
  private isValidGround(
    world: World,
    x: number,
    y: number,
    z: number,
    definition: EntityDefinition,
  ): boolean {
    const below = world.getBlock(x, y - 1, z);
    if (!BlockRegistry.isSolid(below)) return false;
    if (below === BlockId.Leaves) return false;

    const headroom = Math.ceil(definition.height);
    for (let offset = 0; offset < headroom; offset++) {
      if (world.getBlock(x, y + offset, z) !== BlockId.Air) return false;
    }

    return true;
  }

  private buildGroup(
    context: SpawnContext,
    definition: EntityDefinition,
    origin: { x: number; y: number; z: number },
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

      const surface = context.world.surfaceHeightAt(x, z);
      if (surface === null) continue;
      if (!this.isValidGround(context.world, x, surface, z, definition)) continue;

      requests.push({
        type: definition.id,
        x,
        y: surface,
        z,
        yaw: context.random() * Math.PI * 2,
      });
    }

    return requests;
  }
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
