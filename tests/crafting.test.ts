import { describe, expect, it } from 'vitest';
import { RECIPES, canCraft, craft } from '@domain/inventory/Crafting';
import { Inventory } from '@domain/inventory/Inventory';
import { blockItem, catalogItem, itemDefinition, resourceItem, ResourceItemId } from '@domain/inventory/Item';
import { toolProfile } from '@domain/inventory/Tool';
import { BlockId } from '@domain/world/BlockType';

const recipe = (id: string) => {
  const found = RECIPES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no recipe ${id}`);
  return found;
};

describe('recipe catalogue', () => {
  it('has a unique id and a real output for every recipe', () => {
    const ids = RECIPES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of RECIPES) {
      expect(itemDefinition(entry.output.item), entry.id).not.toBeNull();
      expect(entry.output.count, entry.id).toBeGreaterThan(0);
      expect(entry.inputs.length, entry.id).toBeGreaterThan(0);
      for (const input of entry.inputs) {
        expect(itemDefinition(input.item), `${entry.id} input`).not.toBeNull();
        expect(input.count, `${entry.id} input`).toBeGreaterThan(0);
      }
    }
  });

  it('covers the whole tool grid, and every output really is that tool', () => {
    for (const material of ['wooden', 'stone', 'iron', 'diamond'] as const) {
      for (const shape of ['pickaxe', 'sword', 'axe', 'shovel'] as const) {
        const entry = recipe(`${material}-${shape}`);
        const profile = toolProfile(entry.output.item);
        expect(profile, entry.id).not.toBeNull();
        expect(profile?.material, entry.id).toBe(material);
        expect(profile?.toolClass, entry.id).toBe(shape);
      }
    }
  });

  it('reaches every new block and item the features need', () => {
    expect(recipe('rail').output.item).toBe(blockItem(BlockId.Rail));
    expect(recipe('bed').output.item).toBe(blockItem(BlockId.Bed));
    expect(recipe('minecart').output.item).toBe(catalogItem('minecart'));
    expect(recipe('sticks').output.item).toBe(catalogItem('stick'));
  });
});

describe('crafting', () => {
  it('refuses without the inputs and consumes them exactly when it succeeds', () => {
    const inventory = new Inventory();
    const stonePickaxe = recipe('stone-pickaxe');

    expect(canCraft(inventory, stonePickaxe)).toBe(false);
    expect(craft(inventory, stonePickaxe)).toBe(false);

    inventory.add(blockItem(BlockId.Cobblestone), 3);
    inventory.add(catalogItem('stick'), 2);
    expect(craft(inventory, stonePickaxe)).toBe(true);

    expect(inventory.count(catalogItem('stone-pickaxe'))).toBe(1);
    expect(inventory.count(blockItem(BlockId.Cobblestone))).toBe(0);
    expect(inventory.count(catalogItem('stick'))).toBe(0);
  });

  it('leaves the inventory untouched when only some inputs are present', () => {
    const inventory = new Inventory();
    inventory.add(blockItem(BlockId.Cobblestone), 3);

    expect(craft(inventory, recipe('stone-pickaxe'))).toBe(false);
    expect(inventory.count(blockItem(BlockId.Cobblestone))).toBe(3);
  });

  it('supports the whole path from a log to an iron pickaxe', () => {
    const inventory = new Inventory();
    inventory.add(blockItem(BlockId.Log), 1);

    expect(craft(inventory, recipe('planks'))).toBe(true);
    expect(inventory.count(blockItem(BlockId.Planks))).toBe(4);

    expect(craft(inventory, recipe('sticks'))).toBe(true);
    expect(inventory.count(catalogItem('stick'))).toBe(4);

    // Iron comes from ore, which needs the stone tier first — so only the
    // handle can be made from wood, exactly as the progression intends.
    expect(canCraft(inventory, recipe('iron-pickaxe'))).toBe(false);

    inventory.add(catalogItem('iron-ingot'), 3);
    expect(craft(inventory, recipe('iron-pickaxe'))).toBe(true);
    expect(inventory.count(catalogItem('iron-pickaxe'))).toBe(1);
  });

  it('makes a bed from planks and wool', () => {
    const inventory = new Inventory();
    inventory.add(blockItem(BlockId.Planks), 3);
    inventory.add(resourceItem(ResourceItemId.Wool), 3);

    expect(craft(inventory, recipe('bed'))).toBe(true);
    expect(inventory.count(blockItem(BlockId.Bed))).toBe(1);
  });

  it('makes a rail line and a cart from iron', () => {
    const inventory = new Inventory();
    inventory.add(catalogItem('iron-ingot'), 11);
    inventory.add(catalogItem('stick'), 1);

    expect(craft(inventory, recipe('rail'))).toBe(true);
    expect(inventory.count(blockItem(BlockId.Rail))).toBe(8);

    expect(craft(inventory, recipe('minecart'))).toBe(true);
    expect(inventory.count(catalogItem('minecart'))).toBe(1);
    expect(inventory.count(catalogItem('iron-ingot'))).toBe(0);
  });

  it('caps tools and the cart at a single stack slot', () => {
    for (const id of ['diamond-sword', 'iron-pickaxe', 'minecart', 'saddle'] as const) {
      expect(itemDefinition(catalogItem(id))?.maxStack, id).toBe(1);
    }
  });
});
