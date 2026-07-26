import {
  EntityRegistry,
  EntityTypeId,
  type EntityTypeId as EntityType,
} from '../entity/EntityType';
import { BlockId, BlockRegistry, type BlockId as BlockIdType } from '../world/BlockType';

/** The resource subset used by creature loot tables. */
export const ResourceItemId = {
  RawPorkchop: 'raw-porkchop',
  RawBeef: 'raw-beef',
  Leather: 'leather',
  RawChicken: 'raw-chicken',
  Feather: 'feather',
  RawMutton: 'raw-mutton',
  Wool: 'wool',
  RottenFlesh: 'rotten-flesh',
  String: 'string',
  SpiderEye: 'spider-eye',
  Bone: 'bone',
  Arrow: 'arrow',
  Gunpowder: 'gunpowder',
} as const;

export type ResourceItemId = (typeof ResourceItemId)[keyof typeof ResourceItemId];

export type InventoryItemKind = 'resource' | 'food' | 'tool' | 'equipment' | 'utility';

const ADDITIONAL_ITEM_DEFINITIONS = [
  ['cooked-chicken', 'Cooked Chicken', 'food'],
  ['cooked-mutton', 'Cooked Mutton', 'food'],
  ['cooked-porkchop', 'Cooked Porkchop', 'food'],
  ['music-disc', 'Music Disc', 'utility'],
  ['carrot', 'Carrot', 'food'],
  ['poisonous-potato', 'Poisonous Potato', 'food'],
  ['baked-potato', 'Baked Potato', 'food'],
  ['potato', 'Potato', 'food'],
  ['flint-and-steel', 'Flint and Steel', 'tool'],
  ['pumpkin-seeds', 'Pumpkin Seeds', 'resource'],
  ['magenta-dye', 'Magenta Dye', 'resource'],
  ['purple-dye', 'Purple Dye', 'resource'],
  ['light-blue-dye', 'Light Blue Dye', 'resource'],
  ['cactus-green', 'Cactus Green', 'resource'],
  ['lime-dye', 'Lime Dye', 'resource'],
  ['dandelion-yellow', 'Dandelion Yellow', 'resource'],
  ['orange-dye', 'Orange Dye', 'resource'],
  ['rose-red', 'Rose Red', 'resource'],
  ['pink-dye', 'Pink Dye', 'resource'],
  ['ink-sac', 'Ink Sac', 'resource'],
  ['gray-dye', 'Gray Dye', 'resource'],
  ['light-gray-dye', 'Light Gray Dye', 'resource'],
  ['painting', 'Painting', 'utility'],
  ['flower-pot', 'Flower Pot', 'utility'],
  ['sign', 'Sign', 'utility'],
  ['saddle', 'Saddle', 'equipment'],
  ['compass', 'Compass', 'utility'],
  ['clock', 'Clock', 'utility'],
  ['flint', 'Flint', 'resource'],
  ['golden-boots', 'Golden Boots', 'equipment'],
  ['golden-leggings', 'Golden Leggings', 'equipment'],
  ['golden-chestplate', 'Golden Chestplate', 'equipment'],
  ['golden-helmet', 'Golden Helmet', 'equipment'],
  ['diamond-boots', 'Diamond Boots', 'equipment'],
  ['diamond-leggings', 'Diamond Leggings', 'equipment'],
  ['diamond-chestplate', 'Diamond Chestplate', 'equipment'],
  ['diamond-helmet', 'Diamond Helmet', 'equipment'],
  ['iron-boots', 'Iron Boots', 'equipment'],
  ['iron-leggings', 'Iron Leggings', 'equipment'],
  ['iron-chestplate', 'Iron Chestplate', 'equipment'],
  ['iron-helmet', 'Iron Helmet', 'equipment'],
  ['chainmail-boots', 'Chainmail Boots', 'equipment'],
  ['chainmail-leggings', 'Chainmail Leggings', 'equipment'],
  ['chainmail-chestplate', 'Chainmail Chestplate', 'equipment'],
  ['chainmail-helmet', 'Chainmail Helmet', 'equipment'],
  ['leather-boots', 'Leather Boots', 'equipment'],
  ['leather-leggings', 'Leather Leggings', 'equipment'],
  ['leather-chestplate', 'Leather Chestplate', 'equipment'],
  ['leather-helmet', 'Leather Helmet', 'equipment'],
  ['bone-meal', 'Bone Meal', 'resource'],
  ['cake', 'Cake', 'food'],
  ['milk', 'Milk', 'food'],
  ['lapis-lazuli', 'Lapis Lazuli', 'resource'],
  ['steak', 'Steak', 'food'],
  ['cookie', 'Cookie', 'food'],
  ['cocoa-beans', 'Cocoa Beans', 'resource'],
  ['sugar', 'Sugar', 'resource'],
  ['melon-seeds', 'Melon Seeds', 'resource'],
  ['birch-sapling', 'Birch Sapling', 'utility'],
  ['spruce-sapling', 'Spruce Sapling', 'utility'],
  ['torch', 'Torch', 'utility'],
  ['ladder', 'Ladder', 'utility'],
  ['door', 'Door', 'utility'],
  ['mushroom-stew', 'Mushroom Stew', 'food'],
  ['bowl', 'Bowl', 'utility'],
  ['mushroom', 'Mushroom', 'food'],
  ['snowball', 'Snowball', 'utility'],
  ['book', 'Book', 'utility'],
  ['paper', 'Paper', 'resource'],
  ['oak-sapling', 'Oak Sapling', 'utility'],
  ['dandelion', 'Dandelion', 'utility'],
  ['rose', 'Rose', 'utility'],
  ['sugar-canes', 'Sugar Canes', 'resource'],
  ['lava-bucket', 'Lava Bucket', 'utility'],
  ['water-bucket', 'Water Bucket', 'utility'],
  ['bucket', 'Bucket', 'utility'],
  ['brick', 'Brick', 'resource'],
  ['bread', 'Bread', 'food'],
  ['wheat', 'Wheat', 'resource'],
  ['golden-apple', 'Golden Apple', 'food'],
  ['apple', 'Apple', 'food'],
  ['clay', 'Clay', 'resource'],
  ['gold-ingot', 'Gold Ingot', 'resource'],
  ['diamond', 'Diamond', 'resource'],
  ['iron-ingot', 'Iron Ingot', 'resource'],
  ['coal', 'Coal', 'resource'],
  ['stick', 'Stick', 'resource'],
  ['shears', 'Shears', 'tool'],
  ['golden-hoe', 'Golden Hoe', 'tool'],
  ['diamond-hoe', 'Diamond Hoe', 'tool'],
  ['iron-hoe', 'Iron Hoe', 'tool'],
  ['stone-hoe', 'Stone Hoe', 'tool'],
  ['wooden-hoe', 'Wooden Hoe', 'tool'],
  ['golden-axe', 'Golden Axe', 'tool'],
  ['diamond-axe', 'Diamond Axe', 'tool'],
  ['iron-axe', 'Iron Axe', 'tool'],
  ['stone-axe', 'Stone Axe', 'tool'],
  ['wooden-axe', 'Wooden Axe', 'tool'],
  ['golden-shovel', 'Golden Shovel', 'tool'],
  ['diamond-shovel', 'Diamond Shovel', 'tool'],
  ['iron-shovel', 'Iron Shovel', 'tool'],
  ['stone-shovel', 'Stone Shovel', 'tool'],
  ['wooden-shovel', 'Wooden Shovel', 'tool'],
  ['golden-sword', 'Golden Sword', 'tool'],
  ['diamond-sword', 'Diamond Sword', 'tool'],
  ['iron-sword', 'Iron Sword', 'tool'],
  ['stone-sword', 'Stone Sword', 'tool'],
  ['wooden-sword', 'Wooden Sword', 'tool'],
  ['golden-pickaxe', 'Golden Pickaxe', 'tool'],
  ['diamond-pickaxe', 'Diamond Pickaxe', 'tool'],
  ['iron-pickaxe', 'Iron Pickaxe', 'tool'],
  ['stone-pickaxe', 'Stone Pickaxe', 'tool'],
  ['wooden-pickaxe', 'Wooden Pickaxe', 'tool'],
] as const satisfies readonly (readonly [string, string, InventoryItemKind])[];

type AdditionalItemId = (typeof ADDITIONAL_ITEM_DEFINITIONS)[number][0];
export type CatalogItemId = ResourceItemId | AdditionalItemId;
export type ItemId = `block:${number}` | `egg:${number}` | `item:${CatalogItemId}`;
export type ItemKind = 'block' | 'spawnEgg' | InventoryItemKind;

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly kind: ItemKind;
  readonly block?: BlockIdType;
  readonly entity?: EntityType;
  /** Presentation hint used when an icon needs a material colour. */
  readonly colour?: number;
  readonly maxStack: number;
}

interface CatalogDefinition {
  readonly name: string;
  readonly kind: InventoryItemKind;
  readonly colour?: number;
  readonly maxStack: number;
}

export function blockItem(block: BlockIdType): ItemId {
  return `block:${block}`;
}

export function spawnEggItem(entity: EntityType): ItemId {
  return `egg:${entity}`;
}

export function catalogItem(item: CatalogItemId): ItemId {
  return `item:${item}`;
}

export function resourceItem(item: ResourceItemId): ItemId {
  return catalogItem(item);
}

const definitions = new Map<CatalogItemId, CatalogDefinition>();
addResource(ResourceItemId.RawPorkchop, 'Raw Porkchop', 0xd88d91);
addResource(ResourceItemId.RawBeef, 'Raw Beef', 0xa7473d);
addResource(ResourceItemId.Leather, 'Leather', 0x9a6539);
addResource(ResourceItemId.RawChicken, 'Raw Chicken', 0xe9c7ad);
addResource(ResourceItemId.Feather, 'Feather', 0xf4f1e9);
addResource(ResourceItemId.RawMutton, 'Raw Mutton', 0xb95457);
addResource(ResourceItemId.Wool, 'Wool', 0xece9e2);
addResource(ResourceItemId.RottenFlesh, 'Rotten Flesh', 0x80613b);
addResource(ResourceItemId.String, 'String', 0xe6e6e6);
addResource(ResourceItemId.SpiderEye, 'Spider Eye', 0x9b202c);
addResource(ResourceItemId.Bone, 'Bone', 0xe5dfc8);
addResource(ResourceItemId.Arrow, 'Arrow', 0x9d9d92);
addResource(ResourceItemId.Gunpowder, 'Gunpowder', 0x686b68);
for (const [id, name, kind] of ADDITIONAL_ITEM_DEFINITIONS) {
  definitions.set(id, Object.freeze({ name, kind, maxStack: maxStackFor(name, kind) }));
}
const CATALOG_DEFINITIONS: ReadonlyMap<CatalogItemId, CatalogDefinition> = definitions;

export function itemDefinition(id: string | null): ItemDefinition | null {
  if (id === null) return null;
  const [kind, raw] = id.split(':');
  const numeric = Number(raw);

  if (
    kind === 'block' &&
    Number.isInteger(numeric) &&
    BlockRegistry.isKnown(numeric) &&
    numeric !== BlockId.Air
  ) {
    const block = numeric as BlockIdType;
    return {
      id: blockItem(block),
      name: BlockRegistry.get(block).name,
      kind: 'block',
      block,
      maxStack: 64,
    };
  }

  if (
    kind === 'egg' &&
    Number.isInteger(numeric) &&
    numeric !== EntityTypeId.RemotePlayer &&
    EntityRegistry.all().some((entry) => entry.id === numeric)
  ) {
    const entity = numeric as EntityType;
    return {
      id: spawnEggItem(entity),
      name: `${EntityRegistry.get(entity).name} Spawn Egg`,
      kind: 'spawnEgg',
      entity,
      maxStack: 64,
    };
  }

  const definition = CATALOG_DEFINITIONS.get(raw as CatalogItemId);
  if (kind === 'item' && definition !== undefined) {
    return {
      id: catalogItem(raw as CatalogItemId),
      ...definition,
    };
  }

  return null;
}

export const CREATIVE_BLOCK_ITEMS: readonly ItemId[] = Object.freeze(
  BlockRegistry.all()
    .filter((block) => block.id !== BlockId.Air && !block.liquid && !block.indestructible)
    .map((block) => blockItem(block.id)),
);

export const CREATIVE_EGG_ITEMS: readonly ItemId[] = Object.freeze(
  [...EntityRegistry.spawnable('passive'), ...EntityRegistry.spawnable('hostile')].map((entity) =>
    spawnEggItem(entity.id),
  ),
);

export const CREATIVE_CATALOG_ITEMS: readonly ItemId[] = Object.freeze([
  ...Object.values(ResourceItemId).map(resourceItem),
  ...ADDITIONAL_ITEM_DEFINITIONS.map(([id]) => catalogItem(id)),
]);

function addResource(id: ResourceItemId, name: string, colour: number): void {
  definitions.set(
    id,
    Object.freeze({ name, kind: 'resource', colour, maxStack: 64 }),
  );
}

function maxStackFor(name: string, kind: InventoryItemKind): number {
  if (kind === 'tool' || kind === 'equipment') return 1;
  if (
    /Bucket|Compass|Clock|Saddle|Music Disc|Mushroom Stew|Milk|Cake/u.test(name)
  ) {
    return 1;
  }
  return 64;
}
