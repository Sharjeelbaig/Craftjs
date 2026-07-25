import type { VoxelQuery } from '../world/VoxelQuery';
import type { Vec3Like } from '../shared/Vec3';
import { type AABB, boxAtFeet } from './AABB';

/**
 * Gap left between the entity and a blocking surface. Large enough to survive
 * float rounding, small enough to be invisible.
 */
const SKIN = 1e-3;

/**
 * Maximum distance resolved in one pass. Keeping each pass under one block
 * guarantees a moving box can never tunnel through geometry, no matter how
 * large the requested delta or how long a frame stalls.
 */
const MAX_STEP = 0.4;

export interface EntitySize {
  readonly width: number;
  readonly height: number;
}

export interface MoveResult {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hitX: boolean;
  readonly hitY: boolean;
  readonly hitZ: boolean;
  /** True when the entity is resting on a solid surface. */
  readonly onGround: boolean;
}

/** Voxel span covered by a box on one axis, as inclusive integer bounds. */
function spanMin(low: number): number {
  return Math.floor(low);
}

function spanMax(high: number): number {
  // A box whose face lies exactly on a boundary does not enter the next cell.
  return Math.ceil(high) - 1;
}

function translate(box: AABB, dx: number, dy: number, dz: number): AABB {
  return {
    minX: box.minX + dx,
    minY: box.minY + dy,
    minZ: box.minZ + dz,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
    maxZ: box.maxZ + dz,
  };
}

function sweepX(query: VoxelQuery, box: AABB, delta: number): number {
  if (delta === 0) return 0;
  const y0 = spanMin(box.minY);
  const y1 = spanMax(box.maxY);
  const z0 = spanMin(box.minZ);
  const z1 = spanMax(box.maxZ);

  if (delta > 0) {
    const from = Math.floor(box.maxX);
    const to = Math.floor(box.maxX + delta);
    for (let x = from + 1; x <= to; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (query.isSolidAt(x, y, z)) return Math.max(0, x - box.maxX - SKIN);
        }
      }
    }
  } else {
    const from = Math.floor(box.minX);
    const to = Math.floor(box.minX + delta);
    for (let x = from - 1; x >= to; x--) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (query.isSolidAt(x, y, z)) return Math.min(0, x + 1 - box.minX + SKIN);
        }
      }
    }
  }
  return delta;
}

function sweepY(query: VoxelQuery, box: AABB, delta: number): number {
  if (delta === 0) return 0;
  const x0 = spanMin(box.minX);
  const x1 = spanMax(box.maxX);
  const z0 = spanMin(box.minZ);
  const z1 = spanMax(box.maxZ);

  if (delta > 0) {
    const from = Math.floor(box.maxY);
    const to = Math.floor(box.maxY + delta);
    for (let y = from + 1; y <= to; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          if (query.isSolidAt(x, y, z)) return Math.max(0, y - box.maxY - SKIN);
        }
      }
    }
  } else {
    const from = Math.floor(box.minY);
    const to = Math.floor(box.minY + delta);
    for (let y = from - 1; y >= to; y--) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          if (query.isSolidAt(x, y, z)) return Math.min(0, y + 1 - box.minY + SKIN);
        }
      }
    }
  }
  return delta;
}

function sweepZ(query: VoxelQuery, box: AABB, delta: number): number {
  if (delta === 0) return 0;
  const x0 = spanMin(box.minX);
  const x1 = spanMax(box.maxX);
  const y0 = spanMin(box.minY);
  const y1 = spanMax(box.maxY);

  if (delta > 0) {
    const from = Math.floor(box.maxZ);
    const to = Math.floor(box.maxZ + delta);
    for (let z = from + 1; z <= to; z++) {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (query.isSolidAt(x, y, z)) return Math.max(0, z - box.maxZ - SKIN);
        }
      }
    }
  } else {
    const from = Math.floor(box.minZ);
    const to = Math.floor(box.minZ + delta);
    for (let z = from - 1; z >= to; z--) {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (query.isSolidAt(x, y, z)) return Math.min(0, z + 1 - box.minZ + SKIN);
        }
      }
    }
  }
  return delta;
}

/**
 * Moves an entity through voxel space, sliding along whatever it hits.
 *
 * Axes are resolved independently so contact with one surface never cancels
 * motion along the others — that is what makes walls slideable and prevents
 * the entity sticking in corners. Long moves are sub-stepped, so behaviour is
 * identical whether the caller passes one large delta or many small ones.
 */
export function moveEntity(
  query: VoxelQuery,
  position: Vec3Like,
  size: EntitySize,
  deltaX: number,
  deltaY: number,
  deltaZ: number,
): MoveResult {
  let x = position.x;
  let y = position.y;
  let z = position.z;

  let hitX = false;
  let hitY = false;
  let hitZ = false;
  let onGround = false;

  const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
  const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
  const stepX = deltaX / steps;
  const stepY = deltaY / steps;
  const stepZ = deltaZ / steps;

  for (let step = 0; step < steps; step++) {
    let box = boxAtFeet({ x, y, z }, size.width, size.height);

    const movedX = sweepX(query, box, stepX);
    if (movedX !== stepX) hitX = true;
    x += movedX;
    box = translate(box, movedX, 0, 0);

    const movedZ = sweepZ(query, box, stepZ);
    if (movedZ !== stepZ) hitZ = true;
    z += movedZ;
    box = translate(box, 0, 0, movedZ);

    const movedY = sweepY(query, box, stepY);
    if (movedY !== stepY) {
      hitY = true;
      if (stepY < 0) onGround = true;
    }
    y += movedY;
  }

  return { x, y, z, hitX, hitY, hitZ, onGround };
}

/**
 * Ground probe used when the entity has no vertical motion (e.g. standing
 * still), where `moveEntity` would report no contact.
 */
export function isStandingOnGround(
  query: VoxelQuery,
  position: Vec3Like,
  size: EntitySize,
): boolean {
  const box = boxAtFeet(position, size.width, size.height);
  const probeY = Math.floor(box.minY - SKIN * 2);
  const x0 = spanMin(box.minX);
  const x1 = spanMax(box.maxX);
  const z0 = spanMin(box.minZ);
  const z1 = spanMax(box.maxZ);

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (query.isSolidAt(x, probeY, z)) return true;
    }
  }
  return false;
}

/** True when any solid voxel overlaps the entity's box at this position. */
export function isPositionObstructed(
  query: VoxelQuery,
  position: Vec3Like,
  size: EntitySize,
): boolean {
  const box = boxAtFeet(position, size.width, size.height);
  for (let x = spanMin(box.minX); x <= spanMax(box.maxX); x++) {
    for (let y = spanMin(box.minY); y <= spanMax(box.maxY); y++) {
      for (let z = spanMin(box.minZ); z <= spanMax(box.maxZ); z++) {
        if (query.isSolidAt(x, y, z)) return true;
      }
    }
  }
  return false;
}
