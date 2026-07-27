import {
  ResourceItemId,
  resourceItem,
  type ItemId,
} from '../inventory/Item';
import { EntityTypeId, type EntityTypeId as EntityType } from './EntityType';

export interface LootStack {
  readonly item: ItemId;
  readonly count: number;
}

interface LootRule {
  readonly item: ItemId;
  readonly min: number;
  readonly max: number;
  readonly chance: number;
}

const item = (id: ResourceItemId): ItemId => resourceItem(id);
const rule = (id: ResourceItemId, min: number, max: number, chance = 1): LootRule =>
  Object.freeze({ item: item(id), min, max, chance });

/**
 * PSP 3.4.2 creature reward catalogue, expressed as data rather than combat
 * branches. Counts follow its legacy Minecraft-era item set.
 */
const LOOT: Readonly<Partial<Record<EntityType, readonly LootRule[]>>> = Object.freeze({
  [EntityTypeId.Pig]: Object.freeze([
    rule(ResourceItemId.RawPorkchop, 1, 3),
  ]),
  [EntityTypeId.Cow]: Object.freeze([
    rule(ResourceItemId.RawBeef, 1, 3),
    rule(ResourceItemId.Leather, 0, 2),
  ]),
  [EntityTypeId.Chicken]: Object.freeze([
    rule(ResourceItemId.RawChicken, 1, 1),
    rule(ResourceItemId.Feather, 0, 2),
  ]),
  [EntityTypeId.Sheep]: Object.freeze([
    rule(ResourceItemId.RawMutton, 1, 2),
    rule(ResourceItemId.Wool, 1, 1),
  ]),
  [EntityTypeId.Zombie]: Object.freeze([
    rule(ResourceItemId.RottenFlesh, 0, 2),
  ]),
  [EntityTypeId.Spider]: Object.freeze([
    rule(ResourceItemId.String, 0, 2),
    rule(ResourceItemId.SpiderEye, 1, 1, 1 / 3),
  ]),
  [EntityTypeId.Skeleton]: Object.freeze([
    rule(ResourceItemId.Bone, 0, 2),
    rule(ResourceItemId.Arrow, 0, 2),
  ]),
  [EntityTypeId.Creeper]: Object.freeze([
    rule(ResourceItemId.Gunpowder, 0, 2),
  ]),
  [EntityTypeId.CaveSpider]: Object.freeze([
    rule(ResourceItemId.String, 0, 2),
    rule(ResourceItemId.SpiderEye, 1, 1, 1 / 3),
  ]),
  [EntityTypeId.Horse]: Object.freeze([
    rule(ResourceItemId.Leather, 0, 2),
  ]),
});

/** Rolls one death once. The injected source makes rewards exactly testable. */
export function rollMobLoot(type: EntityType, random: () => number): readonly LootStack[] {
  const rules = LOOT[type] ?? [];
  const result: LootStack[] = [];
  for (const entry of rules) {
    if (unit(random()) >= entry.chance) continue;
    const count = entry.min + Math.floor(unit(random()) * (entry.max - entry.min + 1));
    if (count > 0) result.push(Object.freeze({ item: entry.item, count }));
  }
  return result;
}

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}
