import { ToolClass } from '@domain/inventory/Tool';

/**
 * Box models for the item in the player's hand.
 *
 * Built from boxes for the same reason creatures are: the look matches the
 * world, and nothing has to be loaded, decoded or kept in sync with an external
 * sprite sheet. Dimensions are in texture pixels (16 per block), the unit the
 * proportions read naturally in.
 */
const PIXEL = 1 / 16;

export interface HeldPart {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Centre offset from the model origin, in blocks. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  /** Packed 0xRRGGBB, or null to take the item's own colour. */
  readonly colour: number | null;
}

interface PartSpec {
  size: [number, number, number];
  offset: [number, number, number];
  colour?: number;
}

function part(spec: PartSpec): HeldPart {
  const [sx, sy, sz] = spec.size;
  const [ox, oy, oz] = spec.offset;
  return Object.freeze({
    sizeX: sx * PIXEL,
    sizeY: sy * PIXEL,
    sizeZ: sz * PIXEL,
    offsetX: ox * PIXEL,
    offsetY: oy * PIXEL,
    offsetZ: oz * PIXEL,
    colour: spec.colour ?? null,
  });
}

const HANDLE = 0x7a5732;
const HANDLE_DARK = 0x5f4426;

/** Metal colour per tool material, so the tier is visible at a glance. */
const MATERIAL_COLOURS: Readonly<Record<string, number>> = Object.freeze({
  wooden: 0xa2763f,
  stone: 0x8f8f92,
  iron: 0xd8d8d8,
  golden: 0xf0c93c,
  diamond: 0x54e0d8,
});

/**
 * Tools are modelled along the diagonal the sprite versions are drawn on, so
 * the silhouette in hand matches the icon in the hotbar.
 */
const TOOL_MODELS: Readonly<Record<string, readonly HeldPart[]>> = Object.freeze({
  [ToolClass.Sword]: Object.freeze([
    part({ size: [2, 2, 10], offset: [0, 0, -3] }),
    part({ size: [6, 2, 2], offset: [0, 0, 2], colour: HANDLE_DARK }),
    part({ size: [2, 2, 5], offset: [0, 0, 5], colour: HANDLE }),
  ]),
  [ToolClass.Pickaxe]: Object.freeze([
    part({ size: [2, 2, 12], offset: [0, 0, 2], colour: HANDLE }),
    part({ size: [11, 2, 2], offset: [0, 0, -4] }),
    part({ size: [3, 2, 3], offset: [-4, 0, -2.5] }),
    part({ size: [3, 2, 3], offset: [4, 0, -2.5] }),
  ]),
  [ToolClass.Axe]: Object.freeze([
    part({ size: [2, 2, 12], offset: [0, 0, 2], colour: HANDLE }),
    part({ size: [5, 2, 6], offset: [2.5, 0, -3] }),
    part({ size: [2, 2, 8], offset: [1, 0, -3] }),
  ]),
  [ToolClass.Shovel]: Object.freeze([
    part({ size: [2, 2, 12], offset: [0, 0, 2], colour: HANDLE }),
    part({ size: [5, 2, 5], offset: [0, 0, -5] }),
  ]),
  [ToolClass.Hoe]: Object.freeze([
    part({ size: [2, 2, 12], offset: [0, 0, 2], colour: HANDLE }),
    part({ size: [7, 2, 2], offset: [2, 0, -4] }),
  ]),
  [ToolClass.Shears]: Object.freeze([
    part({ size: [2, 2, 9], offset: [-1.5, 0, -1] }),
    part({ size: [2, 2, 9], offset: [1.5, 0, -1] }),
    part({ size: [5, 2, 2], offset: [0, 0, 4], colour: HANDLE_DARK }),
  ]),
});

/** A flat slab, used for every resource and food item. */
const GENERIC_ITEM: readonly HeldPart[] = Object.freeze([
  part({ size: [8, 2, 8], offset: [0, 0, 0] }),
]);

export interface HeldItemModel {
  readonly parts: readonly HeldPart[];
  /** Colour for parts that did not name one of their own. */
  readonly tint: number;
}

/**
 * Picks the model for a tool class, or the generic slab for anything else.
 *
 * `material` names the tool tier and supplies the metal colour; unknown
 * materials fall back to iron rather than rendering an invisible item.
 */
export function heldToolModel(toolClass: string, material: string): HeldItemModel {
  const parts = TOOL_MODELS[toolClass] ?? GENERIC_ITEM;
  return { parts, tint: MATERIAL_COLOURS[material] ?? MATERIAL_COLOURS.iron };
}

export function heldGenericModel(colour: number): HeldItemModel {
  return { parts: GENERIC_ITEM, tint: colour };
}
