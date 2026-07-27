import { BlockMaterial, BlockRegistry } from '../world/BlockType';
import { itemDefinition, type ItemId } from './Item';

/**
 * Tool progression.
 *
 * The catalogue already ships every tool as an inventory item; this is the
 * layer that gives them mechanical meaning. Speed, reach into harder blocks and
 * melee damage are all derived from one `(class, material)` pair, so a new tool
 * is a naming convention rather than a new branch in the mining code.
 */

export const ToolClass = {
  Pickaxe: 'pickaxe',
  Axe: 'axe',
  Shovel: 'shovel',
  Sword: 'sword',
  Shears: 'shears',
  Hoe: 'hoe',
} as const;

export type ToolClass = (typeof ToolClass)[keyof typeof ToolClass];

export const ToolMaterial = {
  Wood: 'wooden',
  Stone: 'stone',
  Iron: 'iron',
  Gold: 'golden',
  Diamond: 'diamond',
} as const;

export type ToolMaterial = (typeof ToolMaterial)[keyof typeof ToolMaterial];

export interface MaterialTier {
  /** Multiplier on mining speed against blocks this tool class suits. */
  readonly speed: number;
  /**
   * Highest `harvestLevel` this material can collect. Gold is deliberately
   * fast but weak, matching the era this catalogue is drawn from.
   */
  readonly harvestLevel: number;
  /** Melee damage bonus added on top of the tool class's own damage. */
  readonly damageBonus: number;
}

const TIERS: Readonly<Record<ToolMaterial, MaterialTier>> = Object.freeze({
  [ToolMaterial.Wood]: Object.freeze({ speed: 2, harvestLevel: 1, damageBonus: 0 }),
  [ToolMaterial.Gold]: Object.freeze({ speed: 12, harvestLevel: 1, damageBonus: 0 }),
  [ToolMaterial.Stone]: Object.freeze({ speed: 4, harvestLevel: 2, damageBonus: 1 }),
  [ToolMaterial.Iron]: Object.freeze({ speed: 6, harvestLevel: 3, damageBonus: 2 }),
  [ToolMaterial.Diamond]: Object.freeze({ speed: 8, harvestLevel: 4, damageBonus: 3 }),
});

/**
 * Damage each tool class deals before its material bonus.
 *
 * A bare hand deals `PLAYER_ATTACK_DAMAGE`, so every entry here is at or above
 * that: picking up any tool must never make the player weaker than throwing a
 * punch, which is the kind of inversion players notice immediately.
 */
const CLASS_DAMAGE: Readonly<Record<ToolClass, number>> = Object.freeze({
  [ToolClass.Sword]: 5,
  [ToolClass.Axe]: 4,
  [ToolClass.Pickaxe]: 3,
  [ToolClass.Shovel]: 3,
  [ToolClass.Shears]: 3,
  [ToolClass.Hoe]: 3,
});

/** Block material each tool class is the right instrument for. */
const CLASS_TARGET: Readonly<Record<ToolClass, BlockMaterial | null>> = Object.freeze({
  [ToolClass.Pickaxe]: BlockMaterial.Rock,
  [ToolClass.Axe]: BlockMaterial.Wood,
  [ToolClass.Shovel]: BlockMaterial.Loose,
  [ToolClass.Sword]: null,
  [ToolClass.Shears]: null,
  [ToolClass.Hoe]: null,
});

export interface ToolProfile {
  readonly toolClass: ToolClass;
  readonly material: ToolMaterial;
  readonly tier: MaterialTier;
}

const CLASS_BY_SUFFIX = new Map<string, ToolClass>(
  Object.values(ToolClass).map((entry) => [entry, entry]),
);
const MATERIAL_BY_PREFIX = new Map<string, ToolMaterial>(
  Object.values(ToolMaterial).map((entry) => [entry, entry]),
);

/**
 * Reads a tool out of an item id, or null when the item is not a tool.
 *
 * Tool items are named `<material>-<class>` throughout the catalogue, so the
 * profile is derived from the id rather than duplicated in a table that could
 * fall out of step with it.
 */
export function toolProfile(item: ItemId | null): ToolProfile | null {
  if (item === null) return null;
  const definition = itemDefinition(item);
  if (definition === null || definition.kind !== 'tool') return null;

  const raw = definition.id.slice('item:'.length);
  const separator = raw.indexOf('-');
  if (separator < 0) return null;

  const material = MATERIAL_BY_PREFIX.get(raw.slice(0, separator));
  const toolClass = CLASS_BY_SUFFIX.get(raw.slice(separator + 1));
  if (material === undefined || toolClass === undefined) return null;

  return { toolClass, material, tier: TIERS[material] };
}

/** Highest `harvestLevel` the held item can collect a drop from. */
export function harvestLevelOf(item: ItemId | null): number {
  return toolProfile(item)?.tier.harvestLevel ?? 0;
}

/**
 * Whether mining this block with this item yields its drop.
 *
 * Breaking always succeeds; only the reward is gated. Silently refusing to
 * break the block would read as a bug, while an empty-handed break that
 * produces nothing reads as the lesson it is.
 */
export function canHarvest(item: ItemId | null, block: number): boolean {
  return harvestLevelOf(item) >= BlockRegistry.get(block).harvestLevel;
}

/**
 * Mining speed multiplier for an item against a block.
 *
 * The right tool class multiplies by its material speed; the wrong tool is no
 * better than bare hands, and a tool too weak to harvest the block is slowed
 * further so the player feels the mismatch before the empty drop confirms it.
 */
export function miningSpeedFor(item: ItemId | null, block: number): number {
  const definition = BlockRegistry.get(block);
  const profile = toolProfile(item);
  if (profile === null) return definition.harvestLevel > 0 ? 0.35 : 1;

  const suits = CLASS_TARGET[profile.toolClass] === definition.material;
  const speed = suits ? profile.tier.speed : 1;
  return profile.tier.harvestLevel >= definition.harvestLevel ? speed : speed * 0.35;
}

/** Melee damage for the held item, or null when it is not a weapon. */
export function attackDamageFor(item: ItemId | null): number | null {
  const profile = toolProfile(item);
  if (profile === null) return null;
  return CLASS_DAMAGE[profile.toolClass] + profile.tier.damageBonus;
}
