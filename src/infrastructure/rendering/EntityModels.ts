import { EntityTypeId } from '@domain/entity/EntityType';

/**
 * Box models for creatures.
 *
 * Dimensions are given in texture pixels (16 per block) because that is the
 * unit the proportions were designed in; keeping the source numbers whole
 * makes the models readable and easy to adjust.
 */
const PIXEL = 1 / 16;

export const AnimationRole = {
  /** Fixed relative to the body. */
  Static: 'static',
  /** Swings with the walk cycle. */
  LimbA: 'limbA',
  /** Swings opposite to `LimbA`. */
  LimbB: 'limbB',
  /** Bobs gently while moving. */
  Head: 'head',
} as const;

export type AnimationRole = (typeof AnimationRole)[keyof typeof AnimationRole];

export interface PartDefinition {
  /** Box dimensions in blocks. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /**
   * Point the part rotates about, relative to the creature's feet centre.
   * For limbs this is the shoulder or hip, not the box centre.
   */
  readonly pivotX: number;
  readonly pivotY: number;
  readonly pivotZ: number;
  /** Box centre relative to the pivot, before rotation. */
  readonly centreX: number;
  readonly centreY: number;
  readonly centreZ: number;
  /** Fixed rotation applied after the animated swing, in radians. */
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly role: AnimationRole;
  /** Base colour, as a packed 0xRRGGBB value. */
  readonly colour: number;
  /** Multiplier on the swing amplitude for this part. */
  readonly swingScale: number;
}

export interface EntityModel {
  readonly parts: readonly PartDefinition[];
  /** Peak limb swing, in radians. */
  readonly swingAmplitude: number;
}

interface PartSpec {
  /** Size in pixels. */
  size: [number, number, number];
  /** Pivot in pixels, relative to feet centre. */
  pivot: [number, number, number];
  /** Centre offset from the pivot, in pixels. */
  centre?: [number, number, number];
  rotation?: [number, number, number];
  role?: AnimationRole;
  colour: number;
  swingScale?: number;
}

function part(spec: PartSpec): PartDefinition {
  const [sx, sy, sz] = spec.size;
  const [px, py, pz] = spec.pivot;
  const [cx, cy, cz] = spec.centre ?? [0, 0, 0];
  const [rx, ry, rz] = spec.rotation ?? [0, 0, 0];

  return Object.freeze({
    sizeX: sx * PIXEL,
    sizeY: sy * PIXEL,
    sizeZ: sz * PIXEL,
    pivotX: px * PIXEL,
    pivotY: py * PIXEL,
    pivotZ: pz * PIXEL,
    centreX: cx * PIXEL,
    centreY: cy * PIXEL,
    centreZ: cz * PIXEL,
    rotationX: rx,
    rotationY: ry,
    rotationZ: rz,
    role: spec.role ?? AnimationRole.Static,
    colour: spec.colour,
    swingScale: spec.swingScale ?? 1,
  });
}

/**
 * Builds four legs from one template.
 *
 * Diagonally opposite legs share a phase, which is what makes a quadruped
 * read as walking rather than hopping.
 */
function quadrupedLegs(
  width: number,
  length: number,
  offsetX: number,
  offsetZ: number,
  hipY: number,
  colour: number,
): PartDefinition[] {
  const legs: PartDefinition[] = [];
  for (const [signX, signZ] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    legs.push(
      part({
        size: [width, length, width],
        pivot: [signX * offsetX, hipY, signZ * offsetZ],
        centre: [0, -length / 2, 0],
        role: signX * signZ < 0 ? AnimationRole.LimbA : AnimationRole.LimbB,
        colour,
      }),
    );
  }
  return legs;
}

/** Eight radiating legs for the spider, splayed out and down. */
function spiderLegs(colour: number): PartDefinition[] {
  const legs: PartDefinition[] = [];
  for (let index = 0; index < 8; index++) {
    const side = index < 4 ? -1 : 1;
    const rank = index % 4;
    const spread = (rank - 1.5) * 0.42;
    legs.push(
      part({
        size: [2, 2, 15],
        pivot: [side * 4, 8, (rank - 1.5) * 3],
        centre: [0, 0, 7.5],
        // Rotated out to the side and angled downward from the body.
        rotation: [0.34, side * (Math.PI / 2) + spread, 0],
        role: rank % 2 === 0 ? AnimationRole.LimbA : AnimationRole.LimbB,
        colour,
        swingScale: 0.5,
      }),
    );
  }
  return legs;
}

const PIG_SKIN = 0xe0a0a4;
const COW_HIDE = 0x4a3728;
const COW_PATCH = 0xf2f2f2;
const CHICKEN_BODY = 0xf2f2f2;
const CHICKEN_BEAK = 0xf0a33a;
const SHEEP_WOOL = 0xece9e2;
const SHEEP_SKIN = 0xd6cfc4;
const ZOMBIE_SKIN = 0x4f7a3a;
const ZOMBIE_SHIRT = 0x3a5f8a;
const ZOMBIE_LEGS = 0x38416b;
const SPIDER_BODY = 0x2b2320;
const SPIDER_EYES = 0xa8202a;
const CAVE_SPIDER_BODY = 0x18333a;
const CAVE_SPIDER_EYES = 0xd4323c;
const SKELETON_BONE = 0xc8c4b2;
const SKELETON_SHADOW = 0x9c998d;
const CREEPER_GREEN = 0x5b9b42;
const CREEPER_DARK = 0x204626;
const PLAYER_SKIN = 0xd9a06c;
const PLAYER_SHIRT = 0x4c92c3;
const PLAYER_LEGS = 0x313b55;

const MODELS: Readonly<Record<EntityTypeId, EntityModel>> = Object.freeze({
  [EntityTypeId.Pig]: Object.freeze({
    swingAmplitude: 0.62,
    parts: Object.freeze([
      part({ size: [10, 8, 16], pivot: [0, 10, 0], colour: PIG_SKIN }),
      part({ size: [8, 8, 8], pivot: [0, 11, -11], role: AnimationRole.Head, colour: PIG_SKIN }),
      part({ size: [4, 3, 2], pivot: [0, 9, -15.5], role: AnimationRole.Head, colour: 0xc98289 }),
      ...quadrupedLegs(4, 6, 3, 5, 6, 0xcf8f93),
    ]),
  }),

  [EntityTypeId.Cow]: Object.freeze({
    swingAmplitude: 0.5,
    parts: Object.freeze([
      part({ size: [12, 10, 18], pivot: [0, 17, 0], colour: COW_HIDE }),
      part({ size: [12.4, 5, 8], pivot: [0, 18, 3], colour: COW_PATCH }),
      part({ size: [8, 8, 8], pivot: [0, 20, -12], role: AnimationRole.Head, colour: COW_HIDE }),
      part({ size: [9, 3, 3], pivot: [0, 18, -16], role: AnimationRole.Head, colour: COW_PATCH }),
      part({ size: [2, 2, 2], pivot: [-4, 24, -11], role: AnimationRole.Head, colour: 0xd8d2c4 }),
      part({ size: [2, 2, 2], pivot: [4, 24, -11], role: AnimationRole.Head, colour: 0xd8d2c4 }),
      ...quadrupedLegs(4, 12, 4, 6, 12, 0x413025),
    ]),
  }),

  [EntityTypeId.Chicken]: Object.freeze({
    swingAmplitude: 0.85,
    parts: Object.freeze([
      part({ size: [8, 8, 10], pivot: [0, 8, 0], colour: CHICKEN_BODY }),
      part({ size: [6, 6, 6], pivot: [0, 14, -5], role: AnimationRole.Head, colour: CHICKEN_BODY }),
      part({ size: [3, 2, 3], pivot: [0, 13, -8.5], role: AnimationRole.Head, colour: CHICKEN_BEAK }),
      part({ size: [2, 3, 2], pivot: [0, 16.5, -6], role: AnimationRole.Head, colour: 0xd6373a }),
      part({ size: [1, 6, 8], pivot: [-4, 9, 0], role: AnimationRole.LimbB, colour: 0xe6e2da }),
      part({ size: [1, 6, 8], pivot: [4, 9, 0], role: AnimationRole.LimbA, colour: 0xe6e2da }),
      part({
        size: [2, 4, 2],
        pivot: [-2, 4, 0],
        centre: [0, -2, 0],
        role: AnimationRole.LimbA,
        colour: CHICKEN_BEAK,
      }),
      part({
        size: [2, 4, 2],
        pivot: [2, 4, 0],
        centre: [0, -2, 0],
        role: AnimationRole.LimbB,
        colour: CHICKEN_BEAK,
      }),
    ]),
  }),

  [EntityTypeId.Sheep]: Object.freeze({
    swingAmplitude: 0.5,
    parts: Object.freeze([
      part({ size: [13, 13, 19], pivot: [0, 17, 0], colour: SHEEP_WOOL }),
      part({ size: [7, 7, 7], pivot: [0, 19, -12], role: AnimationRole.Head, colour: SHEEP_SKIN }),
      part({ size: [8, 6, 4], pivot: [0, 21, -11], role: AnimationRole.Head, colour: SHEEP_WOOL }),
      ...quadrupedLegs(4, 11, 4, 6, 11, SHEEP_SKIN),
    ]),
  }),

  [EntityTypeId.Zombie]: Object.freeze({
    swingAmplitude: 0.72,
    parts: Object.freeze([
      part({ size: [8, 12, 4], pivot: [0, 18, 0], colour: ZOMBIE_SHIRT }),
      part({ size: [8, 8, 8], pivot: [0, 28, 0], role: AnimationRole.Head, colour: ZOMBIE_SKIN }),
      // Arms held out in front, the classic silhouette.
      part({
        size: [4, 12, 4],
        pivot: [-6, 23, 0],
        centre: [0, -6, 0],
        rotation: [-Math.PI / 2, 0, 0],
        role: AnimationRole.LimbB,
        colour: ZOMBIE_SKIN,
        swingScale: 0.4,
      }),
      part({
        size: [4, 12, 4],
        pivot: [6, 23, 0],
        centre: [0, -6, 0],
        rotation: [-Math.PI / 2, 0, 0],
        role: AnimationRole.LimbA,
        colour: ZOMBIE_SKIN,
        swingScale: 0.4,
      }),
      part({
        size: [4, 12, 4],
        pivot: [-2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbA,
        colour: ZOMBIE_LEGS,
      }),
      part({
        size: [4, 12, 4],
        pivot: [2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbB,
        colour: ZOMBIE_LEGS,
      }),
    ]),
  }),

  [EntityTypeId.Spider]: Object.freeze({
    swingAmplitude: 0.36,
    parts: Object.freeze([
      part({ size: [10, 8, 12], pivot: [0, 9, 5], colour: SPIDER_BODY }),
      part({ size: [8, 8, 6], pivot: [0, 9, -3], colour: 0x342b27 }),
      part({ size: [8, 6, 8], pivot: [0, 9, -8], role: AnimationRole.Head, colour: SPIDER_BODY }),
      part({ size: [2, 2, 1], pivot: [-2, 11, -12], role: AnimationRole.Head, colour: SPIDER_EYES }),
      part({ size: [2, 2, 1], pivot: [2, 11, -12], role: AnimationRole.Head, colour: SPIDER_EYES }),
      ...spiderLegs(0x231d1a),
    ]),
  }),

  [EntityTypeId.RemotePlayer]: Object.freeze({
    swingAmplitude: 0.72,
    parts: Object.freeze([
      part({ size: [8, 12, 4], pivot: [0, 18, 0], colour: PLAYER_SHIRT }),
      part({
        size: [8, 8, 8],
        pivot: [0, 28, 0],
        role: AnimationRole.Head,
        colour: PLAYER_SKIN,
      }),
      part({
        size: [4, 12, 4],
        pivot: [-6, 23, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbB,
        colour: PLAYER_SKIN,
      }),
      part({
        size: [4, 12, 4],
        pivot: [6, 23, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbA,
        colour: PLAYER_SKIN,
      }),
      part({
        size: [4, 12, 4],
        pivot: [-2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbA,
        colour: PLAYER_LEGS,
      }),
      part({
        size: [4, 12, 4],
        pivot: [2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbB,
        colour: PLAYER_LEGS,
      }),
    ]),
  }),

  [EntityTypeId.Skeleton]: Object.freeze({
    swingAmplitude: 0.72,
    parts: Object.freeze([
      part({ size: [8, 12, 4], pivot: [0, 18, 0], colour: SKELETON_SHADOW }),
      part({ size: [8, 8, 8], pivot: [0, 28, 0], role: AnimationRole.Head, colour: SKELETON_BONE }),
      part({ size: [2, 2, 1], pivot: [-2, 29, -4.5], role: AnimationRole.Head, colour: 0x242424 }),
      part({ size: [2, 2, 1], pivot: [2, 29, -4.5], role: AnimationRole.Head, colour: 0x242424 }),
      part({
        size: [3, 12, 3],
        pivot: [-5.5, 23, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbB,
        colour: SKELETON_BONE,
      }),
      part({
        size: [3, 12, 3],
        pivot: [5.5, 23, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbA,
        colour: SKELETON_BONE,
      }),
      part({
        size: [3, 12, 3],
        pivot: [-2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbA,
        colour: SKELETON_BONE,
      }),
      part({
        size: [3, 12, 3],
        pivot: [2, 12, 0],
        centre: [0, -6, 0],
        role: AnimationRole.LimbB,
        colour: SKELETON_BONE,
      }),
    ]),
  }),

  [EntityTypeId.Creeper]: Object.freeze({
    swingAmplitude: 0.45,
    parts: Object.freeze([
      part({ size: [8, 12, 4], pivot: [0, 14, 0], colour: CREEPER_GREEN }),
      part({ size: [8, 8, 8], pivot: [0, 24, 0], role: AnimationRole.Head, colour: CREEPER_GREEN }),
      part({ size: [2, 2, 1], pivot: [-2, 25, -4.5], role: AnimationRole.Head, colour: CREEPER_DARK }),
      part({ size: [2, 2, 1], pivot: [2, 25, -4.5], role: AnimationRole.Head, colour: CREEPER_DARK }),
      part({ size: [3, 3, 1], pivot: [0, 21.5, -4.5], role: AnimationRole.Head, colour: CREEPER_DARK }),
      ...quadrupedLegs(4, 6, 2, 2, 6, 0x4f8839),
    ]),
  }),

  [EntityTypeId.CaveSpider]: Object.freeze({
    swingAmplitude: 0.42,
    parts: Object.freeze([
      part({ size: [8, 5, 9], pivot: [0, 5, 4], colour: CAVE_SPIDER_BODY }),
      part({ size: [7, 5, 5], pivot: [0, 5, -3], colour: 0x21464d }),
      part({ size: [6, 4, 6], pivot: [0, 5, -7], role: AnimationRole.Head, colour: CAVE_SPIDER_BODY }),
      part({ size: [2, 1, 1], pivot: [-1.7, 6, -10.5], role: AnimationRole.Head, colour: CAVE_SPIDER_EYES }),
      part({ size: [2, 1, 1], pivot: [1.7, 6, -10.5], role: AnimationRole.Head, colour: CAVE_SPIDER_EYES }),
      ...spiderLegs(0x162f35),
    ]),
  }),
});

export function modelFor(type: EntityTypeId): EntityModel {
  return MODELS[type] ?? MODELS[EntityTypeId.Pig];
}

export const MODELLED_TYPES: readonly EntityTypeId[] = Object.freeze(
  Object.values(EntityTypeId) as EntityTypeId[],
);
