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
  Chest: 14,
  CoalOre: 15,
  IronOre: 16,
  GoldOre: 17,
  DiamondOre: 18,
  Rail: 19,
  Bed: 20,
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
  Chest: 15,
  CoalOre: 16,
  IronOre: 17,
  GoldOre: 18,
  DiamondOre: 19,
  Rail: 20,
  BedTop: 21,
  BedSide: 22,
} as const;

export type TextureId = (typeof TextureId)[keyof typeof TextureId];

export const TEXTURE_COUNT = 23;

/** Face order used everywhere: +X, -X, +Y, -Y, +Z, -Z. */
export type FaceTextures = readonly [
  posX: number,
  negX: number,
  posY: number,
  negY: number,
  posZ: number,
  negZ: number,
];

/**
 * What a block is made of.
 *
 * Drives which tool class mines it quickly, so the rule lives with the block
 * rather than being restated in the mining code for every new block type.
 */
export const BlockMaterial = {
  /** Shovel work: dirt, sand, snow. */
  Loose: 'loose',
  /** Pickaxe work: stone, ore, brick, rail. */
  Rock: 'rock',
  /** Axe work: log, planks, bed. */
  Wood: 'wood',
  /** Nothing speeds these up meaningfully. */
  Soft: 'soft',
  /** Unbreakable or non-physical. */
  None: 'none',
} as const;

export type BlockMaterial = (typeof BlockMaterial)[keyof typeof BlockMaterial];

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
  /** Which tool class mines this quickly. */
  readonly material: BlockMaterial;
  /**
   * Minimum tool tier that yields a drop at all. Zero means bare hands work.
   * Mining above this level is faster; mining below it still breaks the block
   * but returns nothing, which is what makes tool progression matter.
   */
  readonly harvestLevel: number;
  /**
   * Block this yields when mined, when it differs from itself — stone gives
   * cobblestone. Null means the block drops no block item.
   */
  readonly drops: BlockId | null;
  /**
   * Fraction of a cell this block occupies vertically, for blocks that are
   * visibly flatter than a full cube. Always 1 for anything solid, because
   * collision is whole-voxel.
   */
  readonly renderHeight: number;
  /** Requires a solid block underneath to exist; breaks when unsupported. */
  readonly needsSupport: boolean;
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
  material?: BlockMaterial;
  harvestLevel?: number;
  drops?: BlockId | null;
  renderHeight?: number;
  needsSupport?: boolean;
}

function define(
  id: BlockId,
  name: string,
  textures: FaceTextures,
  options: BlockOptions = {},
): BlockDefinition {
  const solid = options.solid ?? true;
  return Object.freeze({
    id,
    name,
    textures,
    solid,
    opaque: options.opaque ?? true,
    translucent: options.translucent ?? false,
    liquid: options.liquid ?? false,
    indestructible: options.indestructible ?? false,
    replaceable: options.replaceable ?? false,
    hardness: options.hardness ?? 0.75,
    material: options.material ?? BlockMaterial.Soft,
    harvestLevel: options.harvestLevel ?? 0,
    drops: options.drops === undefined ? id : options.drops,
    // Collision is whole-voxel, so only a pass-through block may render short
    // without the player appearing to float above or sink into it.
    renderHeight: solid ? 1 : (options.renderHeight ?? 1),
    needsSupport: options.needsSupport ?? false,
  });
}

const DEFINITIONS: readonly BlockDefinition[] = Object.freeze([
  define(BlockId.Air, 'Air', uniform(TextureId.Stone), {
    solid: false,
    opaque: false,
    replaceable: true,
    hardness: 0,
    material: BlockMaterial.None,
    drops: null,
  }),
  // Stone-family blocks are deliberately slow by hand: mining time is the
  // main pacing mechanism survival mode has.
  define(BlockId.Stone, 'Stone', uniform(TextureId.Stone), {
    hardness: 3.2,
    material: BlockMaterial.Rock,
    harvestLevel: 1,
    drops: BlockId.Cobblestone,
  }),
  define(BlockId.Dirt, 'Dirt', uniform(TextureId.Dirt), {
    hardness: 0.65,
    material: BlockMaterial.Loose,
  }),
  define(
    BlockId.Grass,
    'Grass Block',
    column(TextureId.GrassSide, TextureId.GrassTop, TextureId.Dirt),
    { hardness: 0.75, material: BlockMaterial.Loose, drops: BlockId.Dirt },
  ),
  define(BlockId.Sand, 'Sand', uniform(TextureId.Sand), {
    hardness: 0.6,
    material: BlockMaterial.Loose,
  }),
  define(BlockId.Water, 'Water', uniform(TextureId.Water), {
    solid: false,
    opaque: false,
    translucent: true,
    liquid: true,
    indestructible: true,
    replaceable: true,
    material: BlockMaterial.None,
    drops: null,
  }),
  define(BlockId.Log, 'Log', column(TextureId.LogSide, TextureId.LogTop, TextureId.LogTop), {
    hardness: 2,
    material: BlockMaterial.Wood,
  }),
  define(BlockId.Leaves, 'Leaves', uniform(TextureId.Leaves), { hardness: 0.3 }),
  define(BlockId.Planks, 'Planks', uniform(TextureId.Planks), {
    hardness: 1.8,
    material: BlockMaterial.Wood,
  }),
  define(BlockId.Cobblestone, 'Cobblestone', uniform(TextureId.Cobblestone), {
    hardness: 3.4,
    material: BlockMaterial.Rock,
    harvestLevel: 1,
  }),
  define(BlockId.Glass, 'Glass', uniform(TextureId.Glass), {
    opaque: false,
    translucent: true,
    hardness: 0.4,
    // Glass shatters: breaking it returns nothing, tool or not.
    drops: null,
  }),
  define(BlockId.Bedrock, 'Bedrock', uniform(TextureId.Bedrock), {
    indestructible: true,
    hardness: Infinity,
    material: BlockMaterial.None,
    drops: null,
  }),
  define(BlockId.Snow, 'Snow', uniform(TextureId.Snow), {
    hardness: 0.3,
    material: BlockMaterial.Loose,
  }),
  define(BlockId.Brick, 'Bricks', uniform(TextureId.Brick), {
    hardness: 3.4,
    material: BlockMaterial.Rock,
    harvestLevel: 1,
  }),
  define(BlockId.Chest, 'Starter Chest', uniform(TextureId.Chest), {
    indestructible: true,
    hardness: Infinity,
    material: BlockMaterial.None,
    drops: null,
  }),
  // Ore hardness rises with tier so a better pickaxe is felt, not just read.
  define(BlockId.CoalOre, 'Coal Ore', uniform(TextureId.CoalOre), {
    hardness: 4.2,
    material: BlockMaterial.Rock,
    harvestLevel: 1,
  }),
  define(BlockId.IronOre, 'Iron Ore', uniform(TextureId.IronOre), {
    hardness: 5,
    material: BlockMaterial.Rock,
    harvestLevel: 2,
  }),
  define(BlockId.GoldOre, 'Gold Ore', uniform(TextureId.GoldOre), {
    hardness: 5,
    material: BlockMaterial.Rock,
    harvestLevel: 3,
  }),
  define(BlockId.DiamondOre, 'Diamond Ore', uniform(TextureId.DiamondOre), {
    hardness: 5.6,
    material: BlockMaterial.Rock,
    harvestLevel: 3,
  }),
  // Rails carry no collision, so the minecart and the player both sit on the
  // block beneath them and the flat plate is purely visual.
  define(BlockId.Rail, 'Rail', uniform(TextureId.Rail), {
    solid: false,
    opaque: false,
    hardness: 0.9,
    material: BlockMaterial.Rock,
    renderHeight: 1 / 16,
    needsSupport: true,
  }),
  define(BlockId.Bed, 'Bed', column(TextureId.BedSide, TextureId.BedTop, TextureId.Planks), {
    hardness: 0.4,
    material: BlockMaterial.Wood,
    needsSupport: true,
  }),
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

  renderHeight(id: number): number {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).renderHeight;
  },

  needsSupport(id: number): boolean {
    return (DEFINITIONS[id] ?? AIR_DEFINITION).needsSupport;
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
