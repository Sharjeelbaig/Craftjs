/**
 * Invariants of the voxel space. Every other module derives its layout from
 * these values — never hard-code the numbers elsewhere.
 */

/** Horizontal edge length of a chunk, in blocks. */
export const CHUNK_SIZE = 16;

/** Vertical extent of the world, in blocks. Chunks are full-height columns. */
export const CHUNK_HEIGHT = 128;

export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;

/** Inclusive vertical bounds a block may occupy. */
export const WORLD_MIN_Y = 0;
export const WORLD_MAX_Y = CHUNK_HEIGHT - 1;

/** Height at and below which open air is filled with water. */
export const SEA_LEVEL = 46;

/**
 * Converts local chunk coordinates to a flat voxel index.
 *
 * Layout is Y-major so that vertical column scans (terrain generation,
 * height queries) walk contiguous-ish memory.
 */
export function voxelIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

/** True when the coordinates address a voxel inside a chunk's local space. */
export function isLocalCoordinate(x: number, y: number, z: number): boolean {
  return (
    x >= 0 &&
    x < CHUNK_SIZE &&
    z >= 0 &&
    z < CHUNK_SIZE &&
    y >= 0 &&
    y < CHUNK_HEIGHT
  );
}

/** Floor-divides a world axis value into its chunk index. */
export function worldToChunkAxis(worldValue: number): number {
  return Math.floor(worldValue / CHUNK_SIZE);
}

/** Positive modulo — maps a world axis value into local chunk space. */
export function worldToLocalAxis(worldValue: number): number {
  return ((worldValue % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}
