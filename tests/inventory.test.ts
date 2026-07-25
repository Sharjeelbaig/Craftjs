import { describe, expect, it } from 'vitest';
import { Inventory } from '@domain/inventory/Inventory';
import { RECIPES, canCraft, craft } from '@domain/inventory/Crafting';
import { blockItem, itemDefinition, spawnEggItem } from '@domain/inventory/Item';
import { EntityTypeId } from '@domain/entity/EntityType';
import { BlockId } from '@domain/world/BlockType';

describe('Inventory', () => {
  it('collects items, assigns the first free hotbar slot, and consumes atomically', () => {
    const inventory = new Inventory();
    const dirt = blockItem(BlockId.Dirt);

    expect(inventory.add(dirt, 3)).toBe(true);
    expect(inventory.count(dirt)).toBe(3);
    expect(inventory.hotbar[0]).toBe(dirt);
    expect(inventory.remove(dirt, 4)).toBe(false);
    expect(inventory.count(dirt)).toBe(3);
    expect(inventory.remove(dirt, 2)).toBe(true);
    expect(inventory.count(dirt)).toBe(1);
  });

  it('sanitises corrupt snapshots without losing valid entries', () => {
    const dirt = blockItem(BlockId.Dirt);
    const restored = Inventory.fromSnapshot({
      counts: { [dirt]: 7, 'block:999': 100, 'egg:bad': 4, 'block:1': -5 },
      hotbar: [dirt, 'block:999' as never],
    });

    expect(restored.count(dirt)).toBe(7);
    expect(restored.hotbar[0]).toBe(dirt);
    expect(restored.hotbar[1]).toBeNull();
  });

  it('crafts all inputs or none', () => {
    const inventory = new Inventory();
    const recipe = RECIPES.find((entry) => entry.id === 'planks')!;
    const logs = blockItem(BlockId.Log);
    const planks = blockItem(BlockId.Planks);

    expect(craft(inventory, recipe)).toBe(false);
    inventory.add(logs);
    expect(canCraft(inventory, recipe)).toBe(true);
    expect(craft(inventory, recipe)).toBe(true);
    expect(inventory.count(logs)).toBe(0);
    expect(inventory.count(planks)).toBe(4);
  });

  it('recognises creative spawn eggs as typed items', () => {
    const egg = itemDefinition(spawnEggItem(EntityTypeId.Cow));
    expect(egg?.kind).toBe('spawnEgg');
    expect(egg?.name).toContain('Cow');
  });
});
