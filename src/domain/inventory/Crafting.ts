import { BlockId } from '../world/BlockType';
import { ResourceItemId, blockItem, catalogItem, resourceItem, type ItemId } from './Item';
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

const STICK = catalogItem('stick');

/**
 * Materials a tool set can be made from, in progression order.
 *
 * The head material is what the recipe consumes; the tier it unlocks lives in
 * `Tool.ts`, so adding a set here cannot silently change what it can mine.
 */
const TOOL_MATERIALS = Object.freeze([
  Object.freeze({ name: 'Wooden', prefix: 'wooden', head: blockItem(BlockId.Planks) }),
  Object.freeze({ name: 'Stone', prefix: 'stone', head: blockItem(BlockId.Cobblestone) }),
  Object.freeze({ name: 'Iron', prefix: 'iron', head: catalogItem('iron-ingot') }),
  Object.freeze({ name: 'Diamond', prefix: 'diamond', head: catalogItem('diamond') }),
] as const);

/** Head and handle cost per tool class, matching the shapes players expect. */
const TOOL_SHAPES = Object.freeze([
  Object.freeze({ suffix: 'pickaxe', label: 'Pickaxe', heads: 3, sticks: 2 }),
  Object.freeze({ suffix: 'sword', label: 'Sword', heads: 2, sticks: 1 }),
  Object.freeze({ suffix: 'axe', label: 'Axe', heads: 3, sticks: 2 }),
  Object.freeze({ suffix: 'shovel', label: 'Shovel', heads: 1, sticks: 2 }),
] as const);

/**
 * The full tool grid, four materials by four shapes.
 *
 * Item ids are assembled from the same `<material>-<shape>` convention the
 * catalogue and `Tool.ts` use, and the template literal type makes a typo a
 * compile error rather than a recipe that produces nothing.
 */
function toolRecipes(): CraftingRecipe[] {
  const recipes: CraftingRecipe[] = [];
  for (const material of TOOL_MATERIALS) {
    for (const shape of TOOL_SHAPES) {
      const id = `${material.prefix}-${shape.suffix}` as const;
      recipes.push({
        id,
        name: `${material.name} ${shape.label}`,
        inputs: [
          { item: material.head, count: shape.heads },
          { item: STICK, count: shape.sticks },
        ],
        output: { item: catalogItem(id), count: 1 },
      });
    }
  }
  return recipes;
}

export const RECIPES: readonly CraftingRecipe[] = Object.freeze([
  {
    id: 'planks',
    name: 'Planks ×4',
    inputs: [{ item: blockItem(BlockId.Log), count: 1 }],
    output: { item: blockItem(BlockId.Planks), count: 4 },
  },
  {
    id: 'sticks',
    name: 'Sticks ×4',
    inputs: [{ item: blockItem(BlockId.Planks), count: 1 }],
    output: { item: STICK, count: 4 },
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
  ...toolRecipes(),
  {
    id: 'rail',
    name: 'Rails ×8',
    inputs: [
      { item: catalogItem('iron-ingot'), count: 6 },
      { item: STICK, count: 1 },
    ],
    output: { item: blockItem(BlockId.Rail), count: 8 },
  },
  {
    id: 'minecart',
    name: 'Minecart',
    inputs: [{ item: catalogItem('iron-ingot'), count: 5 }],
    output: { item: catalogItem('minecart'), count: 1 },
  },
  {
    id: 'bed',
    name: 'Bed',
    inputs: [
      { item: blockItem(BlockId.Planks), count: 3 },
      { item: resourceItem(ResourceItemId.Wool), count: 3 },
    ],
    output: { item: blockItem(BlockId.Bed), count: 1 },
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
