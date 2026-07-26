import { describe, expect, it } from 'vitest';
import { EntityManager } from '@application/services/EntityManager';
import { EntityRegistry, EntityTypeId } from '@domain/entity/EntityType';
import { rollMobLoot } from '@domain/entity/MobLoot';
import { resourceItem, ResourceItemId } from '@domain/inventory/Item';
import { GameMode } from '@domain/player/GameMode';
import { Player } from '@domain/player/Player';
import { BlockId } from '@domain/world/BlockType';
import { Chunk } from '@domain/world/Chunk';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { TimeOfDay } from '@domain/world/TimeOfDay';
import { World } from '@domain/world/World';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';

describe('PSP creature catalogue', () => {
  it('contains the nine shipped spawn-egg creatures and excludes remote players', () => {
    const names = [
      ...EntityRegistry.spawnable('passive'),
      ...EntityRegistry.spawnable('hostile'),
    ].map((definition) => definition.name);

    expect(names).toEqual([
      'Pig',
      'Cow',
      'Chicken',
      'Sheep',
      'Zombie',
      'Spider',
      'Skeleton',
      'Creeper',
      'Cave Spider',
    ]);
  });

  it('rolls typed, deterministic legacy drops from an injected random source', () => {
    expect(rollMobLoot(EntityTypeId.Pig, () => 0)).toEqual([
      { item: resourceItem(ResourceItemId.RawPorkchop), count: 1 },
    ]);
    expect(rollMobLoot(EntityTypeId.Skeleton, () => 0.999)).toEqual([
      { item: resourceItem(ResourceItemId.Bone), count: 2 },
      { item: resourceItem(ResourceItemId.Arrow), count: 2 },
    ]);
    expect(rollMobLoot(EntityTypeId.Spider, () => 0.999)).toEqual([
      { item: resourceItem(ResourceItemId.String), count: 2 },
    ]);
  });

  it('defines a reward table for every spawnable creature', () => {
    const spawnable = [
      ...EntityRegistry.spawnable('passive'),
      ...EntityRegistry.spawnable('hostile'),
    ];
    for (const definition of spawnable) {
      expect(rollMobLoot(definition.id, () => 0.5).length, definition.name).toBeGreaterThan(0);
    }
  });
});

describe('collectible mob drops', () => {
  it('leaves a physical stack on death and transfers it only after pickup delay', () => {
    const world = flatWorld();
    const manager = new EntityManager({
      world,
      random: () => 0,
      spawnSettings: { maxPassive: 0, maxHostile: 0 },
    });
    const player = new Player(0.5, 1, 0.5);
    player.setGameMode(GameMode.Survival);
    const pig = manager.spawn(EntityTypeId.Pig, 0.5, 1, 0.5);
    expect(pig).not.toBeNull();

    expect(manager.damage(pig!, 100, -1, 0.5, 0)).toBe(true);
    expect(manager.count).toBe(0);
    expect(manager.itemDropCount).toBe(1);
    expect(manager.itemDropSnapshot(1)[0].item).toBe(
      resourceItem(ResourceItemId.RawPorkchop),
    );

    const tooSoon = manager.update(player, new TimeOfDay(0.2), 0.2);
    expect(tooSoon.pickups).toHaveLength(0);
    expect(manager.itemDropCount).toBe(1);

    const collected = manager.update(player, new TimeOfDay(0.2), 0.3);
    expect(collected.pickups).toEqual([
      { item: resourceItem(ResourceItemId.RawPorkchop), count: 1 },
    ]);
    expect(manager.itemDropCount).toBe(0);
  });
});

function flatWorld(): World {
  const world = new World();
  const chunk = new Chunk(ChunkCoord.of(0, 0));
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      chunk.setGenerated(x, 0, z, BlockId.Stone);
    }
  }
  world.addChunk(chunk);
  return world;
}
