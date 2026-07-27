import { clamp } from '../shared/Vec3';
import { BrainState, type Mob } from './Mob';
import { Temperament } from './EntityType';

/** How fast a creature turns toward the direction it wants to face. */
const TURN_RATE = 6;

/** Seconds a passive creature runs after being struck. */
const PANIC_DURATION = 4;

/** Wander timings, in seconds. */
const IDLE_MIN = 1.5;
const IDLE_MAX = 5;
const WANDER_MIN = 1.5;
const WANDER_MAX = 4;

/** Hostiles give up once the player is this much beyond detection range. */
const PURSUIT_SLACK = 6;

/** Vertical difference beyond which a hostile cannot reach the player. */
const MAX_VERTICAL_PURSUIT = 8;

export interface BrainInput {
  readonly playerX: number;
  readonly playerY: number;
  readonly playerZ: number;
  /** False when the player is dead or in creative — nothing to hunt. */
  readonly playerTargetable: boolean;
  /** Dark enough to hunt: night outside, or under a roof at any hour. */
  readonly isDark: boolean;
  /** Blocked against terrain last tick; used to decide whether to jump. */
  readonly blocked: boolean;
  readonly random: () => number;
  readonly dt: number;
}

export interface BrainOutput {
  readonly desiredVelocityX: number;
  readonly desiredVelocityZ: number;
  readonly jump: boolean;
  /** True when the creature is in range and off cooldown. */
  readonly attack: boolean;
}

const IDLE_OUTPUT: BrainOutput = Object.freeze({
  desiredVelocityX: 0,
  desiredVelocityZ: 0,
  jump: false,
  attack: false,
});

/**
 * Decides what a creature wants to do this tick.
 *
 * Pure: it reads the mob and the situation and returns an intent, without
 * touching the world or the mob's physics. That keeps behaviour testable
 * without a world, and means the same brain runs identically wherever the
 * creature is simulated.
 */
export function updateBrain(mob: Mob, input: BrainInput): BrainOutput {
  mob.age += input.dt;
  mob.stateTimer -= input.dt;
  if (mob.attackCooldown > 0) mob.attackCooldown -= input.dt;
  if (mob.hurtTimer > 0) mob.hurtTimer -= input.dt;

  const definition = mob.definition;

  // Fleeing overrides everything, including hunting.
  if (mob.state === BrainState.Flee && mob.stateTimer > 0) {
    return runFrom(mob, mob.fleeFromX, mob.fleeFromZ, input);
  }

  if (definition.temperament === Temperament.Hostile) {
    const hunting = chooseHunt(mob, input);
    if (hunting !== null) return hunting;
  }

  return wander(mob, input);
}

/** Starts a panic run away from a damage source. */
export function startFleeing(mob: Mob, fromX: number, fromZ: number): void {
  mob.state = BrainState.Flee;
  mob.stateTimer = PANIC_DURATION;
  mob.fleeFromX = fromX;
  mob.fleeFromZ = fromZ;
}

function chooseHunt(mob: Mob, input: BrainInput): BrainOutput | null {
  if (!input.playerTargetable) return null;

  // Hostiles only hunt in the dark; open daylight sends them back to wandering
  // and, for those that burn, to despawning.
  const engaged = mob.state === BrainState.Chase;
  if (!input.isDark && !engaged) return null;

  const definition = mob.definition;
  const range = definition.detectionRange + (engaged ? PURSUIT_SLACK : 0);
  const distanceSquared = mob.horizontalDistanceSquaredTo(input.playerX, input.playerZ);
  if (distanceSquared > range * range) {
    if (engaged) mob.state = BrainState.Idle;
    return null;
  }

  // A player far above or below is unreachable; chasing would pin the
  // creature against a wall indefinitely.
  if (Math.abs(mob.y - input.playerY) > MAX_VERTICAL_PURSUIT) {
    if (engaged) mob.state = BrainState.Idle;
    return null;
  }

  mob.state = BrainState.Chase;
  mob.stateTimer = 1;

  const dx = input.playerX - mob.x;
  const dz = input.playerZ - mob.z;
  const distance = Math.hypot(dx, dz);
  mob.targetYaw = Math.atan2(-dx, -dz);
  turnToward(mob, input.dt);

  const reach = definition.attackRange + definition.width / 2;
  const inRange = distance <= reach;
  const canAttack = inRange && mob.attackCooldown <= 0;

  // Stop closing once in range, otherwise the creature shoves the player.
  const speed = inRange ? 0 : definition.moveSpeed;
  const scale = distance > 1e-4 ? speed / distance : 0;

  return {
    desiredVelocityX: dx * scale,
    desiredVelocityZ: dz * scale,
    jump: input.blocked && mob.onGround,
    attack: canAttack,
  };
}

function runFrom(mob: Mob, fromX: number, fromZ: number, input: BrainInput): BrainOutput {
  const dx = mob.x - fromX;
  const dz = mob.z - fromZ;
  const distance = Math.hypot(dx, dz);

  // Directly on top of the threat: bolt in the current facing instead of
  // dividing by zero.
  const dirX = distance > 1e-4 ? dx / distance : -Math.sin(mob.yaw);
  const dirZ = distance > 1e-4 ? dz / distance : -Math.cos(mob.yaw);

  mob.targetYaw = Math.atan2(-dirX, -dirZ);
  turnToward(mob, input.dt);

  const speed = mob.definition.moveSpeed * mob.definition.sprintMultiplier;
  return {
    desiredVelocityX: dirX * speed,
    desiredVelocityZ: dirZ * speed,
    jump: input.blocked && mob.onGround,
    attack: false,
  };
}

function wander(mob: Mob, input: BrainInput): BrainOutput {
  if (mob.stateTimer > 0 && mob.state === BrainState.Wander) {
    return walkForward(mob, input);
  }
  if (mob.stateTimer > 0 && mob.state === BrainState.Idle) {
    turnToward(mob, input.dt);
    return IDLE_OUTPUT;
  }

  // Timer elapsed: alternate between standing still and strolling somewhere.
  if (mob.state === BrainState.Wander) {
    mob.state = BrainState.Idle;
    mob.stateTimer = IDLE_MIN + input.random() * (IDLE_MAX - IDLE_MIN);
    return IDLE_OUTPUT;
  }

  mob.state = BrainState.Wander;
  mob.stateTimer = WANDER_MIN + input.random() * (WANDER_MAX - WANDER_MIN);
  mob.targetYaw = input.random() * Math.PI * 2;
  return walkForward(mob, input);
}

function walkForward(mob: Mob, input: BrainInput): BrainOutput {
  turnToward(mob, input.dt);
  const speed = mob.definition.moveSpeed * 0.55;
  return {
    desiredVelocityX: -Math.sin(mob.yaw) * speed,
    desiredVelocityZ: -Math.cos(mob.yaw) * speed,
    jump: input.blocked && mob.onGround,
    attack: false,
  };
}

/**
 * Rotates `yaw` toward `targetYaw` along the shortest arc.
 *
 * Exported because a ridden vehicle turns the same way a wandering creature
 * does, and duplicating the shortest-arc handling is how the two drift apart.
 */
export function turnToward(mob: Mob, dt: number, rate = TURN_RATE): void {
  const difference = shortestAngle(mob.targetYaw - mob.yaw);
  const blend = clamp(rate * dt, 0, 1);
  mob.yaw = normaliseAngle(mob.yaw + difference * blend);
}

function shortestAngle(angle: number): number {
  const wrapped = normaliseAngle(angle);
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

function normaliseAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}
