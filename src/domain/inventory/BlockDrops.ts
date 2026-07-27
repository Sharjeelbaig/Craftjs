import { BlockId, BlockRegistry } from '../world/BlockType';
import { blockItem, catalogItem, type ItemId } from './Item';

/**
 * What a broken block hands the player.
 *
 * Lives in the inventory layer rather than the block registry because blocks
 * must not know that items exist — the dependency runs inventory -> world, and
 * inverting it for four ore entries would couple terrain to the catalogue.
 */
const ITEM_OVERRIDES: Readonly<Partial<Record<BlockId, ItemId>>> = Object.freeze({
  [BlockId.CoalOre]: catalogItem('coal'),
  [BlockId.IronOre]: catalogItem('iron-ingot'),
  [BlockId.GoldOre]: catalogItem('gold-ingot'),
  [BlockId.DiamondOre]: catalogItem('diamond'),
});

/**
 * The item a mined block yields, or null when it yields nothing.
 *
 * Ore hands over its resource directly: without a furnace in the catalogue,
 * dropping an unusable ore block would make the whole mining tier chain a
 * dead end.
 */
export function blockDrop(block: number): ItemId | null {
  const override = ITEM_OVERRIDES[block as BlockId];
  if (override !== undefined) return override;

  const drops = BlockRegistry.get(block).drops;
  return drops === null ? null : blockItem(drops);
}
