import { BlockId, BlockRegistry } from './BlockType';
import { Chunk } from './Chunk';
import { ChunkCoord, type ChunkKey } from './ChunkCoord';
import type { VoxelQuery } from './VoxelQuery';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  worldToChunkAxis,
  worldToLocalAxis,
} from './WorldConstants';

/** Reports which chunks a mutation invalidated, including border neighbours. */
export interface BlockChange {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly previous: number;
  readonly next: number;
  readonly affectedChunks: readonly ChunkCoord[];
}

/**
 * Aggregate root over loaded voxel data.
 *
 * Owns chunk lifetime and is the only place block mutations are applied, so
 * every consumer observes a single consistent view.
 */
export class World implements VoxelQuery {
  private readonly chunks = new Map<ChunkKey, Chunk>();

  // Single-entry lookup cache. Collision and raycasting sample many blocks
  // inside one chunk, so this removes almost all map lookups from hot loops.
  private cachedKey: ChunkKey | null = null;
  private cachedChunk: Chunk | null = null;

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  chunkKeys(): IterableIterator<ChunkKey> {
    return this.chunks.keys();
  }

  loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  hasChunk(coord: ChunkCoord): boolean {
    return this.chunks.has(coord.key);
  }

  getChunk(coord: ChunkCoord): Chunk | null {
    return this.chunks.get(coord.key) ?? null;
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunk.coord.key, chunk);
    this.invalidateCache();
  }

  removeChunk(coord: ChunkCoord): Chunk | null {
    const chunk = this.chunks.get(coord.key);
    if (chunk === undefined) return null;
    this.chunks.delete(coord.key);
    this.invalidateCache();
    return chunk;
  }

  clear(): void {
    this.chunks.clear();
    this.invalidateCache();
  }

  /**
   * True when every one of the 8 surrounding chunks is resident.
   *
   * Called for every candidate chunk every frame, so keys are built inline
   * rather than by materialising eight `ChunkCoord` objects per call.
   */
  hasAllNeighbours(coord: ChunkCoord): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (!this.chunks.has(`${coord.cx + dx},${coord.cz + dz}`)) return false;
      }
    }
    return true;
  }

  private chunkAtWorld(worldX: number, worldZ: number): Chunk | null {
    const key = `${worldToChunkAxis(worldX)},${worldToChunkAxis(worldZ)}`;
    if (key === this.cachedKey) return this.cachedChunk;
    const chunk = this.chunks.get(key) ?? null;
    this.cachedKey = key;
    this.cachedChunk = chunk;
    return chunk;
  }

  private invalidateCache(): void {
    this.cachedKey = null;
    this.cachedChunk = null;
  }

  /** Reads a block in world space. Air above/below the world and in gaps. */
  getBlock(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return BlockId.Air;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const chunk = this.chunkAtWorld(bx, bz);
    if (chunk === null) return BlockId.Air;
    return chunk.get(worldToLocalAxis(bx), by, worldToLocalAxis(bz));
  }

  /**
   * Collision probe. Below the world floor and inside unloaded chunks both
   * count as solid, which prevents falling out of the world during streaming.
   */
  isSolidAt(x: number, y: number, z: number): boolean {
    const by = Math.floor(y);
    if (by < WORLD_MIN_Y) return true;
    if (by > WORLD_MAX_Y) return false;

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const chunk = this.chunkAtWorld(bx, bz);
    if (chunk === null) return true;

    return BlockRegistry.isSolid(chunk.get(worldToLocalAxis(bx), by, worldToLocalAxis(bz)));
  }

  /** True when the chunk covering these world coordinates is resident. */
  isLoadedAt(x: number, z: number): boolean {
    return this.chunkAtWorld(Math.floor(x), Math.floor(z)) !== null;
  }

  /**
   * Writes a block in world space.
   *
   * Returns the change (including the chunks whose meshes are now stale) or
   * null when the write was a no-op or landed outside loaded space.
   */
  setBlock(x: number, y: number, z: number, block: number): BlockChange | null {
    const by = Math.floor(y);
    if (by < WORLD_MIN_Y || by > WORLD_MAX_Y) return null;

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const chunk = this.chunkAtWorld(bx, bz);
    if (chunk === null) return null;

    const localX = worldToLocalAxis(bx);
    const localZ = worldToLocalAxis(bz);
    const previous = chunk.get(localX, by, localZ);
    if (previous === block) return null;
    if (!chunk.set(localX, by, localZ, block)) return null;

    return {
      x: bx,
      y: by,
      z: bz,
      previous,
      next: block,
      affectedChunks: this.collectAffectedChunks(chunk.coord, localX, localZ),
    };
  }

  /**
   * A block on a chunk border changes the neighbour's visible faces and the
   * ambient occlusion of its diagonal, so those meshes must be rebuilt too.
   */
  private collectAffectedChunks(
    coord: ChunkCoord,
    localX: number,
    localZ: number,
  ): readonly ChunkCoord[] {
    const affected: ChunkCoord[] = [coord];
    const stepX = localX === 0 ? -1 : localX === CHUNK_SIZE - 1 ? 1 : 0;
    const stepZ = localZ === 0 ? -1 : localZ === CHUNK_SIZE - 1 ? 1 : 0;

    if (stepX !== 0) affected.push(coord.offset(stepX, 0));
    if (stepZ !== 0) affected.push(coord.offset(0, stepZ));
    if (stepX !== 0 && stepZ !== 0) affected.push(coord.offset(stepX, stepZ));

    return affected;
  }

  /**
   * Y of the first air block above the terrain at this column, or null when
   * the chunk is not loaded. Used for spawn placement.
   */
  surfaceHeightAt(x: number, z: number): number | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const chunk = this.chunkAtWorld(bx, bz);
    if (chunk === null) return null;

    const localX = worldToLocalAxis(bx);
    const localZ = worldToLocalAxis(bz);
    for (let y = CHUNK_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
      if (BlockRegistry.isSolid(chunk.get(localX, y, localZ))) return y + 1;
    }
    return WORLD_MIN_Y;
  }
}
