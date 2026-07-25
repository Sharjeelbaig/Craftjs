/**
 * The block catalogue.
 *
 * Ids are persisted to disk, so existing values are frozen forever: append new
 * blocks, never renumber. `BlockRegistry` is the single source of truth for
 * every rule the renderer, physics and gameplay code needs.
 */

export const BlockId = {
  Air: 0,
  Stone: 1,
  Dirt: 2,
  Grass: 3,
  Sand: 4,
  Water: 5,
  Log: 6,
  Leaves: 7,
  Planks: 8,
  Cobblestone: 9,
  Glass: 10,
  Bedrock: 11,
  Snow: 12,
  Brick: 13,
} as const;

export type BlockId = (typeof BlockId)[keyof typeof BlockId];

/** Indices into the texture array built by the renderer's atlas. */
export const TextureId = {
  Stone: 0,
  Dirt: 1,
  GrassTop: 2,
  GrassSide: 3,
  Sand: 4,
  Water: 5,
  LogSide: 6,
  LogTop: 7,
  Leaves: 8,
  Planks: 9,
  Cobblestone: 10,
  Glass: 11,
  Bedrock: 12,
  Snow: 13,
  Brick: 14,
} as const;

export type TextureId = (typeof TextureId)[keyof typeof TextureId];

export const TEXTURE_COUNT = 15;

/** Face order used everywhere: +X, -X, +Y, -Y, +Z, -Z. */
export type FaceTextures = readonly [
  posX: number,
  negX: number,
  posY: number,
  negY: number,
  posZ: number,
  negZ: number,
];

export interface BlockDefinition {
  readonly id: BlockId;
  readonly name: string;
  /** Blocks player movement. */
  readonly solid: boolean;
  /** Fully hides the neighbouring face behind it (drives face culling and AO). */
  readonly opaque: boolean;
  /** Rendered in the alpha-blended pass. */
  readonly translucent: boolean;
  /** Behaves as a fluid: swimmable, replaceable when building. */
  readonly liquid: boolean;
  /** Cannot be broken by the player. */
  readonly indestructible: boolean;
  /** Can be overwritten by placing another block into its cell. */
  readonly replaceable: boolean;
  /** Seconds to break by hand in survival. Zero means instant. */
  readonly hardness: number;
  readonly textures: FaceTextures;
}

const uniform = (texture: number): FaceTextures => [
  texture,
  texture,
  texture,
  texture,
  texture,
  texture,
];

const column = (side: number, top: number, bottom: number): FaceTextures => [
  side,
  side,
  top,
  bottom,
  side,
  side,
];

interface BlockOptions {
  solid?: boolean;
  opaque?: boolean;
  translucent?: boolean;
  liquid?: boolean;
  indestructible?: boolean;
  replaceable?: boolean;
  hardness?: number;
}

function define(
  id: BlockId,
  name: string,
  textures: FaceTextures,
  options: BlockOptions = {},
): BlockDefinition {
  return Object.freeze({
    id,
    name,
    textures,
    solid: options.solid ?? true,
    opaque: options.opaque ?? true,
    translucent: options.translucent ?? false,
    liquid: options.liquid ?? false,
    indestructible: options.indestructible ?? false,
    replaceable: options.replaceable ?? false,
    hardness: options.hardness ?? 0.75,
  });
}

const DEFINITIONS: readonly BlockDefinition[] = Object.freeze([
  define(BlockId.Air, 'Air', uniform(TextureId.Stone), {
    solid: false,
    opaque: false,
    replaceable: true,
    hardness: 0,
  }),
  // Stone-family blocks are deliberately slow by hand: mining time is the
  // main pacing mechanism survival mode has.
  define(BlockId.Stone, 'Stone', uniform(TextureId.Stone), { hardness: 3.2 }),
  define(BlockId.Dirt, 'Dirt', uniform(TextureId.Dirt), { hardness: 0.65 }),
  define(
    BlockId.Grass,
    'Grass Block',
    column(TextureId.GrassSide, TextureId.GrassTop, TextureId.Dirt),
    { hardness: 0.75 },
  ),
  define(BlockId.Sand, 'Sand', uniform(TextureId.Sand), { hardness: 0.6 }),
  define(BlockId.Water, 'Water', uniform(TextureId.Water), {
    solid: false,
    opaque: false,
    translucent: true,
    liquid: true,
    indestructible: true,
    replaceable: true,
  }),
  define(BlockId.Log, 'Log', column(TextureId.LogSide, TextureId.LogTop, TextureId.LogTop), {
    hardness: 2,
  }),
  define(BlockId.Leaves, 'Leaves', uniform(TextureId.Leaves), { hardness: 0.3 }),
  define(BlockId.Planks, 'Planks', uniform(TextureId.Planks), { hardness: 1.8 }),
  define(BlockId.Cobblestone, 'Cobblestone', uniform(TextureId.Cobblestone), {
    hardness: 3.4,
  }),
  define(BlockId.Glass, 'Glass', uniform(TextureId.Glass), {
    opaque: false,
    translucent: true,
    hardness: 0.4,
  }),
  define(BlockId.Bedrock, 'Bedrock', uniform(TextureId.Bedrock), {
    indestructible: true,
    hardness: Infinity,
  }),
  define(BlockId.Snow, 'Snow', uniform(TextureId.Snow), { hardness: 0.3 }),
  define(BlockId.Brick, 'Bricks', uniform(TextureId.Brick), { hardness: 3.4 }),
]);

const AIR_DEFINITION = DEFINITIONS[BlockId.Air];

export const BlockRegistry = {
  /**
   * Never throws: unknown ids (corrupt saves, future block types) degrade to
   * air rather than crashing the render or physics loop.
   */
  get(id: number): BlockDefinition {
    return DEFINITIONS[id] ?? AIR_DEFINITION;
  },

  isSolid(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).solid;
  },

  isOpaque(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).opaque;
  },

  isTranslucent(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).translucent;
  },

  isLiquid(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).liquid;
  },

  isReplaceable(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).replaceable;
  },

  isKnown(id: number): boolean {
    return DEFINITIONS[id] !== undefined;
  },

  hardness(id: number): number {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).hardness;
  },

  all(): readonly BlockDefinition[] {
    return DEFINITIONS;
  },
} as const;

/** Blocks offered on the hotbar, in slot order. */
export const HOTBAR_BLOCKS: readonly BlockId[] = Object.freeze([
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.Cobblestone,
  BlockId.Sand,
  BlockId.Log,
  BlockId.Planks,
  BlockId.Leaves,
  BlockId.Glass,
]);
