import { Chunk } from '../world/Chunk';
import type { ChunkCoord } from '../world/ChunkCoord';
import { BlockId } from '../world/BlockType';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_MAX_Y } from '../world/WorldConstants';
import { fbm2, random2 } from './Noise';
import type { ChunkGenerator } from './ChunkGenerator';

const SEED_HEIGHT = 0x1a2b3c4d;
const SEED_HILLS = 0x5e6f7a8b;
const SEED_TEMPERATURE = 0x2c9df10b;
const SEED_TREE = 0x7f4a7c15;
const SEED_TREE_SHAPE = 0x3d0e5a91;

/** Trees are generated for columns this far outside the chunk so canopies
 *  cross chunk borders seamlessly without cross-chunk writes. */
const TREE_MARGIN = 3;
const TREE_DENSITY = 0.012;

const BEDROCK_TOP = 1;
const MIN_TERRAIN_HEIGHT = 8;
const MAX_TERRAIN_HEIGHT = WORLD_MAX_Y - 24;

/**
 * Stateless, deterministic terrain synthesis.
 *
 * Every block is a pure function of (world coordinate, seed), so chunks can be
 * produced in any order, discarded, and regenerated identically. This is what
 * makes the world effectively unbounded while saves stay proportional to the
 * player's own edits.
 */
export class TerrainGenerator implements ChunkGenerator {
  readonly seed: number;

  private readonly heightSeed: number;
  private readonly hillSeed: number;
  private readonly temperatureSeed: number;
  private readonly treeSeed: number;
  private readonly treeShapeSeed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.heightSeed = (this.seed ^ SEED_HEIGHT) | 0;
    this.hillSeed = (this.seed ^ SEED_HILLS) | 0;
    this.temperatureSeed = (this.seed ^ SEED_TEMPERATURE) | 0;
    this.treeSeed = (this.seed ^ SEED_TREE) | 0;
    this.treeShapeSeed = (this.seed ^ SEED_TREE_SHAPE) | 0;
  }

  /** Surface height (topmost solid block Y) for a world column. */
  heightAt(worldX: number, worldZ: number): number {
    // Continental shape drives the broad land/sea split.
    const continent = fbm2(worldX, worldZ, this.heightSeed, {
      octaves: 4,
      frequency: 1 / 320,
      persistence: 0.5,
    });

    // Ridged detail adds local relief, squared so valleys stay wide and flat.
    const relief = fbm2(worldX, worldZ, this.hillSeed, {
      octaves: 4,
      frequency: 1 / 64,
      persistence: 0.45,
    });

    const base = SEA_LEVEL - 10 + continent * 44;
    const amplitude = 4 + Math.max(0, continent - 0.35) * 46;
    const height = Math.round(base + (relief - 0.5) * amplitude);

    return Math.min(MAX_TERRAIN_HEIGHT, Math.max(MIN_TERRAIN_HEIGHT, height));
  }

  /** Rough climate value in [0, 1]; picks the surface material. */
  private temperatureAt(worldX: number, worldZ: number): number {
    return fbm2(worldX, worldZ, this.temperatureSeed, {
      octaves: 2,
      frequency: 1 / 512,
      persistence: 0.5,
    });
  }

  /** Fills a chunk with generated terrain. Overwrites all existing voxels. */
  generate(coord: ChunkCoord): Chunk {
    const chunk = new Chunk(coord);
    const originX = coord.originX;
    const originZ = coord.originZ;

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
      for (let localX = 0; localX < CHUNK_SIZE; localX++) {
        this.generateColumn(chunk, localX, localZ, originX + localX, originZ + localZ);
      }
    }

    this.generateTrees(chunk, originX, originZ);
    chunk.markGenerated();
    return chunk;
  }

  private generateColumn(
    chunk: Chunk,
    localX: number,
    localZ: number,
    worldX: number,
    worldZ: number,
  ): void {
    const height = this.heightAt(worldX, worldZ);
    const temperature = this.temperatureAt(worldX, worldZ);
    const surface = this.surfaceBlockFor(height, temperature);
    const subsurface = surface === BlockId.Sand ? BlockId.Sand : BlockId.Dirt;

    for (let y = 0; y <= BEDROCK_TOP; y++) {
      chunk.setGenerated(localX, y, localZ, BlockId.Bedrock);
    }

    const stoneTop = height - 4;
    for (let y = BEDROCK_TOP + 1; y <= stoneTop; y++) {
      chunk.setGenerated(localX, y, localZ, BlockId.Stone);
    }

    for (let y = Math.max(BEDROCK_TOP + 1, stoneTop + 1); y < height; y++) {
      chunk.setGenerated(localX, y, localZ, subsurface);
    }

    if (height > BEDROCK_TOP) {
      chunk.setGenerated(localX, height, localZ, surface);
    }

    for (let y = height + 1; y <= SEA_LEVEL; y++) {
      chunk.setGenerated(localX, y, localZ, BlockId.Water);
    }
  }

  private surfaceBlockFor(height: number, temperature: number): number {
    // Beaches and shallow shores.
    if (height <= SEA_LEVEL + 1) return BlockId.Sand;
    if (temperature < 0.32 && height > SEA_LEVEL + 26) return BlockId.Snow;
    if (temperature > 0.72 && height < SEA_LEVEL + 12) return BlockId.Sand;
    return BlockId.Grass;
  }

  /**
   * Places trees for every column within the chunk plus a margin. Blocks that
   * fall outside the chunk are simply skipped, and the neighbouring chunk
   * places the same tree from its own pass — giving seamless canopies without
   * any cross-chunk coordination.
   */
  private generateTrees(chunk: Chunk, originX: number, originZ: number): void {
    for (let dz = -TREE_MARGIN; dz < CHUNK_SIZE + TREE_MARGIN; dz++) {
      for (let dx = -TREE_MARGIN; dx < CHUNK_SIZE + TREE_MARGIN; dx++) {
        const worldX = originX + dx;
        const worldZ = originZ + dz;
        if (random2(worldX, worldZ, this.treeSeed) >= TREE_DENSITY) continue;

        const height = this.heightAt(worldX, worldZ);
        if (height <= SEA_LEVEL + 1) continue;

        const temperature = this.temperatureAt(worldX, worldZ);
        if (this.surfaceBlockFor(height, temperature) !== BlockId.Grass) continue;

        const shape = random2(worldX, worldZ, this.treeShapeSeed);
        const trunkHeight = 4 + Math.floor(shape * 3);
        this.placeTree(chunk, dx, height + 1, dz, trunkHeight);
      }
    }
  }

  /** Writes a tree in chunk-local space, clipping anything out of bounds. */
  private placeTree(
    chunk: Chunk,
    localX: number,
    baseY: number,
    localZ: number,
    trunkHeight: number,
  ): void {
    const topY = baseY + trunkHeight;
    if (topY + 2 > WORLD_MAX_Y) return;

    // Canopy first so the trunk is never overwritten by leaves.
    for (let y = topY - 2; y <= topY + 1; y++) {
      const radius = y >= topY ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Trim the corners of the widest rings for a rounder silhouette.
          if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (y === topY + 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
          this.setIfInside(chunk, localX + dx, y, localZ + dz, BlockId.Leaves, false);
        }
      }
    }

    for (let y = baseY; y < topY; y++) {
      this.setIfInside(chunk, localX, y, localZ, BlockId.Log, true);
    }
  }

  private setIfInside(
    chunk: Chunk,
    localX: number,
    y: number,
    localZ: number,
    block: number,
    overwrite: boolean,
  ): void {
    if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) return;
    if (y < 0 || y > WORLD_MAX_Y) return;
    if (!overwrite && chunk.get(localX, y, localZ) !== BlockId.Air) return;
    chunk.setGenerated(localX, y, localZ, block);
  }
}
