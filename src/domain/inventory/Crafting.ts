import { BlockId } from '../world/BlockType';
import { blockItem, type ItemId } from './Item';
import type { Inventory } from './Inventory';

export interface Ingredient {
  readonly item: ItemId;
  readonly count: number;
}

export interface CraftingRecipe {
  readonly id: string;
  readonly name: string;
  readonly inputs: readonly Ingredient[];
  readonly output: Ingredient;
}

export const RECIPES: readonly CraftingRecipe[] = Object.freeze([
  {
    id: 'planks',
    name: 'Planks ×4',
    inputs: [{ item: blockItem(BlockId.Log), count: 1 }],
    output: { item: blockItem(BlockId.Planks), count: 4 },
  },
  {
    id: 'cobblestone',
    name: 'Cobblestone ×4',
    inputs: [{ item: blockItem(BlockId.Stone), count: 4 }],
    output: { item: blockItem(BlockId.Cobblestone), count: 4 },
  },
  {
    id: 'bricks',
    name: 'Bricks ×4',
    inputs: [
      { item: blockItem(BlockId.Dirt), count: 2 },
      { item: blockItem(BlockId.Stone), count: 2 },
    ],
    output: { item: blockItem(BlockId.Brick), count: 4 },
  },
  {
    id: 'glass',
    name: 'Glass ×4',
    inputs: [{ item: blockItem(BlockId.Sand), count: 4 }],
    output: { item: blockItem(BlockId.Glass), count: 4 },
  },
]);

export function canCraft(inventory: Inventory, recipe: CraftingRecipe): boolean {
  return recipe.inputs.every((input) => inventory.has(input.item, input.count));
}

/** Consumes all inputs or none, then adds the output. */
export function craft(inventory: Inventory, recipe: CraftingRecipe): boolean {
  if (!canCraft(inventory, recipe)) return false;
  for (const input of recipe.inputs) inventory.remove(input.item, input.count);
  inventory.add(recipe.output.item, recipe.output.count);
  return true;
}
