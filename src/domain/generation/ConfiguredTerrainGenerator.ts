import { BlockId } from '../world/BlockType';
import type { Chunk } from '../world/Chunk';
import type { ChunkCoord } from '../world/ChunkCoord';
import { CHUNK_SIZE, SEA_LEVEL } from '../world/WorldConstants';
import {
  GeneratorPreset,
  type WorldCreationSettings,
} from '../world/WorldCreationSettings';
import { starterChestPosition } from '../world/StarterChest';
import { hash2 } from './Noise';
import type { ChunkGenerator } from './ChunkGenerator';
import { FlatTerrainGenerator } from './FlatTerrainGenerator';
import { TerrainGenerator } from './TerrainGenerator';

const STRUCTURE_SEED = 0x643c9869;

export interface StructureOrigin {
  readonly x: number;
  readonly z: number;
}

/** One deterministic, deliberately small structure: a five-block ruin. */
export function safeRuinOrigin(seed: number): StructureOrigin {
  const hash = hash2(1, -1, (seed ^ STRUCTURE_SEED) | 0);
  const distanceX = 14 + (hash & 7);
  const distanceZ = 14 + ((hash >>> 3) & 7);
  return Object.freeze({
    x: (hash & 0x40) === 0 ? distanceX : -distanceX,
    z: (hash & 0x80) === 0 ? distanceZ : -distanceZ,
  });
}

/**
 * Pure decorator over the selected base strategy. Structure and starter chest
 * placement are functions of seed/configuration only, so chunk order is
 * irrelevant and persisted edits remain valid after reload.
 */
export class ConfiguredTerrainGenerator implements ChunkGenerator {
  readonly seed: number;

  constructor(
    private readonly base: ChunkGenerator,
    private readonly settings: WorldCreationSettings,
  ) {
    this.seed = base.seed;
  }

  heightAt(worldX: number, worldZ: number): number {
    return this.base.heightAt(worldX, worldZ);
  }

  generate(coord: ChunkCoord): Chunk {
    const chunk = this.base.generate(coord);
    if (this.settings.structures) this.placeSafeRuin(chunk);
    if (this.settings.bonusChest) this.placeStarterChest(chunk);
    return chunk;
  }

  private placeSafeRuin(chunk: Chunk): void {
    const origin = safeRuinOrigin(this.seed);
    let floorY = SEA_LEVEL + 1;
    for (let z = origin.z - 2; z <= origin.z + 2; z++) {
      for (let x = origin.x - 2; x <= origin.x + 2; x++) {
        floorY = Math.max(floorY, this.base.heightAt(x, z) + 1);
      }
    }

    // A flat 5x5 platform plus four short corner pillars is safe to enter and
    // cannot trap the player or require interactive structure blocks.
    for (let z = origin.z - 2; z <= origin.z + 2; z++) {
      for (let x = origin.x - 2; x <= origin.x + 2; x++) {
        this.setWorld(chunk, x, floorY, z, BlockId.Cobblestone);
      }
    }
    for (const [x, z] of [
      [origin.x - 2, origin.z - 2],
      [origin.x + 2, origin.z - 2],
      [origin.x - 2, origin.z + 2],
      [origin.x + 2, origin.z + 2],
    ] as const) {
      this.setWorld(chunk, x, floorY + 1, z, BlockId.Cobblestone);
      this.setWorld(chunk, x, floorY + 2, z, BlockId.Cobblestone);
    }
  }

  private placeStarterChest(chunk: Chunk): void {
    const position = starterChestPosition(this.base, this.seed);
    if (this.base.heightAt(position.x, position.z) + 1 < position.y) {
      this.setWorld(chunk, position.x, position.y - 1, position.z, BlockId.Planks);
    }
    this.setWorld(chunk, position.x, position.y, position.z, BlockId.Chest);
  }

  private setWorld(chunk: Chunk, x: number, y: number, z: number, block: number): void {
    const localX = x - chunk.coord.originX;
    const localZ = z - chunk.coord.originZ;
    if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) return;
    chunk.setGenerated(localX, y, localZ, block);
  }
}

/** Composition-time preset selection. No presentation values reach generation. */
export function createTerrainGenerator(settings: WorldCreationSettings): ChunkGenerator {
  const base: ChunkGenerator =
    settings.generatorPreset === GeneratorPreset.Flat
      ? new FlatTerrainGenerator(settings.seed)
      : new TerrainGenerator(settings.seed);
  return new ConfiguredTerrainGenerator(base, settings);
}
