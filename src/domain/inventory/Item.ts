import {
  EntityRegistry,
  EntityTypeId,
  type EntityTypeId as EntityType,
} from '../entity/EntityType';
import { BlockId, BlockRegistry, type BlockId as BlockIdType } from '../world/BlockType';

export type ItemId = `block:${number}` | `egg:${number}`;

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly kind: 'block' | 'spawnEgg';
  readonly block?: BlockIdType;
  readonly entity?: EntityType;
  readonly maxStack: number;
}

export function blockItem(block: BlockIdType): ItemId {
  return `block:${block}`;
}

export function spawnEggItem(entity: EntityType): ItemId {
  return `egg:${entity}`;
}

export function itemDefinition(id: string | null): ItemDefinition | null {
  if (id === null) return null;
  const [kind, raw] = id.split(':');
  const numeric = Number(raw);
  if (!Number.isInteger(numeric)) return null;

  if (kind === 'block' && BlockRegistry.isKnown(numeric) && numeric !== BlockId.Air) {
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
