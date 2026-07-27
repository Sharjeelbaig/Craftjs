import { describe, expect, it } from 'vitest';
import { MobSpawner, isSkyExposed } from '@domain/entity/MobSpawner';
import { EntityRegistry, EntityTypeId, HOSTILE_TYPES } from '@domain/entity/EntityType';
import { BlockId } from '@domain/world/BlockType';
import { Chunk } from '@domain/world/Chunk';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';

/** A flat stone world at `surface`, spanning enough chunks to sample a ring. */
function flatWorld(surface = 40, radius = 5): World {
  const world = new World();
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new Chunk(ChunkCoord.of(cx, cz));
      for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
        for (let localX = 0; localX < CHUNK_SIZE; localX++) {
          chunk.setGenerated(localX, 0, localZ, BlockId.Bedrock);
          for (let y = 1; y <= surface; y++) {
            chunk.setGenerated(localX, y, localZ, BlockId.Stone);
          }
        }
      }
      chunk.markGenerated();
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Hollows out a 3-high corridor at `y`, leaving stone above it as a roof. */
function carveCorridor(world: World, y: number, from: number, to: number, z: number): void {
  for (let x = from; x <= to; x++) {
    for (let offset = 0; offset < 3; offset++) {
      world.setBlock(x, y + offset, z, BlockId.Air);
    }
  }
}

/** Deterministic cycling source so plan() explores its whole attempt loop. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

const context = (world: World, overrides: Record<string, unknown> = {}) => ({
  world,
  playerX: 0.5,
  playerY: 41,
  playerZ: 0.5,
  isNight: false,
  hostilesAllowed: true,
  passiveCount: 0,
  hostileCount: 0,
  random: Math.random,
  ...overrides,
});

describe('isSkyExposed', () => {
  it('is true on an open surface', () => {
    const world = flatWorld();
    expect(isSkyExposed(world, 0.5, 41, 0.5)).toBe(true);
  });

  it('is false under solid ground', () => {
    const world = flatWorld();
    expect(isSkyExposed(world, 0.5, 20, 0.5)).toBe(false);
  });

  it('becomes true once the roof above is mined out', () => {
    const world = flatWorld(40);
    expect(isSkyExposed(world, 8.5, 30, 8.5)).toBe(false);
    for (let y = 30; y <= 40; y++) world.setBlock(8, y, 8, BlockId.Air);
    expect(isSkyExposed(world, 8.5, 30, 8.5)).toBe(true);
  });

  it('sees past glass and other non-opaque blocks', () => {
    const world = flatWorld(40);
    for (let y = 30; y <= 40; y++) world.setBlock(8, y, 8, BlockId.Air);
    world.setBlock(8, 41, 8, BlockId.Glass);
    expect(isSkyExposed(world, 8.5, 30, 8.5)).toBe(true);
  });
});

describe('surface spawning', () => {
  it('spawns passives in daylight on open ground', () => {
    const spawner = new MobSpawner({ darkSpawns: false });
    const requests = spawner.plan(context(flatWorld(), { random: sequence([0.1, 0.5, 0.3, 0.2]) }));

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(EntityRegistry.get(request.type).temperament).toBe('passive');
    }
  });

  it('spawns hostiles once night falls', () => {
    const spawner = new MobSpawner({ darkSpawns: false });
    const requests = spawner.plan(
      context(flatWorld(), { isNight: true, random: sequence([0.1, 0.5, 0.3, 0.2]) }),
    );

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(EntityRegistry.get(request.type).temperament).toBe('hostile');
    }
  });

  it('keeps every spawn inside the exclusion ring around the player', () => {
    const spawner = new MobSpawner({ minRadius: 14, maxRadius: 44 });
    let checked = 0;

    for (let attempt = 0; attempt < 60; attempt++) {
      for (const request of spawner.plan(context(flatWorld(40, 6), { isNight: true }))) {
        const distance = Math.hypot(request.x - 0.5, request.z - 0.5);
        // Group scatter can nudge a member slightly inside the nominal ring.
        expect(distance).toBeGreaterThan(8);
        expect(distance).toBeLessThan(52);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('produces nothing when every population is at cap', () => {
    const spawner = new MobSpawner();
    const requests = spawner.plan(
      context(flatWorld(), { isNight: true, hostileCount: 99, passiveCount: 99 }),
    );
    expect(requests).toEqual([]);
  });

  it('produces no hostiles in a mode that does not attract them', () => {
    const spawner = new MobSpawner();
    for (let attempt = 0; attempt < 40; attempt++) {
      const requests = spawner.plan(
        context(flatWorld(), { isNight: true, hostilesAllowed: false }),
      );
      for (const request of requests) {
        expect(EntityRegistry.get(request.type).temperament).not.toBe('hostile');
      }
    }
  });

  it('finds no ground in unloaded space', () => {
    const spawner = new MobSpawner();
    const requests = spawner.plan(context(new World(), { isNight: true }));
    expect(requests).toEqual([]);
  });
});

describe('sheltered spawning', () => {
  /**
   * The reason zombies were unfindable: hostiles only appeared on the surface
   * at night, so a player who dug a mine met nothing at all.
   */
  it('spawns hostiles in a roofed corridor during the day', () => {
    const world = flatWorld(40, 5);
    // A long corridor at every angle around the player, well inside the ring.
    for (const z of [-30, -20, 20, 30]) carveCorridor(world, 20, -40, 40, z);
    for (let x = -40; x <= 40; x++) {
      for (const offset of [0, 1, 2]) {
        world.setBlock(x, 20 + offset, -25, BlockId.Air);
        world.setBlock(x, 20 + offset, 25, BlockId.Air);
      }
    }

    const spawner = new MobSpawner({ darkSpawns: true, undergroundFloor: 5 });
    let hostiles = 0;
    for (let attempt = 0; attempt < 300; attempt++) {
      for (const request of spawner.plan(context(world))) {
        if (EntityRegistry.get(request.type).temperament !== 'hostile') continue;
        hostiles++;
        // Underground, and under a roof.
        expect(request.y).toBeLessThan(40);
        expect(isSkyExposed(world, request.x, request.y, request.z)).toBe(false);
      }
    }
    expect(hostiles).toBeGreaterThan(0);
  });

  it('finds nothing to shelter in when the ground is solid rock', () => {
    const spawner = new MobSpawner({ darkSpawns: true });
    const world = flatWorld(40, 5);

    for (let attempt = 0; attempt < 120; attempt++) {
      for (const request of spawner.plan(context(world))) {
        // Solid stone offers no pocket, so any spawn must be a surface passive.
        expect(request.y).toBe(41);
      }
    }
  });

  it('never spawns below the configured floor', () => {
    const world = flatWorld(40, 5);
    for (const z of [-25, 25]) carveCorridor(world, 6, -40, 40, z);

    const spawner = new MobSpawner({ darkSpawns: true, undergroundFloor: 10 });
    for (let attempt = 0; attempt < 200; attempt++) {
      for (const request of spawner.plan(context(world))) {
        expect(request.y).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('leaves headroom for the tallest hostile it can choose', () => {
    const world = flatWorld(40, 5);
    // A one-block-high crawlspace: too short for a zombie or skeleton.
    for (const z of [-25, 25]) {
      for (let x = -40; x <= 40; x++) world.setBlock(x, 20, z, BlockId.Air);
    }

    const spawner = new MobSpawner({ darkSpawns: true });
    for (let attempt = 0; attempt < 200; attempt++) {
      for (const request of spawner.plan(context(world))) {
        if (request.y !== 20) continue;
        const definition = EntityRegistry.get(request.type);
        expect(Math.ceil(definition.height), definition.name).toBe(1);
      }
    }
  });
});

describe('hostile pool', () => {
  it('offers every hostile creature and no vehicles', () => {
    expect(HOSTILE_TYPES.length).toBeGreaterThan(0);
    for (const definition of HOSTILE_TYPES) {
      expect(definition.wildlife).toBe(true);
      expect(definition.id).not.toBe(EntityTypeId.Minecart);
      expect(definition.id).not.toBe(EntityTypeId.RemotePlayer);
    }
  });
});
