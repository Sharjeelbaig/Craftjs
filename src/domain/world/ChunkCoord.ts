import { CHUNK_SIZE, worldToChunkAxis } from './WorldConstants';

/** Stable identity for a chunk within the world grid. */
export type ChunkKey = string;

export function chunkKeyOf(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

/**
 * Upper bound on the instance cache. Comfortably larger than any live
 * streaming window, so in practice every lookup during play is a hit.
 */
const CACHE_LIMIT = 1 << 16;

/**
 * Value object addressing one chunk column.
 *
 * Instances are cached by key because `offset` is called thousands of times a
 * frame during streaming, and allocating there would create real GC pressure.
 * The cache is a performance detail, not an identity guarantee: it is dropped
 * once it grows past `CACHE_LIMIT`, which is what keeps memory flat over a
 * long session in an unbounded world. Always compare coordinates by `key`.
 */
export class ChunkCoord {
  private static cache = new Map<ChunkKey, ChunkCoord>();

  readonly cx: number;
  readonly cz: number;
  readonly key: ChunkKey;

  private constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKeyOf(cx, cz);
    Object.freeze(this);
  }

  static of(cx: number, cz: number): ChunkCoord {
    const key = chunkKeyOf(cx, cz);
    const existing = ChunkCoord.cache.get(key);
    if (existing !== undefined) return existing;

    // Travelling far enough would otherwise retain a coordinate for every
    // chunk ever visited.
    if (ChunkCoord.cache.size >= CACHE_LIMIT) ChunkCoord.cache = new Map();

    const created = new ChunkCoord(cx, cz);
    ChunkCoord.cache.set(key, created);
    return created;
  }

  static fromWorld(worldX: number, worldZ: number): ChunkCoord {
    return ChunkCoord.of(worldToChunkAxis(worldX), worldToChunkAxis(worldZ));
  }

  static parse(key: ChunkKey): ChunkCoord | null {
    const comma = key.indexOf(',');
    if (comma <= 0) return null;
    const cx = Number.parseInt(key.slice(0, comma), 10);
    const cz = Number.parseInt(key.slice(comma + 1), 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
    return ChunkCoord.of(cx, cz);
  }

  /** World-space X of this chunk's local origin. */
  get originX(): number {
    return this.cx * CHUNK_SIZE;
  }

  /** World-space Z of this chunk's local origin. */
  get originZ(): number {
    return this.cz * CHUNK_SIZE;
  }

  offset(dx: number, dz: number): ChunkCoord {
    return ChunkCoord.of(this.cx + dx, this.cz + dz);
  }

  /** Chebyshev distance in chunks — matches the square streaming region. */
  chebyshevDistanceTo(other: ChunkCoord): number {
    return Math.max(Math.abs(this.cx - other.cx), Math.abs(this.cz - other.cz));
  }

  toString(): string {
    return this.key;
  }
}

/** The 8 surrounding chunks, required before a chunk can be meshed. */
export const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]);
