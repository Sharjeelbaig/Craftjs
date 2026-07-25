import type { Vec3Like } from '../shared/Vec3';

/** Axis-aligned box described by its minimum corner and its size. */
export interface AABB {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * Builds the collision box for an entity standing at `position`, where
 * position is the centre of the entity's footprint at its feet.
 */
export function boxAtFeet(position: Vec3Like, width: number, height: number): AABB {
  const half = width / 2;
  return {
    minX: position.x - half,
    minY: position.y,
    minZ: position.z - half,
    maxX: position.x + half,
    maxY: position.y + height,
    maxZ: position.z + half,
  };
}

/** Box covering a single voxel cell. */
export function boxOfVoxel(x: number, y: number, z: number): AABB {
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
}

export function boxesOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

export function expandBox(box: AABB, amount: number): AABB {
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    minZ: box.minZ - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
    maxZ: box.maxZ + amount,
  };
}
