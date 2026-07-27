import { BlockId } from '../world/BlockType';
import { fbm3 } from './Noise';

const SEED_CAVE_A = 0x51f0a37d;
const SEED_CAVE_B = 0x2b8e64c1;
const SEED_ORE = 0x6ac1f39b;

/** Lowest carvable level. Below this the bedrock cap and its margin stay whole. */
export const CAVE_FLOOR = 4;

/**
 * Blocks of untouched stone kept beneath the surface.
 *
 * Without a roof this thick, tunnels break through hillsides and the reported
 * surface height stops matching the terrain that was generated — which spawn
 * placement, mob spawning and the rain sampler all depend on.
 */
export const CAVE_ROOF = 5;

/** Frequency of the two intersecting cave fields, in blocks per cycle. */
const CAVE_SCALE = 1 / 46;

/**
 * Half-width of the band each field must fall inside.
 *
 * Two independent iso-surfaces intersect along a curve, so requiring both to be
 * near their mid-value carves winding tunnels rather than the disconnected
 * bubbles a single threshold produces.
 */
const CAVE_BAND = 0.052;

interface OreSpec {
  readonly block: BlockId;
  readonly minY: number;
  readonly maxY: number;
  /** Vein field frequency; lower spreads each vein over more blocks. */
  readonly scale: number;
  /** Field value a voxel must exceed to become ore. */
  readonly threshold: number;
  readonly seed: number;
}

/**
 * Ore distribution, richest and most common at the top.
 *
 * Depth bands are what make descending worthwhile, and what make the pickaxe
 * tiers land in the order the player can actually craft them.
 */
const ORES: readonly OreSpec[] = Object.freeze([
  Object.freeze({
    block: BlockId.CoalOre,
    minY: 6,
    maxY: 124,
    scale: 1 / 9,
    threshold: 0.9,
    seed: (SEED_ORE ^ 0x11) | 0,
  }),
  Object.freeze({
    block: BlockId.IronOre,
    minY: 5,
    maxY: 66,
    scale: 1 / 7,
    threshold: 0.9,
    seed: (SEED_ORE ^ 0x22) | 0,
  }),
  Object.freeze({
    block: BlockId.GoldOre,
    minY: 5,
    maxY: 33,
    scale: 1 / 6,
    threshold: 0.93,
    seed: (SEED_ORE ^ 0x33) | 0,
  }),
  Object.freeze({
    block: BlockId.DiamondOre,
    minY: 5,
    maxY: 17,
    scale: 1 / 5,
    threshold: 0.938,
    seed: (SEED_ORE ^ 0x44) | 0,
  }),
]);

/**
 * Underground decoration for one generator seed.
 *
 * Pure and stateless like the heightfield above it: every voxel is a function
 * of its coordinate and the seed, so chunks stay independently generatable and
 * saves keep storing only the player's own edits.
 */
export class Underground {
  private readonly caveSeedA: number;
  private readonly caveSeedB: number;
  private readonly oreSeed: number;

  constructor(seed: number) {
    this.caveSeedA = (seed ^ SEED_CAVE_A) | 0;
    this.caveSeedB = (seed ^ SEED_CAVE_B) | 0;
    this.oreSeed = (seed ^ SEED_ORE) | 0;
  }

  /**
   * True where a tunnel passes through this voxel.
   *
   * `surfaceHeight` bounds the carve from above so the terrain the heightfield
   * promised is never breached from below.
   */
  isCave(x: number, y: number, z: number, surfaceHeight: number): boolean {
    if (y < CAVE_FLOOR || y > surfaceHeight - CAVE_ROOF) return false;

    const a = fbm3(x, y * 1.7, z, this.caveSeedA, {
      octaves: 2,
      frequency: CAVE_SCALE,
      persistence: 0.5,
    });
    if (Math.abs(a - 0.5) > CAVE_BAND) return false;

    const b = fbm3(x, y * 1.7, z, this.caveSeedB, {
      octaves: 2,
      frequency: CAVE_SCALE,
      persistence: 0.5,
    });
    return Math.abs(b - 0.5) <= CAVE_BAND;
  }

  /**
   * The ore filling this voxel, or null for plain stone.
   *
   * Specs are tested from the deepest band up, so a diamond-depth voxel is not
   * claimed by the coal field that also covers it.
   */
  oreAt(x: number, y: number, z: number): BlockId | null {
    for (let index = ORES.length - 1; index >= 0; index--) {
      const spec = ORES[index];
      if (y < spec.minY || y > spec.maxY) continue;

      const field = fbm3(x, y, z, (this.oreSeed ^ spec.seed) | 0, {
        octaves: 1,
        frequency: spec.scale,
      });
      if (field > spec.threshold) return spec.block;
    }
    return null;
  }
}
