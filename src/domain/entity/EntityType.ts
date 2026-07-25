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

  /** Hostiles despawn at sunrise rather than lingering into the day. */
  readonly despawnsAtDawn: boolean;
  /** Speed of the walk cycle relative to distance travelled. */
  readonly walkCycleScale: number;
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
    despawnsAtDawn: false,
    walkCycleScale: 2.6,
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

  /** Creature types eligible for a given spawn window. */
  spawnable(temperament: Temperament): readonly EntityDefinition[] {
    return DEFINITIONS.filter((definition) => definition.temperament === temperament);
  },
} as const;

export const PASSIVE_TYPES: readonly EntityDefinition[] = Object.freeze(
  EntityRegistry.spawnable(Temperament.Passive),
);

export const HOSTILE_TYPES: readonly EntityDefinition[] = Object.freeze(
  EntityRegistry.spawnable(Temperament.Hostile),
);
