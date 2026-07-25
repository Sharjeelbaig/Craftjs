import type { Vec3Like } from '../shared/Vec3';
import { BlockId } from '../world/BlockType';
import type { VoxelQuery } from '../world/VoxelQuery';

export interface RaycastHit {
  /** Voxel the ray entered. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Block id at the hit voxel. */
  readonly block: number;
  /** Face normal of the entered voxel; the adjacent empty cell is hit + normal. */
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  /** Distance from the ray origin to the entry point. */
  readonly distance: number;
}

/** Decides whether a block stops the ray. */
export type BlockPredicate = (block: number) => boolean;

const stopsAtNonAir: BlockPredicate = (block) => block !== BlockId.Air;

/**
 * Amanatides & Woo voxel traversal.
 *
 * Visits every cell the ray passes through in order, with no sampling gaps —
 * unlike stepped ray marching, it can never skip a thin wall or miss a block
 * clipped at a grazing angle, which is what makes block targeting exact.
 */
export function raycastVoxels(
  query: VoxelQuery,
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
  stopsAt: BlockPredicate = stopsAtNonAir,
): RaycastHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9 || maxDistance <= 0) return null;

  const dirX = direction.x / length;
  const dirY = direction.y / length;
  const dirZ = direction.z / length;

  let voxelX = Math.floor(origin.x);
  let voxelY = Math.floor(origin.y);
  let voxelZ = Math.floor(origin.z);

  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;

  // Distance along the ray between successive crossings of each axis' planes.
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaY = stepY === 0 ? Infinity : Math.abs(1 / dirY);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dirZ);

  // Distance to the first crossing on each axis.
  let maxX = stepX === 0 ? Infinity : boundaryDistance(origin.x, dirX, deltaX);
  let maxY = stepY === 0 ? Infinity : boundaryDistance(origin.y, dirY, deltaY);
  let maxZ = stepZ === 0 ? Infinity : boundaryDistance(origin.z, dirZ, deltaZ);

  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let distance = 0;

  // The origin cell itself is a valid hit (e.g. standing inside a block).
  const originBlock = query.getBlock(voxelX, voxelY, voxelZ);
  if (stopsAt(originBlock)) {
    return {
      x: voxelX,
      y: voxelY,
      z: voxelZ,
      block: originBlock,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
      distance: 0,
    };
  }

  while (distance <= maxDistance) {
    if (maxX <= maxY && maxX <= maxZ) {
      voxelX += stepX;
      distance = maxX;
      maxX += deltaX;
      normalX = -stepX;
      normalY = 0;
      normalZ = 0;
    } else if (maxY <= maxZ) {
      voxelY += stepY;
      distance = maxY;
      maxY += deltaY;
      normalX = 0;
      normalY = -stepY;
      normalZ = 0;
    } else {
      voxelZ += stepZ;
      distance = maxZ;
      maxZ += deltaZ;
      normalX = 0;
      normalY = 0;
      normalZ = -stepZ;
    }

    if (distance > maxDistance) return null;

    const block = query.getBlock(voxelX, voxelY, voxelZ);
    if (stopsAt(block)) {
      return { x: voxelX, y: voxelY, z: voxelZ, block, normalX, normalY, normalZ, distance };
    }
  }

  return null;
}

/** Ray distance from `position` to the next integer boundary along `dir`. */
function boundaryDistance(position: number, dir: number, delta: number): number {
  const cell = Math.floor(position);
  const fraction = dir > 0 ? cell + 1 - position : position - cell;
  return fraction * delta;
}
