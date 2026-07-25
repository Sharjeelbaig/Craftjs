import { createRandom, hash2 } from '../generation/Noise';
import { blockItem, type ItemId } from '../inventory/Item';
import { BlockId } from './BlockType';
import type { ChunkGenerator } from '../generation/ChunkGenerator';
import { SEA_LEVEL } from './WorldConstants';

const LOOT_SEED = 0x6b8b4567;
const POSITION_SEED = 0x327b23c6;

export interface StarterChestLoot {
  readonly item: ItemId;
  readonly count: number;
}

export interface BlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Small fixed catalogue with deterministic counts; intentionally no rare loot. */
export function starterChestLoot(seed: number): readonly StarterChestLoot[] {
  const random = createRandom((seed ^ LOOT_SEED) | 0);
  return Object.freeze([
    Object.freeze({ item: blockItem(BlockId.Log), count: 3 + Math.floor(random() * 3) }),
    Object.freeze({ item: blockItem(BlockId.Planks), count: 6 + Math.floor(random() * 5) }),
    Object.freeze({ item: blockItem(BlockId.Cobblestone), count: 4 + Math.floor(random() * 5) }),
  ]);
}

/** Places the chest close to spawn but independently of chunk generation order. */
export function starterChestPosition(
  generator: ChunkGenerator,
  seed: number,
): BlockPosition {
  const hash = hash2(0, 0, (seed ^ POSITION_SEED) | 0);
  const x = 3 + (hash & 3);
  const z = 3 + ((hash >>> 2) & 3);
  return Object.freeze({
    x,
    y: Math.max(generator.heightAt(x, z) + 1, SEA_LEVEL + 1),
    z,
  });
}
