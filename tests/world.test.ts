import { describe, expect, it } from 'vitest';
import { Chunk } from '@domain/world/Chunk';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  voxelIndex,
  worldToChunkAxis,
  worldToLocalAxis,
} from '@domain/world/WorldConstants';

describe('coordinate mapping', () => {
  it('maps negative world coordinates to the correct chunk and local axis', () => {
    expect(worldToChunkAxis(0)).toBe(0);
    expect(worldToChunkAxis(15)).toBe(0);
    expect(worldToChunkAxis(16)).toBe(1);
    expect(worldToChunkAxis(-1)).toBe(-1);
    expect(worldToChunkAxis(-16)).toBe(-1);
    expect(worldToChunkAxis(-17)).toBe(-2);

    expect(worldToLocalAxis(-1)).toBe(15);
    expect(worldToLocalAxis(-16)).toBe(0);
    expect(worldToLocalAxis(16)).toBe(0);
  });

  it('produces a unique voxel index for every cell in a chunk', () => {
    const seen = new Set<number>();
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const index = voxelIndex(x, y, z);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(CHUNK_VOLUME);
          seen.add(index);
        }
      }
    }
    expect(seen.size).toBe(CHUNK_VOLUME);
  });

  it('addresses the same chunk from every construction path', () => {
    const key = ChunkCoord.of(3, -4).key;
    expect(ChunkCoord.parse('3,-4')?.key).toBe(key);
    expect(ChunkCoord.fromWorld(48, -49).key).toBe(key);
    expect(ChunkCoord.of(2, -4).offset(1, 0).key).toBe(key);
  });

  it('rejects malformed chunk keys instead of producing NaN coordinates', () => {
    expect(ChunkCoord.parse('')).toBeNull();
    expect(ChunkCoord.parse('nope')).toBeNull();
    expect(ChunkCoord.parse(',5')).toBeNull();
    expect(ChunkCoord.parse('a,b')).toBeNull();
  });

  it('exposes the world-space origin of a chunk', () => {
    const coord = ChunkCoord.of(-2, 3);
    expect(coord.originX).toBe(-2 * CHUNK_SIZE);
    expect(coord.originZ).toBe(3 * CHUNK_SIZE);
    expect(coord.chebyshevDistanceTo(ChunkCoord.of(0, 0))).toBe(3);
  });
});

describe('Chunk', () => {
  it('tracks edits separately from generated terrain', () => {
    const chunk = new Chunk(ChunkCoord.of(0, 0));

    chunk.setGenerated(1, 2, 3, BlockId.Stone);
    expect(chunk.get(1, 2, 3)).toBe(BlockId.Stone);
    expect(chunk.hasEdits).toBe(false);
    expect(chunk.snapshotEdits()).toBeNull();

    chunk.set(1, 2, 3, BlockId.Sand);
    expect(chunk.hasEdits).toBe(true);
    expect(chunk.hasUnsavedEdits).toBe(true);

    const snapshot = chunk.snapshotEdits();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.indices.length).toBe(1);
    expect(snapshot?.blocks[0]).toBe(BlockId.Sand);
  });

  it('bumps its revision only when a value actually changes', () => {
    const chunk = new Chunk(ChunkCoord.of(0, 0));
    chunk.set(0, 0, 0, BlockId.Stone);
    const revision = chunk.revision;

    expect(chunk.set(0, 0, 0, BlockId.Stone)).toBe(false);
    expect(chunk.revision).toBe(revision);

    expect(chunk.set(0, 0, 0, BlockId.Dirt)).toBe(true);
    expect(chunk.revision).toBeGreaterThan(revision);
  });

  it('round-trips an edit delta', () => {
    const source = new Chunk(ChunkCoord.of(0, 0));
    source.set(5, 10, 7, BlockId.Planks);
    source.set(0, 0, 0, BlockId.Glass);

    const snapshot = source.snapshotEdits();
    expect(snapshot).not.toBeNull();

    const restored = new Chunk(ChunkCoord.of(0, 0));
    restored.applyEdits(snapshot!);

    expect(restored.get(5, 10, 7)).toBe(BlockId.Planks);
    expect(restored.get(0, 0, 0)).toBe(BlockId.Glass);
  });

  it('ignores out-of-range coordinates instead of throwing', () => {
    const chunk = new Chunk(ChunkCoord.of(0, 0));
    expect(chunk.get(-1, 0, 0)).toBe(BlockId.Air);
    expect(chunk.get(0, CHUNK_HEIGHT, 0)).toBe(BlockId.Air);
    expect(chunk.set(CHUNK_SIZE, 0, 0, BlockId.Stone)).toBe(false);
  });

  it('rejects a voxel array of the wrong size', () => {
    expect(() => new Chunk(ChunkCoord.of(0, 0), new Uint8Array(10))).toThrow(RangeError);
  });
});

describe('World', () => {
  const withChunk = (cx: number, cz: number): { world: World; chunk: Chunk } => {
    const world = new World();
    const chunk = new Chunk(ChunkCoord.of(cx, cz));
    world.addChunk(chunk);
    return { world, chunk };
  };

  it('reads and writes across the chunk grid, including negatives', () => {
    const world = new World();
    world.addChunk(new Chunk(ChunkCoord.of(-1, -1)));

    expect(world.setBlock(-1, 4, -1, BlockId.Stone)).not.toBeNull();
    expect(world.getBlock(-1, 4, -1)).toBe(BlockId.Stone);
    expect(world.getBlock(-16, 4, -16)).toBe(BlockId.Air);
  });

  it('returns null when writing into an unloaded chunk', () => {
    const { world } = withChunk(0, 0);
    expect(world.setBlock(100, 4, 100, BlockId.Stone)).toBeNull();
  });

  it('reports neighbouring chunks as affected for border edits', () => {
    const world = new World();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.addChunk(new Chunk(ChunkCoord.of(dx, dz)));
      }
    }

    const interior = world.setBlock(8, 4, 8, BlockId.Stone);
    expect(interior?.affectedChunks).toHaveLength(1);

    const edge = world.setBlock(0, 4, 8, BlockId.Stone);
    expect(edge?.affectedChunks.map((c) => c.key).sort()).toEqual(['-1,0', '0,0']);

    const corner = world.setBlock(0, 4, 0, BlockId.Stone);
    expect(corner?.affectedChunks.map((c) => c.key).sort()).toEqual([
      '-1,-1',
      '-1,0',
      '0,-1',
      '0,0',
    ]);
  });

  it('treats unloaded chunks and the world floor as solid for collision', () => {
    const { world } = withChunk(0, 0);

    // Unloaded region: must not let an entity fall through streaming terrain.
    expect(world.isSolidAt(1000, 40, 1000)).toBe(true);
    // Below the world floor.
    expect(world.isSolidAt(1, -1, 1)).toBe(true);
    // Loaded but empty.
    expect(world.isSolidAt(1, 40, 1)).toBe(false);
    // Above the world ceiling is open, not a lid.
    expect(world.isSolidAt(1, CHUNK_HEIGHT + 5, 1)).toBe(false);
  });

  it('detects when all eight neighbours are resident', () => {
    const world = new World();
    world.addChunk(new Chunk(ChunkCoord.of(0, 0)));
    expect(world.hasAllNeighbours(ChunkCoord.of(0, 0))).toBe(false);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        world.addChunk(new Chunk(ChunkCoord.of(dx, dz)));
      }
    }
    expect(world.hasAllNeighbours(ChunkCoord.of(0, 0))).toBe(true);
  });

  it('keeps the internal chunk cache correct after add and remove', () => {
    const world = new World();
    const chunk = new Chunk(ChunkCoord.of(0, 0));
    world.addChunk(chunk);
    chunk.set(1, 1, 1, BlockId.Stone);

    // Prime the single-entry lookup cache.
    expect(world.getBlock(1, 1, 1)).toBe(BlockId.Stone);

    world.removeChunk(ChunkCoord.of(0, 0));
    expect(world.getBlock(1, 1, 1)).toBe(BlockId.Air);

    world.addChunk(chunk);
    expect(world.getBlock(1, 1, 1)).toBe(BlockId.Stone);
  });

  it('finds the surface above the highest solid block', () => {
    const { world, chunk } = withChunk(0, 0);
    chunk.setGenerated(3, 20, 4, BlockId.Stone);
    chunk.setGenerated(3, 21, 4, BlockId.Water);
    expect(world.surfaceHeightAt(3, 4)).toBe(21);
    expect(world.surfaceHeightAt(200, 200)).toBeNull();
  });
});

describe('BlockRegistry', () => {
  it('degrades unknown block ids to air rather than throwing', () => {
    expect(BlockRegistry.get(240).id).toBe(BlockId.Air);
    expect(BlockRegistry.isSolid(240)).toBe(false);
    expect(BlockRegistry.isKnown(240)).toBe(false);
  });

  it('defines six face textures for every block', () => {
    for (const definition of BlockRegistry.all()) {
      expect(definition.textures).toHaveLength(6);
    }
  });

  it('keeps water non-solid, liquid and replaceable', () => {
    expect(BlockRegistry.isSolid(BlockId.Water)).toBe(false);
    expect(BlockRegistry.isLiquid(BlockId.Water)).toBe(true);
    expect(BlockRegistry.isReplaceable(BlockId.Water)).toBe(true);
    expect(BlockRegistry.isOpaque(BlockId.Water)).toBe(false);
  });
});
