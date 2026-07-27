import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { CAVE_FLOOR, CAVE_ROOF, Underground } from '@domain/generation/Underground';
import { fbm3, random3, valueNoise3 } from '@domain/generation/Noise';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { BlockId } from '@domain/world/BlockType';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';

const ORE_BLOCKS = [
  BlockId.CoalOre,
  BlockId.IronOre,
  BlockId.GoldOre,
  BlockId.DiamondOre,
] as const;

describe('3D noise', () => {
  it('is deterministic for the same coordinates and seed', () => {
    for (const [x, y, z] of [[0, 0, 0], [3.5, -7.25, 12.5], [-99.5, 40, 8]] as const) {
      expect(random3(x, y, z, 7)).toBe(random3(x, y, z, 7));
      expect(valueNoise3(x, y, z, 7)).toBe(valueNoise3(x, y, z, 7));
      expect(fbm3(x, y, z, 7, { octaves: 2, frequency: 0.05 })).toBe(
        fbm3(x, y, z, 7, { octaves: 2, frequency: 0.05 }),
      );
    }
  });

  it('varies along every axis, including depth', () => {
    const base = valueNoise3(4.5, 4.5, 4.5, 11);
    expect(valueNoise3(9.5, 4.5, 4.5, 11)).not.toBe(base);
    expect(valueNoise3(4.5, 9.5, 4.5, 11)).not.toBe(base);
    expect(valueNoise3(4.5, 4.5, 9.5, 11)).not.toBe(base);
  });

  it('stays within the unit range', () => {
    for (let i = 0; i < 3000; i++) {
      const value = fbm3(i * 1.7, i * 0.9, i * 2.3, 5, { octaves: 3, frequency: 0.03 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('Underground', () => {
  const underground = new Underground(1337);

  it('never carves the bedrock cap or its margin', () => {
    for (let y = 0; y < CAVE_FLOOR; y++) {
      for (let x = 0; x < 40; x++) {
        expect(underground.isCave(x, y, x * 3, 90), `y=${y}`).toBe(false);
      }
    }
  });

  it('never breaks through to the surface', () => {
    const surface = 70;
    for (let y = surface - CAVE_ROOF + 1; y <= surface + 4; y++) {
      for (let x = 0; x < 40; x++) {
        expect(underground.isCave(x, y, x * 5, surface), `y=${y}`).toBe(false);
      }
    }
  });

  it('confines each ore to its own depth band', () => {
    const bands = new Map<number, { min: number; max: number }>();
    for (let y = 0; y < 140; y++) {
      for (let z = 0; z < 40; z++) {
        for (let x = 0; x < 40; x++) {
          const ore = underground.oreAt(x, y, z);
          if (ore === null) continue;
          const band = bands.get(ore) ?? { min: Infinity, max: -Infinity };
          bands.set(ore, { min: Math.min(band.min, y), max: Math.max(band.max, y) });
        }
      }
    }

    // Diamond stays deepest, coal reaches highest — the shape that makes
    // digging down worth the trip.
    const diamond = bands.get(BlockId.DiamondOre);
    const coal = bands.get(BlockId.CoalOre);
    expect(diamond).toBeDefined();
    expect(coal).toBeDefined();
    expect((diamond as { max: number }).max).toBeLessThan((coal as { max: number }).max);
    expect((diamond as { max: number }).max).toBeLessThanOrEqual(17);
  });

  it('is deterministic across instances with the same seed', () => {
    const other = new Underground(1337);
    for (let i = 0; i < 500; i++) {
      const x = i * 3;
      const y = 5 + (i % 80);
      const z = i * 7;
      expect(other.isCave(x, y, z, 120)).toBe(underground.isCave(x, y, z, 120));
      expect(other.oreAt(x, y, z)).toBe(underground.oreAt(x, y, z));
    }
  });

  it('produces a different underground for a different seed', () => {
    const other = new Underground(99);
    let differences = 0;
    for (let i = 0; i < 4000; i++) {
      const x = i % 64;
      const y = 6 + (i % 60);
      const z = Math.floor(i / 64);
      if (other.oreAt(x, y, z) !== underground.oreAt(x, y, z)) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe('generated terrain with ores and caves', () => {
  const generator = new TerrainGenerator(1337);

  /** One sweep of a region, gathering everything the assertions need. */
  const survey = (() => {
    const oreCounts = new Map<number, number>();
    let stoneRangeCells = 0;
    let caveCells = 0;
    let standableCaveFloors = 0;

    for (let cz = 0; cz < 4; cz++) {
      for (let cx = 0; cx < 4; cx++) {
        const coord = ChunkCoord.of(cx, cz);
        const chunk = generator.generate(coord);
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
          for (let localX = 0; localX < CHUNK_SIZE; localX++) {
            const height = generator.heightAt(coord.originX + localX, coord.originZ + localZ);
            for (let y = 2; y <= height - 4; y++) {
              stoneRangeCells++;
              const block = chunk.get(localX, y, localZ);
              if (block === BlockId.Air) {
                caveCells++;
                if (
                  chunk.get(localX, y + 1, localZ) === BlockId.Air &&
                  chunk.get(localX, y - 1, localZ) !== BlockId.Air
                ) {
                  standableCaveFloors++;
                }
              }
              oreCounts.set(block, (oreCounts.get(block) ?? 0) + 1);
            }
          }
        }
      }
    }
    return { oreCounts, stoneRangeCells, caveCells, standableCaveFloors };
  })();

  it('carves open cave volume without hollowing out the world', () => {
    const fraction = survey.caveCells / survey.stoneRangeCells;
    expect(fraction).toBeGreaterThan(0.01);
    expect(fraction).toBeLessThan(0.2);
  });

  it('leaves floors a creature can stand on, so mines are not empty', () => {
    expect(survey.standableCaveFloors).toBeGreaterThan(100);
  });

  it('places every ore type, each rarer than the one above it', () => {
    const counts = ORE_BLOCKS.map((ore) => survey.oreCounts.get(ore) ?? 0);
    for (const [index, count] of counts.entries()) {
      expect(count, `ore ${ORE_BLOCKS[index]}`).toBeGreaterThan(0);
    }

    const [coal, iron, gold, diamond] = counts;
    expect(coal).toBeGreaterThan(iron);
    expect(iron).toBeGreaterThan(gold);
    expect(gold).toBeGreaterThan(diamond);
  });

  it('keeps ore scarce enough to be worth finding', () => {
    for (const ore of ORE_BLOCKS) {
      const fraction = (survey.oreCounts.get(ore) ?? 0) / survey.stoneRangeCells;
      expect(fraction, `ore ${ore}`).toBeLessThan(0.02);
    }
  });

  it('still caps the world with unbroken bedrock', () => {
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const chunk = generator.generate(ChunkCoord.of(cx, cz));
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
          for (let localX = 0; localX < CHUNK_SIZE; localX++) {
            expect(chunk.get(localX, 0, localZ)).toBe(BlockId.Bedrock);
          }
        }
      }
    }
  });

  it('still reports a solid block at every surface height', () => {
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const coord = ChunkCoord.of(cx, cz);
        const chunk = generator.generate(coord);
        for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
          for (let localX = 0; localX < CHUNK_SIZE; localX++) {
            const height = generator.heightAt(coord.originX + localX, coord.originZ + localZ);
            expect(chunk.get(localX, height, localZ)).not.toBe(BlockId.Air);
          }
        }
      }
    }
  });

  it('remains deterministic now that caves and ore are generated', () => {
    const coord = ChunkCoord.of(3, -2);
    const first = generator.generate(coord);
    const second = new TerrainGenerator(1337).generate(coord);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });
});
