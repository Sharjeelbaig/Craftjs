import type { Chunk } from '../world/Chunk';
import type { ChunkCoord } from '../world/ChunkCoord';

/** Strategy used by chunk streaming; generation never depends on DOM state. */
export interface ChunkGenerator {
  readonly seed: number;
  heightAt(worldX: number, worldZ: number): number;
  generate(coord: ChunkCoord): Chunk;
}
