import type { ChunkCoord } from '@domain/world/ChunkCoord';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '@domain/world/WorldConstants';

/**
 * Layout of the volume handed to a mesher: the chunk plus a one-block skirt of
 * its horizontal neighbours. The skirt supplies everything needed to cull
 * border faces and compute ambient occlusion, so a mesher never needs access
 * to the world and can run in a worker.
 */
export const PADDED_SIZE = CHUNK_SIZE + 2;
export const PADDED_VOLUME = PADDED_SIZE * CHUNK_HEIGHT * PADDED_SIZE;

export function paddedIndex(px: number, y: number, pz: number): number {
  return (y * PADDED_SIZE + pz) * PADDED_SIZE + px;
}

/**
 * Interleaved-free geometry buffers for one draw call.
 *
 * Positions are chunk-local; the renderer positions the mesh via its transform
 * so vertex data stays small and precision-safe far from the origin.
 */
export interface MeshGeometry {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  /** Texture array layer per vertex. */
  readonly layers: Float32Array;
  /** Baked ambient occlusion multiplied by face shading, per vertex. */
  readonly lights: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

export interface ChunkMeshData {
  /** Fully opaque geometry, rendered first with depth writes. */
  readonly opaque: MeshGeometry | null;
  /** Alpha-blended geometry (water, glass), rendered after the opaque pass. */
  readonly transparent: MeshGeometry | null;
}

export interface MeshRequest {
  readonly coord: ChunkCoord;
  /** Revision of the source chunk, echoed back so stale results are discarded. */
  readonly revision: number;
  /**
   * Voxels of the chunk padded by one block on X and Z, so the mesher can cull
   * border faces and compute ambient occlusion without extra lookups.
   */
  readonly paddedVolume: Uint8Array;
}

export interface MeshResponse {
  readonly coord: ChunkCoord;
  readonly revision: number;
  readonly data: ChunkMeshData;
}

/**
 * Turns voxels into renderable geometry. Implementations may run off the main
 * thread; callers must tolerate results arriving out of order.
 */
export interface ChunkMesher {
  /** Number of requests that may be in flight before throughput degrades. */
  readonly capacity: number;
  submit(request: MeshRequest): Promise<MeshResponse>;
  dispose(): void;
}
