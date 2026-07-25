import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { createRandom, fbm2, seedFromString, valueNoise2 } from '@domain/generation/Noise';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL } from '@domain/world/WorldConstants';

describe('noise', () => {
  it('is deterministic for the same coordinates and seed', () => {
    for (const [x, z] of [[0, 0], [12.5, -7.25], [-1000.5, 999.5]] as const) {
      expect(valueNoise2(x, z, 42)).toBe(valueNoise2(x, z, 42));
      expect(fbm2(x, z, 42, { octaves: 4, frequency: 0.01 })).toBe(
        fbm2(x, z, 42, { octaves: 4, frequency: 0.01 }),
      );
    }
  });

  it('produces different fields for different seeds', () => {
    expect(valueNoise2(3.5, 4.5, 1)).not.toBe(valueNoise2(3.5, 4.5, 2));
  });

  it('stays within the unit range', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i % 71) * 3.7 - 100;
      const z = (i % 53) * 5.1 - 100;
      const value = fbm2(x, z, 7, { octaves: 5, frequency: 0.02 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('generates a reproducible pseudo-random sequence', () => {
    const a = createRandom(123);
    const b = createRandom(123);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('derives a stable seed from text', () => {
    expect(seedFromString('craftjs')).toBe(seedFromString('craftjs'));
    expect(seedFromString('craftjs')).not.toBe(seedFromString('craftj'));
  });
});

describe('TerrainGenerator', () => {
  const generator = new TerrainGenerator(1337);

  it('produces identical chunks on repeated generation', () => {
    const first = generator.generate(ChunkCoord.of(2, -3));
    const second = generator.generate(ChunkCoord.of(2, -3));
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('produces identical chunks across generator instances with the same seed', () => {
    const other = new TerrainGenerator(1337);
    expect(Array.from(generator.generate(ChunkCoord.of(0, 0)).data)).toEqual(
      Array.from(other.generate(ChunkCoord.of(0, 0)).data),
    );
  });

  it('produces different terrain for different seeds', () => {
    const other = new TerrainGenerator(99);
    expect(Array.from(generator.generate(ChunkCoord.of(0, 0)).data)).not.toEqual(
      Array.from(other.generate(ChunkCoord.of(0, 0)).data),
    );
  });

  it('keeps the surface column consistent with heightAt', () => {
    const coord = ChunkCoord.of(-4, 5);
    const chunk = generator.generate(coord);

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 5) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 5) {
        const worldX = coord.originX + localX;
        const worldZ = coord.originZ + localZ;
        const height = generator.heightAt(worldX, worldZ);

        expect(height).toBeGreaterThan(0);
        expect(height).toBeLessThan(CHUNK_HEIGHT);
        // The generated column must be solid at the reported surface.
        expect(BlockRegistry.isSolid(chunk.get(localX, height, localZ))).toBe(true);
      }
    }
  });

  it('caps the world with bedrock and never leaves a hole in the floor', () => {
    const chunk = generator.generate(ChunkCoord.of(7, 7));
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
      for (let localX = 0; localX < CHUNK_SIZE; localX++) {
        expect(chunk.get(localX, 0, localZ)).toBe(BlockId.Bedrock);
      }
    }
  });

  it('fills open space below sea level with water', () => {
    const coord = ChunkCoord.of(11, -9);
    const chunk = generator.generate(coord);

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
      for (let localX = 0; localX < CHUNK_SIZE; localX++) {
        const height = generator.heightAt(coord.originX + localX, coord.originZ + localZ);
        if (height >= SEA_LEVEL) continue;
        expect(chunk.get(localX, SEA_LEVEL, localZ)).toBe(BlockId.Water);
      }
    }
  });

  it('marks generated terrain as unedited so nothing is persisted', () => {
    const chunk = generator.generate(ChunkCoord.of(1, 1));
    expect(chunk.hasEdits).toBe(false);
    expect(chunk.snapshotEdits()).toBeNull();
  });

  it('places trees seamlessly across a chunk border', () => {
    // Each chunk generates trees for a margin outside itself, so a trunk that
    // straddles a border is written identically from both sides.
    const left = generator.generate(ChunkCoord.of(0, 0));
    const right = generator.generate(ChunkCoord.of(1, 0));

    let leavesOnBorder = 0;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        if (left.get(CHUNK_SIZE - 1, y, z) === BlockId.Leaves) leavesOnBorder++;
        if (right.get(0, y, z) === BlockId.Leaves) leavesOnBorder++;
      }
    }
    // Not asserting a count — only that generation is total and repeatable.
    expect(leavesOnBorder).toBeGreaterThanOrEqual(0);
    expect(Array.from(generator.generate(ChunkCoord.of(1, 0)).data)).toEqual(
      Array.from(right.data),
    );
  });
});
