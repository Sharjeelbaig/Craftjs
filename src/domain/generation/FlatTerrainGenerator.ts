import { Chunk } from '../world/Chunk';
import type { ChunkCoord } from '../world/ChunkCoord';
import { BlockId } from '../world/BlockType';
import { CHUNK_SIZE } from '../world/WorldConstants';
import type { ChunkGenerator } from './ChunkGenerator';

/**
 * Stable flat preset layer stack (inclusive):
 *
 * - y=0: bedrock
 * - y=1..43: stone
 * - y=44..46: dirt
 * - y=47: grass
 * - y>=48: air
 */
export const FLAT_SURFACE_Y = 47;
export const FLAT_STONE_TOP_Y = 43;
export const FLAT_DIRT_TOP_Y = 46;

export class FlatTerrainGenerator implements ChunkGenerator {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  heightAt(_worldX: number, _worldZ: number): number {
    return FLAT_SURFACE_Y;
  }

  generate(coord: ChunkCoord): Chunk {
    const chunk = new Chunk(coord);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        chunk.setGenerated(x, 0, z, BlockId.Bedrock);
        for (let y = 1; y <= FLAT_STONE_TOP_Y; y++) {
          chunk.setGenerated(x, y, z, BlockId.Stone);
        }
        for (let y = FLAT_STONE_TOP_Y + 1; y <= FLAT_DIRT_TOP_Y; y++) {
          chunk.setGenerated(x, y, z, BlockId.Dirt);
        }
        chunk.setGenerated(x, FLAT_SURFACE_Y, z, BlockId.Grass);
      }
    }
    chunk.markGenerated();
    return chunk;
  }
}
