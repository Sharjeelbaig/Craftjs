import { BlockRegistry } from '../world/BlockType';
import type { VoxelQuery } from '../world/VoxelQuery';
import { isStandingOnGround, moveEntity } from '../physics/CollisionResolver';
import { MovementMode, PLAYER_SIZE, type Player } from './Player';
import type { PlayerIntent } from './PlayerIntent';

/**
 * Tuning for player locomotion, in blocks and seconds.
 *
 * Every value is a rate rather than a per-frame amount, so behaviour is
 * identical regardless of tick rate.
 */
export interface MovementSettings {
  readonly gravity: number;
  readonly terminalVelocity: number;
  readonly walkSpeed: number;
  readonly sprintMultiplier: number;
  readonly sneakMultiplier: number;
  readonly jumpVelocity: number;
  readonly flySpeed: number;
  readonly flySprintMultiplier: number;
  readonly swimSpeed: number;
  readonly swimVerticalSpeed: number;
  readonly liquidGravity: number;
  readonly liquidDrag: number;
  /** Velocity blend rates (per second) — higher means snappier control. */
  readonly groundResponsiveness: number;
  readonly airResponsiveness: number;
  readonly liquidResponsiveness: number;
  readonly flyResponsiveness: number;
}

export const DEFAULT_MOVEMENT: MovementSettings = Object.freeze({
  gravity: 28,
  terminalVelocity: -58,
  walkSpeed: 4.6,
  sprintMultiplier: 1.4,
  sneakMultiplier: 0.32,
  jumpVelocity: 8.6,
  flySpeed: 12,
  flySprintMultiplier: 2.4,
  swimSpeed: 3.2,
  swimVerticalSpeed: 3.6,
  liquidGravity: 7,
  liquidDrag: 4.2,
  groundResponsiveness: 14,
  airResponsiveness: 4,
  liquidResponsiveness: 6,
  flyResponsiveness: 12,
});

/**
 * Framerate-independent blend factor.
 *
 * Exponential smoothing rather than a fixed per-frame lerp: it can never
 * overshoot, so acceleration stays stable even if a tick runs long.
 */
function blendFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export interface MovementOutcome {
  /** Distance fallen when the player landed this tick; 0 otherwise. */
  readonly landedFallDistance: number;
}

const NO_LANDING: MovementOutcome = Object.freeze({ landedFallDistance: 0 });

/**
 * Replaces a non-finite value with a safe default.
 *
 * One NaN in a position or velocity is unrecoverable: it propagates through
 * collision into every later tick and the player disappears from the world
 * with no way back. Containing it here costs nothing and cannot make things
 * worse than the alternative.
 */
function sanitise(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Advances the player one physics tick: intent to velocity, velocity to
 * collision-resolved position.
 */
export class PlayerMovement {
  private readonly settings: MovementSettings;

  constructor(settings: MovementSettings = DEFAULT_MOVEMENT) {
    this.settings = settings;
  }

  step(
    player: Player,
    world: VoxelQuery,
    intent: PlayerIntent,
    dt: number,
  ): MovementOutcome {
    if (dt <= 0 || !Number.isFinite(dt)) return NO_LANDING;

    player.beginTick();
    player.x = sanitise(player.x);
    player.y = sanitise(player.y);
    player.z = sanitise(player.z);
    player.velocityX = sanitise(player.velocityX);
    player.velocityY = sanitise(player.velocityY);
    player.velocityZ = sanitise(player.velocityZ);

    const wasOnGround = player.onGround;
    const startY = player.y;
    player.inLiquid = this.isSubmerged(player, world);

    if (player.mode === MovementMode.Flying) {
      this.applyFlightVelocity(player, intent, dt);
    } else {
      this.applyWalkVelocity(player, intent, dt);
    }

    const result = moveEntity(
      world,
      player,
      PLAYER_SIZE,
      player.velocityX * dt,
      player.velocityY * dt,
      player.velocityZ * dt,
    );

    player.x = result.x;
    player.y = result.y;
    player.z = result.z;

    // Cancel velocity into surfaces so the player does not accumulate a
    // pressure that fires them off when the obstruction disappears.
    if (result.hitX) player.velocityX = 0;
    if (result.hitZ) player.velocityZ = 0;
    if (result.hitY) player.velocityY = 0;

    player.onGround =
      player.mode === MovementMode.Flying
        ? false
        : result.onGround || isStandingOnGround(world, player, PLAYER_SIZE);

    return this.trackFall(player, wasOnGround, startY);
  }

  /**
   * Accumulates free-fall distance and reports it on landing.
   *
   * Measured from actual descent rather than from velocity, so a player who
   * swims down, flies, or rides a slope never accrues phantom fall damage.
   */
  private trackFall(player: Player, wasOnGround: boolean, startY: number): MovementOutcome {
    if (player.mode === MovementMode.Flying || player.inLiquid) {
      player.fallDistance = 0;
      return NO_LANDING;
    }

    if (!player.onGround) {
      if (player.y < startY) player.fallDistance += startY - player.y;
      return NO_LANDING;
    }

    const fell = player.fallDistance;
    player.fallDistance = 0;
    // Only a landing reports; already being grounded does not.
    return wasOnGround || fell <= 0 ? NO_LANDING : { landedFallDistance: fell };
  }

  /** Horizontal intent rotated into world space by the player's yaw. */
  private worldDirection(player: Player, intent: PlayerIntent): { x: number; z: number } {
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = -forwardZ;
    const rightZ = forwardX;

    let x = forwardX * intent.moveForward + rightX * intent.moveRight;
    let z = forwardZ * intent.moveForward + rightZ * intent.moveRight;

    // Normalise so diagonal movement is not faster than cardinal movement.
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    return { x, z };
  }

  private applyWalkVelocity(player: Player, intent: PlayerIntent, dt: number): void {
    const s = this.settings;
    const direction = this.worldDirection(player, intent);

    let speed = player.inLiquid ? s.swimSpeed : s.walkSpeed;
    if (intent.sprint && !player.inLiquid) speed *= s.sprintMultiplier;
    if (intent.down && player.onGround && !player.inLiquid) speed *= s.sneakMultiplier;

    const rate = player.inLiquid
      ? s.liquidResponsiveness
      : player.onGround
        ? s.groundResponsiveness
        : s.airResponsiveness;
    const blend = blendFactor(rate, dt);

    player.velocityX += (direction.x * speed - player.velocityX) * blend;
    player.velocityZ += (direction.z * speed - player.velocityZ) * blend;

    if (player.inLiquid) {
      player.velocityY -= s.liquidGravity * dt;
      player.velocityY *= 1 - blendFactor(s.liquidDrag, dt);
      if (intent.up) player.velocityY = s.swimVerticalSpeed;
      else if (intent.down) player.velocityY = -s.swimVerticalSpeed;
      return;
    }

    if (intent.up && player.onGround) {
      player.velocityY = s.jumpVelocity;
      player.onGround = false;
    } else {
      player.velocityY -= s.gravity * dt;
      if (player.velocityY < s.terminalVelocity) player.velocityY = s.terminalVelocity;
    }
  }

  private applyFlightVelocity(player: Player, intent: PlayerIntent, dt: number): void {
    const s = this.settings;
    const direction = this.worldDirection(player, intent);
    const speed = intent.sprint ? s.flySpeed * s.flySprintMultiplier : s.flySpeed;
    const blend = blendFactor(s.flyResponsiveness, dt);

    const targetY = (intent.up ? speed : 0) - (intent.down ? speed : 0);

    player.velocityX += (direction.x * speed - player.velocityX) * blend;
    player.velocityZ += (direction.z * speed - player.velocityZ) * blend;
    player.velocityY += (targetY - player.velocityY) * blend;
  }

  /** True when the player's lower body is inside a fluid. */
  private isSubmerged(player: Player, world: VoxelQuery): boolean {
    return BlockRegistry.isLiquid(
      world.getBlock(Math.floor(player.x), Math.floor(player.y + 0.4), Math.floor(player.z)),
    );
  }
}
