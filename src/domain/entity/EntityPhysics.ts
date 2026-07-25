import { BlockRegistry } from '../world/BlockType';
import type { VoxelQuery } from '../world/VoxelQuery';
import {
  isPositionObstructed,
  isStandingOnGround,
  moveEntity,
  type EntitySize,
} from '../physics/CollisionResolver';
import type { PhysicsBody } from './Mob';

export const GRAVITY = 28;
export const TERMINAL_VELOCITY = -58;
const LIQUID_GRAVITY = 7;
const LIQUID_DRAG = 4.2;
const LIQUID_FLOAT_SPEED = 1.4;

/** Ground friction; higher stops a creature more sharply. */
const GROUND_DAMPING = 12;
const AIR_DAMPING = 1.5;

/** Small forward probe used to decide whether a step-up is worth trying. */
const STEP_PROBE = 1e-3;

export interface BodyStepResult {
  /** True when the body ended the tick supported by a surface. */
  readonly onGround: boolean;
  /** Blocked horizontally even after attempting a step-up. */
  readonly blocked: boolean;
  /** Distance fallen when the body landed this tick; 0 otherwise. */
  readonly landedFallDistance: number;
}

export interface BodyStepOptions {
  readonly size: EntitySize;
  /** Desired horizontal velocity, in blocks per second. */
  readonly desiredVelocityX: number;
  readonly desiredVelocityZ: number;
  /** Height the body can climb unaided. */
  readonly stepHeight: number;
  /** Requests an upward impulse when grounded or floating. */
  readonly jump: boolean;
  readonly jumpVelocity: number;
}

/**
 * Replaces any non-finite value with a safe default.
 *
 * A single NaN in a position or velocity is unrecoverable: it propagates
 * through collision into every subsequent tick, and the body vanishes from
 * the world with no way back. Clamping here contains the damage to one tick.
 */
function sanitise(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Advances one body through the world: gravity, drag, collision and step-up.
 *
 * Shared by creatures and, through the same collision routine, the player, so
 * everything in the world obeys the same rules.
 */
export function stepBody(
  body: PhysicsBody,
  world: VoxelQuery,
  options: BodyStepOptions,
  dt: number,
): BodyStepResult {
  if (dt <= 0 || !Number.isFinite(dt)) {
    return { onGround: body.onGround, blocked: false, landedFallDistance: 0 };
  }

  body.x = sanitise(body.x);
  body.y = sanitise(body.y);
  body.z = sanitise(body.z);
  body.velocityX = sanitise(body.velocityX);
  body.velocityY = sanitise(body.velocityY);
  body.velocityZ = sanitise(body.velocityZ);

  const wasOnGround = body.onGround;
  body.inLiquid = BlockRegistry.isLiquid(
    world.getBlock(Math.floor(body.x), Math.floor(body.y + 0.4), Math.floor(body.z)),
  );

  applyHorizontal(body, options, dt);
  applyVertical(body, options, dt);

  const startY = body.y;
  const result = moveWithStepUp(body, world, options, dt);

  body.x = result.x;
  body.y = result.y;
  body.z = result.z;

  if (result.hitX) body.velocityX = 0;
  if (result.hitZ) body.velocityZ = 0;
  if (result.hitY) body.velocityY = 0;

  const onGround = result.onGround || isStandingOnGround(world, body, options.size);
  body.onGround = onGround;

  // Fall distance is measured from actual descent, so a creature riding a
  // moving surface or swimming does not accumulate phantom damage.
  let landedFallDistance = 0;
  if (!wasOnGround && onGround) {
    landedFallDistance = Math.max(0, startY - body.y);
  }

  return { onGround, blocked: result.hitX || result.hitZ, landedFallDistance };
}

function applyHorizontal(body: PhysicsBody, options: BodyStepOptions, dt: number): void {
  const wantsMove =
    options.desiredVelocityX !== 0 || options.desiredVelocityZ !== 0;

  if (wantsMove) {
    // Steering is direct rather than force-based: creature movement reads as
    // intent, and there is no drift to fight when the brain changes its mind.
    const responsiveness = body.onGround ? 14 : 3;
    const blend = 1 - Math.exp(-responsiveness * dt);
    body.velocityX += (options.desiredVelocityX - body.velocityX) * blend;
    body.velocityZ += (options.desiredVelocityZ - body.velocityZ) * blend;
    return;
  }

  const damping = 1 - Math.exp(-(body.onGround ? GROUND_DAMPING : AIR_DAMPING) * dt);
  body.velocityX -= body.velocityX * damping;
  body.velocityZ -= body.velocityZ * damping;
}

function applyVertical(body: PhysicsBody, options: BodyStepOptions, dt: number): void {
  if (body.inLiquid) {
    body.velocityY -= LIQUID_GRAVITY * dt;
    body.velocityY *= 1 - (1 - Math.exp(-LIQUID_DRAG * dt));
    // Creatures float rather than sinking to the seabed and drowning there.
    if (options.jump || body.velocityY < -LIQUID_FLOAT_SPEED) {
      body.velocityY = LIQUID_FLOAT_SPEED;
    }
    return;
  }

  if (options.jump && body.onGround) {
    body.velocityY = options.jumpVelocity;
    body.onGround = false;
    return;
  }

  body.velocityY -= GRAVITY * dt;
  if (body.velocityY < TERMINAL_VELOCITY) body.velocityY = TERMINAL_VELOCITY;
}

interface MoveOutcome {
  x: number;
  y: number;
  z: number;
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  onGround: boolean;
}

/**
 * Moves the body, retrying from one step height up when it hits a wall.
 *
 * Without this a creature stops dead at every one-block rise, which on real
 * terrain means it never leaves the spot it spawned on. The retry is only
 * accepted when it actually gains ground, so creatures cannot climb sheer
 * faces or scale themselves out of a pit.
 */
function moveWithStepUp(
  body: PhysicsBody,
  world: VoxelQuery,
  options: BodyStepOptions,
  dt: number,
): MoveOutcome {
  const deltaX = body.velocityX * dt;
  const deltaY = body.velocityY * dt;
  const deltaZ = body.velocityZ * dt;

  const direct = moveEntity(world, body, options.size, deltaX, deltaY, deltaZ);
  const blocked = direct.hitX || direct.hitZ;

  if (!blocked || !body.onGround || options.stepHeight <= 0) return direct;

  const horizontalGain = Math.hypot(direct.x - body.x, direct.z - body.z);
  const attempted = Math.hypot(deltaX, deltaZ);
  // Already sliding along the obstacle: a step-up would gain nothing.
  if (attempted <= STEP_PROBE || horizontalGain >= attempted - STEP_PROBE) return direct;

  const raised = { x: body.x, y: body.y + options.stepHeight, z: body.z };
  // Refuse to start a move from inside geometry — the sweep assumes it begins
  // in free space and would resolve unpredictably otherwise.
  if (isPositionObstructed(world, raised, options.size)) return direct;

  const stepped = moveEntity(world, raised, options.size, deltaX, 0, deltaZ);
  const steppedGain = Math.hypot(stepped.x - body.x, stepped.z - body.z);
  if (steppedGain <= horizontalGain + STEP_PROBE) return direct;

  // Settle back down onto whatever the body stepped onto.
  const settled = moveEntity(
    world,
    { x: stepped.x, y: stepped.y, z: stepped.z },
    options.size,
    0,
    -options.stepHeight,
    0,
  );

  return {
    x: settled.x,
    y: settled.y,
    z: settled.z,
    hitX: false,
    hitZ: false,
    hitY: direct.hitY,
    onGround: settled.onGround || direct.onGround,
  };
}
