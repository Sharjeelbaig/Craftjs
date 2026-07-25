import { EntityRegistry, type EntityDefinition, type EntityTypeId } from './EntityType';

export const BrainState = {
  Idle: 'idle',
  Wander: 'wander',
  Chase: 'chase',
  Flee: 'flee',
} as const;

export type BrainState = (typeof BrainState)[keyof typeof BrainState];

/**
 * Anything the physics step can move. Both `Mob` and `Player` satisfy this,
 * so collision and gravity are written once.
 */
export interface PhysicsBody {
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  onGround: boolean;
  inLiquid: boolean;
}

let nextId = 1;

/**
 * A creature.
 *
 * Mutable by design: every field is written each tick, and allocating value
 * objects for position and velocity at 60 Hz across dozens of creatures would
 * dominate the frame budget.
 */
export class Mob implements PhysicsBody {
  readonly id: number;
  readonly type: EntityTypeId;
  readonly definition: EntityDefinition;

  x: number;
  y: number;
  z: number;

  /** Position at the end of the previous tick, for render interpolation. */
  previousX: number;
  previousY: number;
  previousZ: number;

  velocityX = 0;
  velocityY = 0;
  velocityZ = 0;

  /** Facing, in radians. */
  yaw: number;
  /** Yaw the brain wants; the body turns toward it over time. */
  targetYaw: number;

  health: number;
  onGround = false;
  inLiquid = false;

  /** Seconds lived, used for despawn and idle timers. */
  age = 0;
  /** Remaining invulnerability, also drives the damage flash. */
  hurtTimer = 0;
  /** Remaining cooldown before this creature can attack again. */
  attackCooldown = 0;
  /** Distance fallen since last touching the ground. */
  fallDistance = 0;

  state: BrainState = BrainState.Idle;
  /** Seconds remaining in the current brain state. */
  stateTimer = 0;
  /** Set when fleeing, so the creature runs away from where it was hit. */
  fleeFromX = 0;
  fleeFromZ = 0;

  /** Accumulated ground distance, drives the walk animation. */
  walkPhase = 0;
  /** Whether the creature asked to move this tick. */
  moving = false;
  /** Ran into terrain last tick; the brain uses it to decide to jump. */
  blockedLastTick = false;

  removed = false;

  constructor(type: EntityTypeId, x: number, y: number, z: number, yaw = 0) {
    this.id = nextId++;
    this.type = type;
    this.definition = EntityRegistry.get(type);
    this.x = x;
    this.y = y;
    this.z = z;
    this.previousX = x;
    this.previousY = y;
    this.previousZ = z;
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.health = this.definition.maxHealth;
  }

  get isAlive(): boolean {
    return !this.removed && this.health > 0;
  }

  get isHostile(): boolean {
    return this.definition.attackDamage > 0;
  }

  /** Centre of the collision box, used for targeting and attack range. */
  get centreY(): number {
    return this.y + this.definition.height / 2;
  }

  beginTick(): void {
    this.previousX = this.x;
    this.previousY = this.y;
    this.previousZ = this.z;
  }

  /** Squared horizontal distance, avoiding a square root in hot loops. */
  horizontalDistanceSquaredTo(x: number, z: number): number {
    const dx = this.x - x;
    const dz = this.z - z;
    return dx * dx + dz * dz;
  }

  distanceSquaredTo(x: number, y: number, z: number): number {
    const dx = this.x - x;
    const dy = this.centreY - y;
    const dz = this.z - z;
    return dx * dx + dy * dy + dz * dz;
  }
}

/** Resets id allocation. Test-only; ids are not persisted. */
export function resetMobIds(): void {
  nextId = 1;
}
