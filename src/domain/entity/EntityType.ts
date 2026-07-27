/**
 * The creature catalogue.
 *
 * Ids are stable identifiers used by the renderer to pick a model, so append
 * new creatures rather than renumbering.
 */

export const EntityTypeId = {
  Pig: 0,
  Cow: 1,
  Chicken: 2,
  Sheep: 3,
  Zombie: 4,
  Spider: 5,
  /** Presentation-only avatar received from a multiplayer peer. */
  RemotePlayer: 6,
  Skeleton: 7,
  Creeper: 8,
  CaveSpider: 9,
  Horse: 10,
  /** A vehicle rather than a creature: no brain, no loot, rails only. */
  Minecart: 11,
} as const;

export type EntityTypeId = (typeof EntityTypeId)[keyof typeof EntityTypeId];

export const Temperament = {
  /** Wanders, flees when struck. */
  Passive: 'passive',
  /** Hunts the player on sight. */
  Hostile: 'hostile',
} as const;

export type Temperament = (typeof Temperament)[keyof typeof Temperament];

export interface EntityDefinition {
  readonly id: EntityTypeId;
  readonly name: string;
  readonly temperament: Temperament;

  /** Collision box, in blocks. */
  readonly width: number;
  readonly height: number;
  /** Height the creature can walk up unaided. */
  readonly stepHeight: number;

  readonly maxHealth: number;
  /** Ground speed while moving, in blocks per second. */
  readonly moveSpeed: number;
  /** Speed multiplier while fleeing or chasing. */
  readonly sprintMultiplier: number;

  readonly attackDamage: number;
  /** Distance from collision box edge at which an attack lands. */
  readonly attackRange: number;
  readonly attackCooldown: number;
  /** Range at which a hostile creature notices the player. */
  readonly detectionRange: number;

  /** Group size when a spawn attempt succeeds. */
  readonly groupMin: number;
  readonly groupMax: number;
  /** Relative chance within the creature's spawn pool. */
  readonly spawnWeight: number;

  /** Hostiles despawn at sunrise rather than lingering into the day. */
  readonly despawnsAtDawn: boolean;
  /** Speed of the walk cycle relative to distance travelled. */
  readonly walkCycleScale: number;

  /** Appears in natural spawn cycles and offers a spawn egg. */
  readonly wildlife: boolean;
  /** The player may sit on this and steer it. */
  readonly rideable: boolean;
  /** Riding requires a saddle in the inventory. */
  readonly needsSaddle: boolean;
  /** Runs on rails instead of walking, and falls still when off them. */
  readonly railBound: boolean;
  /** Height of the seat above the entity's feet, in blocks. */
  readonly seatHeight: number;
  /** Ground speed while carrying a rider. */
  readonly rideSpeed: number;
  /**
   * Put there by the player rather than by the world.
   *
   * Such entities are exempt from distance and daylight despawning — a cart
   * that evaporated because its owner walked away would read as a lost item,
   * not as a population cap doing its job.
   */
  readonly placedByPlayer: boolean;
}

function define(
  id: EntityTypeId,
  name: string,
  temperament: Temperament,
  overrides: Partial<Omit<EntityDefinition, 'id' | 'name' | 'temperament'>>,
): EntityDefinition {
  return Object.freeze({
    id,
    name,
    temperament,
    width: 0.9,
    height: 0.9,
    stepHeight: 1,
    maxHealth: 10,
    moveSpeed: 1.6,
    sprintMultiplier: 1.6,
    attackDamage: 0,
    attackRange: 0.6,
    attackCooldown: 1,
    detectionRange: 0,
    groupMin: 2,
    groupMax: 4,
    spawnWeight: 1,
    despawnsAtDawn: false,
    walkCycleScale: 2.6,
    wildlife: true,
    rideable: false,
    needsSaddle: false,
    railBound: false,
    seatHeight: 0,
    rideSpeed: 0,
    placedByPlayer: false,
    ...overrides,
  });
}

const DEFINITIONS: readonly EntityDefinition[] = Object.freeze([
  define(EntityTypeId.Pig, 'Pig', Temperament.Passive, {
    width: 0.9,
    height: 0.9,
    maxHealth: 10,
    moveSpeed: 1.5,
  }),
  define(EntityTypeId.Cow, 'Cow', Temperament.Passive, {
    width: 0.9,
    height: 1.35,
    maxHealth: 10,
    moveSpeed: 1.4,
    walkCycleScale: 2.2,
  }),
  define(EntityTypeId.Chicken, 'Chicken', Temperament.Passive, {
    width: 0.4,
    height: 0.7,
    maxHealth: 4,
    moveSpeed: 1.6,
    groupMin: 3,
    groupMax: 5,
    walkCycleScale: 4.5,
  }),
  define(EntityTypeId.Sheep, 'Sheep', Temperament.Passive, {
    width: 0.9,
    height: 1.3,
    maxHealth: 8,
    moveSpeed: 1.4,
    walkCycleScale: 2.2,
  }),
  define(EntityTypeId.Zombie, 'Zombie', Temperament.Hostile, {
    width: 0.6,
    height: 1.95,
    maxHealth: 20,
    moveSpeed: 2.1,
    sprintMultiplier: 1,
    attackDamage: 3,
    attackRange: 0.7,
    attackCooldown: 1.1,
    detectionRange: 20,
    groupMin: 1,
    groupMax: 3,
    despawnsAtDawn: true,
    walkCycleScale: 2.4,
  }),
  define(EntityTypeId.Spider, 'Spider', Temperament.Hostile, {
    width: 1.3,
    height: 0.85,
    maxHealth: 16,
    moveSpeed: 3.1,
    sprintMultiplier: 1,
    attackDamage: 2,
    attackRange: 0.8,
    attackCooldown: 0.85,
    detectionRange: 18,
    groupMin: 1,
    groupMax: 2,
    despawnsAtDawn: false,
    walkCycleScale: 5,
  }),
  define(EntityTypeId.RemotePlayer, 'Player', Temperament.Passive, {
    width: 0.6,
    height: 1.8,
    maxHealth: 20,
    moveSpeed: 4.3,
    groupMin: 0,
    groupMax: 0,
    wildlife: false,
  }),
  define(EntityTypeId.Skeleton, 'Skeleton', Temperament.Hostile, {
    width: 0.6,
    height: 1.99,
    maxHealth: 20,
    moveSpeed: 2.2,
    sprintMultiplier: 1,
    attackDamage: 3,
    attackRange: 0.8,
    attackCooldown: 1.2,
    detectionRange: 24,
    groupMin: 1,
    groupMax: 2,
    despawnsAtDawn: true,
    walkCycleScale: 2.5,
  }),
  define(EntityTypeId.Creeper, 'Creeper', Temperament.Hostile, {
    width: 0.6,
    height: 1.7,
    maxHealth: 20,
    moveSpeed: 2.15,
    sprintMultiplier: 1,
    attackDamage: 7,
    attackRange: 0.65,
    attackCooldown: 1.5,
    detectionRange: 20,
    groupMin: 1,
    groupMax: 2,
    spawnWeight: 0.8,
    despawnsAtDawn: true,
    walkCycleScale: 2.5,
  }),
  define(EntityTypeId.CaveSpider, 'Cave Spider', Temperament.Hostile, {
    width: 0.75,
    height: 0.5,
    maxHealth: 12,
    moveSpeed: 3.4,
    sprintMultiplier: 1,
    attackDamage: 2,
    attackRange: 0.65,
    attackCooldown: 0.75,
    detectionRange: 18,
    groupMin: 1,
    groupMax: 2,
    spawnWeight: 0.4,
    despawnsAtDawn: false,
    walkCycleScale: 5.6,
  }),
  define(EntityTypeId.Horse, 'Horse', Temperament.Passive, {
    width: 1.2,
    height: 1.6,
    maxHealth: 15,
    moveSpeed: 2.2,
    sprintMultiplier: 1.8,
    stepHeight: 1,
    groupMin: 2,
    groupMax: 3,
    spawnWeight: 0.7,
    walkCycleScale: 1.9,
    rideable: true,
    needsSaddle: true,
    seatHeight: 1.35,
    // Faster than a sprinting player, which is the whole point of a horse.
    rideSpeed: 8.4,
  }),
  define(EntityTypeId.Minecart, 'Minecart', Temperament.Passive, {
    width: 0.98,
    height: 0.7,
    maxHealth: 6,
    moveSpeed: 0,
    stepHeight: 0,
    groupMin: 0,
    groupMax: 0,
    walkCycleScale: 0,
    wildlife: false,
    rideable: true,
    railBound: true,
    seatHeight: 0.32,
    rideSpeed: 9.5,
    placedByPlayer: true,
  }),
]);

const FALLBACK = DEFINITIONS[EntityTypeId.Pig];

export const EntityRegistry = {
  /** Never throws: unknown ids degrade rather than crashing the entity loop. */
  get(id: number): EntityDefinition {
    return DEFINITIONS[id] ?? FALLBACK;
  },

  isHostile(id: number): boolean {
    return (DEFINITIONS[id] ?? FALLBACK).temperament === Temperament.Hostile;
  },

  all(): readonly EntityDefinition[] {
    return DEFINITIONS;
  },

  /**
   * Creature types eligible for a given spawn window.
   *
   * Vehicles and peer avatars are excluded: they are neither hunted, bred nor
   * naturally placed, so they belong to no spawn pool and offer no spawn egg.
   */
  spawnable(temperament: Temperament): readonly EntityDefinition[] {
    return DEFINITIONS.filter(
      (definition) => definition.wildlife && definition.temperament === temperament,
    );
  },

  isRideable(id: number): boolean {
    return (DEFINITIONS[id] ?? FALLBACK).rideable;
  },

  isPlacedByPlayer(id: number): boolean {
    return (DEFINITIONS[id] ?? FALLBACK).placedByPlayer;
  },
} as const;

export const PASSIVE_TYPES: readonly EntityDefinition[] = Object.freeze(
  EntityRegistry.spawnable(Temperament.Passive),
);

export const HOSTILE_TYPES: readonly EntityDefinition[] = Object.freeze(
  EntityRegistry.spawnable(Temperament.Hostile),
);
