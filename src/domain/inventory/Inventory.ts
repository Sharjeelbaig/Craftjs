import { HOTBAR_BLOCKS } from '../world/BlockType';
import { blockItem, itemDefinition, type ItemId } from './Item';

export const HOTBAR_SIZE = 9;
const MAX_DISTINCT_ITEMS = 64;
const MAX_SAVED_COUNT = 9999;

export interface InventorySnapshot {
  readonly counts: Readonly<Record<string, number>>;
  readonly hotbar: readonly (ItemId | null)[];
}

/**
 * Minimal inventory aggregate.
 *
 * Counts are stored once per item rather than as dozens of mutable slot
 * objects. The hotbar is the only ordered part players interact with during
 * play, which keeps persistence and crafting atomic and easy to validate.
 */
export class Inventory {
  private readonly counts = new Map<ItemId, number>();
  readonly hotbar: (ItemId | null)[] = Array.from({ length: HOTBAR_SIZE }, () => null);

  static creativeLoadout(): Inventory {
    const inventory = new Inventory();
    HOTBAR_BLOCKS.slice(0, HOTBAR_SIZE).forEach((block, index) => {
      inventory.hotbar[index] = blockItem(block);
    });
    return inventory;
  }

  static fromSnapshot(snapshot: InventorySnapshot | undefined): Inventory {
    const inventory = new Inventory();
    if (snapshot === undefined || snapshot === null) return inventory;

    for (const [rawId, rawCount] of Object.entries(snapshot.counts ?? {}).slice(
      0,
      MAX_DISTINCT_ITEMS,
    )) {
      const definition = itemDefinition(rawId);
      const count = Math.floor(Number(rawCount));
      if (definition !== null && Number.isFinite(count) && count > 0) {
        inventory.counts.set(definition.id, Math.min(count, MAX_SAVED_COUNT));
      }
    }

    for (let index = 0; index < HOTBAR_SIZE; index++) {
      const definition = itemDefinition(snapshot.hotbar?.[index] ?? null);
      inventory.hotbar[index] = definition?.id ?? null;
    }
    return inventory;
  }

  toSnapshot(): InventorySnapshot {
    return {
      counts: Object.fromEntries(this.counts),
      hotbar: [...this.hotbar],
    };
  }

  count(item: ItemId): number {
    return this.counts.get(item) ?? 0;
  }

  entries(): readonly { item: ItemId; count: number }[] {
    return [...this.counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([item, count]) => ({ item, count }));
  }

  add(item: ItemId, amount = 1): boolean {
    if (itemDefinition(item) === null || !Number.isFinite(amount) || amount <= 0) return false;
    const next = Math.min(MAX_SAVED_COUNT, this.count(item) + Math.floor(amount));
    this.counts.set(item, next);
    if (!this.hotbar.includes(item)) {
      const empty = this.hotbar.indexOf(null);
      if (empty >= 0) this.hotbar[empty] = item;
    }
    return true;
  }

  has(item: ItemId, amount = 1): boolean {
    return Number.isFinite(amount) && amount > 0 && this.count(item) >= Math.floor(amount);
  }

  remove(item: ItemId, amount = 1): boolean {
    const requested = Math.floor(amount);
    if (!this.has(item, requested)) return false;
    const next = this.count(item) - requested;
    if (next === 0) this.counts.delete(item);
    else this.counts.set(item, next);
    return true;
  }

  assignHotbar(slot: number, item: ItemId | null): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return false;
    if (item !== null && itemDefinition(item) === null) return false;
    this.hotbar[slot] = item;
    return true;
  }
}
