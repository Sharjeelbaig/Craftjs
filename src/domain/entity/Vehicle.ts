import { BlockId, BlockRegistry } from '../world/BlockType';
import type { VoxelQuery } from '../world/VoxelQuery';
import type { PlayerIntent } from '../player/PlayerIntent';
import type { EntityDefinition } from './EntityType';
import type { Mob } from './Mob';

/**
 * How a ridden entity turns rider input into motion.
 *
 * Kept pure and separate from the creature brains: a vehicle has no opinions of
 * its own, so mixing this into `MobBrain` would mean every wander and hunt
 * branch had to first ask whether it was being driven.
 */

/** Rail directions, chosen by which neighbours also carry rail. */
export const RailAxis = {
  /** Runs along Z. Also the fallback for an isolated piece of track. */
  NorthSouth: 'northSouth',
  /** Runs along X. */
  EastWest: 'eastWest',
} as const;

export type RailAxis = (typeof RailAxis)[keyof typeof RailAxis];

/** Rate a minecart loses speed to friction, per second. */
const CART_DRAG = 1.6;

/** Speed below which a coasting cart is treated as stopped. */
const CART_STOP_SPEED = 0.12;

/** How sharply a cart is pulled back to the centre line of its track. */
const CART_CENTERING = 9;

export interface VehicleOutput {
  readonly desiredVelocityX: number;
  readonly desiredVelocityZ: number;
  readonly jump: boolean;
}

/**
 * The rail axis at a cell, or null when there is no rail there.
 *
 * A straight run is inferred from its neighbours rather than stored per block,
 * so laying track needs no orientation state in the save and a player can join
 * two lines simply by filling the gap.
 */
export function railAxisAt(world: VoxelQuery, x: number, y: number, z: number): RailAxis | null {
  if (world.getBlock(x, y, z) !== BlockId.Rail) return null;

  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);

  const eastWest =
    hasRail(world, bx - 1, by, bz) || hasRail(world, bx + 1, by, bz);
  const northSouth =
    hasRail(world, bx, by, bz - 1) || hasRail(world, bx, by, bz + 1);

  // A junction and a lone piece both default to north-south, matching how the
  // original lays the first rail you place.
  if (eastWest && !northSouth) return RailAxis.EastWest;
  return RailAxis.NorthSouth;
}

/** Rail present at a cell, including one step down so slopes still connect. */
function hasRail(world: VoxelQuery, x: number, y: number, z: number): boolean {
  return (
    world.getBlock(x, y, z) === BlockId.Rail || world.getBlock(x, y - 1, z) === BlockId.Rail
  );
}

/**
 * Drives a walking mount — a horse — from rider intent.
 *
 * Steering is taken from where the rider is looking rather than the mount's own
 * facing, so the animal goes where the camera points instead of needing to be
 * turned first.
 */
export function steerMount(
  mob: Mob,
  definition: EntityDefinition,
  intent: PlayerIntent,
  riderYaw: number,
): VehicleOutput {
  const forwardX = -Math.sin(riderYaw);
  const forwardZ = -Math.cos(riderYaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;

  let x = forwardX * intent.moveForward + rightX * intent.moveRight;
  let z = forwardZ * intent.moveForward + rightZ * intent.moveRight;

  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }

  const speed = definition.rideSpeed * (intent.sprint ? 1.15 : 1);
  // The mount faces its travel direction; standing still keeps the last facing
  // rather than snapping to north.
  if (length > 1e-4) mob.targetYaw = Math.atan2(-x, -z);

  return {
    desiredVelocityX: x * speed,
    desiredVelocityZ: z * speed,
    jump: intent.up,
  };
}

export interface RailDriveResult extends VehicleOutput {
  /** True while the cart is actually on track. */
  readonly onRail: boolean;
  /** Signed speed along the rail axis after this tick. */
  readonly railSpeed: number;
}

/**
 * Drives a minecart along its track.
 *
 * Motion is one-dimensional: the rider adds or removes speed along the rail
 * axis and the cart is pulled back to the centre line of the cell. Letting the
 * cart move freely in two axes and relying on collision instead would have it
 * grinding along the sides of the tunnel it is supposed to be running down.
 */
export function driveRailCart(
  mob: Mob,
  definition: EntityDefinition,
  intent: PlayerIntent,
  riderYaw: number,
  railSpeed: number,
  dt: number,
  world: VoxelQuery,
): RailDriveResult {
  const axis = railAxisAt(world, mob.x, mob.y, mob.z);
  if (axis === null) {
    // Off the rails the cart is just a box: it keeps no stored momentum, so it
    // cannot creep across open ground.
    return { desiredVelocityX: 0, desiredVelocityZ: 0, jump: false, onRail: false, railSpeed: 0 };
  }

  const alongX = axis === RailAxis.EastWest ? 1 : 0;
  const alongZ = axis === RailAxis.NorthSouth ? 1 : 0;

  // Which way along the track "forward" is depends on where the rider looks.
  const lookAlong = alongX * -Math.sin(riderYaw) + alongZ * -Math.cos(riderYaw);
  const facing = lookAlong >= 0 ? 1 : -1;

  let speed = railSpeed;
  if (intent.moveForward !== 0) {
    const target = definition.rideSpeed * facing * Math.sign(intent.moveForward);
    speed += (target - speed) * Math.min(1, 6 * dt);
  } else {
    speed -= speed * Math.min(1, CART_DRAG * dt);
    if (Math.abs(speed) < CART_STOP_SPEED) speed = 0;
  }

  // Pull back toward the middle of the track, on whichever axis the rail does
  // not run along.
  const centring =
    alongX === 1
      ? (Math.floor(mob.z) + 0.5 - mob.z) * CART_CENTERING
      : (Math.floor(mob.x) + 0.5 - mob.x) * CART_CENTERING;

  return {
    desiredVelocityX: alongX === 1 ? speed : centring,
    desiredVelocityZ: alongZ === 1 ? speed : centring,
    jump: false,
    onRail: true,
    railSpeed: speed,
  };
}

/** True when a cell can hold a minecart: rail, with room above it. */
export function canPlaceCart(world: VoxelQuery, x: number, y: number, z: number): boolean {
  if (world.getBlock(x, y, z) !== BlockId.Rail) return false;
  return !BlockRegistry.isSolid(world.getBlock(x, y + 1, z));
}
