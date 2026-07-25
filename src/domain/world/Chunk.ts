import { BlockId } from './BlockType';
import type { ChunkCoord } from './ChunkCoord';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  isLocalCoordinate,
  voxelIndex,
} from './WorldConstants';

/**
 * Player edits stored as a sparse index -> block map.
 *
 * Only the delta from generated terrain is persisted, which keeps save size
 * proportional to what the player actually built rather than to world size.
 */
export interface ChunkEdits {
  readonly indices: Uint16Array;
  readonly blocks: Uint8Array;
}

/**
 * A full-height column of voxels.
 *
 * `revision` increments on every mutation and is the sole cache key used to
 * decide whether a mesh is stale; consumers never diff voxel arrays.
 */
export class Chunk {
  readonly coord: ChunkCoord;

  private readonly voxels: Uint8Array;
  private readonly edits = new Map<number, number>();
  private _revision = 0;
  private _hasUnsavedEdits = false;

  constructor(coord: ChunkCoord, voxels?: Uint8Array) {
    if (voxels !== undefined && voxels.length !== CHUNK_VOLUME) {
      throw new RangeError(
        `Chunk ${coord.key}: expected ${CHUNK_VOLUME} voxels, received ${voxels.length}`,
      );
    }
    this.coord = coord;
    this.voxels = voxels ?? new Uint8Array(CHUNK_VOLUME);
  }

  /** Bumped on every content change; used to invalidate meshes. */
  get revision(): number {
    return this._revision;
  }

  /** True when this chunk holds edits that are not yet in the repository. */
  get hasUnsavedEdits(): boolean {
    return this._hasUnsavedEdits;
  }

  get hasEdits(): boolean {
    return this.edits.size > 0;
  }

  /** Direct read access for bulk operations (meshing, generation). */
  get data(): Uint8Array {
    return this.voxels;
  }

  /** Reads a voxel in local space; out-of-range coordinates read as air. */
  get(x: number, y: number, z: number): number {
    if (!isLocalCoordinate(x, y, z)) return BlockId.Air;
    return this.voxels[voxelIndex(x, y, z)];
  }

  /**
   * Writes a voxel in local space and records it as a player edit.
   * Returns true when the value actually changed.
   */
  set(x: number, y: number, z: number, block: number): boolean {
    if (!isLocalCoordinate(x, y, z)) return false;
    const index = voxelIndex(x, y, z);
    if (this.voxels[index] === block) return false;

    this.voxels[index] = block;
    this.edits.set(index, block);
    this._revision++;
    this._hasUnsavedEdits = true;
    return true;
  }

  /**
   * Writes a voxel without recording an edit. Used by terrain generation,
   * which must not pollute the persisted delta.
   */
  setGenerated(x: number, y: number, z: number, block: number): void {
    if (!isLocalCoordinate(x, y, z)) return;
    this.voxels[voxelIndex(x, y, z)] = block;
  }

  /** Marks the chunk dirty after a bulk generation pass. */
  markGenerated(): void {
    this._revision++;
  }

  /** Re-applies a persisted delta on top of freshly generated terrain. */
  applyEdits(edits: ChunkEdits): void {
    const count = Math.min(edits.indices.length, edits.blocks.length);
    for (let i = 0; i < count; i++) {
      const index = edits.indices[i];
      if (index >= CHUNK_VOLUME) continue;
      const block = edits.blocks[i];
      this.voxels[index] = block;
      this.edits.set(index, block);
    }
    if (count > 0) this._revision++;
  }

  /** Snapshots the edit delta for persistence, or null when nothing changed. */
  snapshotEdits(): ChunkEdits | null {
    if (this.edits.size === 0) return null;
    const indices = new Uint16Array(this.edits.size);
    const blocks = new Uint8Array(this.edits.size);
    let i = 0;
    for (const [index, block] of this.edits) {
      indices[i] = index;
      blocks[i] = block;
      i++;
    }
    return { indices, blocks };
  }

  /** Called once a snapshot has been durably written. */
  markSaved(): void {
    this._hasUnsavedEdits = false;
  }

  /**
   * Highest non-air block in a column, or -1 when the column is empty.
   * Scans downward so surface queries terminate quickly.
   */
  highestBlockAt(x: number, z: number): number {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (this.voxels[voxelIndex(x, y, z)] !== BlockId.Air) return y;
    }
    return -1;
  }
}
