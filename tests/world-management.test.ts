import { describe, expect, it } from 'vitest';
import {
  WorldManagementService,
  WorldNotFoundError,
} from '@application/services/WorldManagementService';
import { GameMode } from '@domain/player/GameMode';
import {
  GeneratorPreset,
  createWorldCreationSettings,
  type WorldCreationSettings,
} from '@domain/world/WorldCreationSettings';
import { InMemoryWorldCatalog } from '@infrastructure/persistence/InMemoryWorldCatalog';
import { InMemoryWorldRepository } from '@infrastructure/persistence/InMemoryWorldRepository';

class FailingClearRepository extends InMemoryWorldRepository {
  override clear(): Promise<void> {
    return Promise.reject(new Error('save is locked'));
  }
}

function settings(name: string, seed = 77): WorldCreationSettings {
  const result = createWorldCreationSettings({
    name,
    seed,
    gameMode: GameMode.Survival,
    generatorPreset: GeneratorPreset.Default,
    structures: true,
    bonusChest: false,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function fixture(ids = ['world-a', 'world-b', 'world-c']) {
  const catalog = new InMemoryWorldCatalog();
  const repositories = new Map<string, InMemoryWorldRepository>();
  const remainingIds = [...ids];
  let time = 100;
  const service = new WorldManagementService(
    catalog,
    (id) => {
      let repository = repositories.get(id);
      if (repository === undefined) {
        repository = new InMemoryWorldRepository();
        repositories.set(id, repository);
      }
      return repository;
    },
    () => remainingIds.shift() ?? 'world-fallback',
    () => time++,
  );
  return { service, catalog, repositories };
}

describe('WorldManagementService', () => {
  it('creates isolated named worlds even when their generation seeds match', async () => {
    const { service } = fixture();
    const first = await service.create(settings('Farm', 1234));
    const second = await service.create(settings('Mines', 1234));

    expect(first.id).not.toBe(second.id);
    expect(first.settings.seed).toBe(second.settings.seed);
    expect((await service.list()).map((world) => world.name)).toEqual(['Mines', 'Farm']);

    const openedFirst = await service.open(first.id);
    await openedFirst.repository.saveMetadata({
      seed: 1234,
      version: 4,
      updatedAt: 200,
    });
    const openedSecond = await service.open(second.id);
    expect(await openedSecond.repository.loadMetadata()).toBeNull();
  });

  it('renames the library record without mutating immutable creation settings', async () => {
    const { service } = fixture();
    const created = await service.create(settings('Original'));
    const renamed = await service.rename(created.id, 'Survival Base');

    expect(renamed.name).toBe('Survival Base');
    expect(renamed.settings.name).toBe('Original');
    expect(renamed.settings).toBe(created.settings);
    await expect(service.rename(created.id, ' \u0000 ')).rejects.toThrow('World name');
  });

  it('deletes only the selected world and leaves the rest discoverable', async () => {
    const { service, repositories } = fixture();
    const first = await service.create(settings('Delete me', 1));
    const second = await service.create(settings('Keep me', 2));

    const opened = await service.open(first.id);
    await opened.repository.saveMetadata({ seed: 1, version: 4, updatedAt: 1 });
    await service.delete(first.id);

    expect((await service.list()).map((world) => world.id)).toEqual([second.id]);
    expect(await repositories.get(first.id)?.loadMetadata()).toBeNull();
    await expect(service.open(first.id)).rejects.toBeInstanceOf(WorldNotFoundError);
  });

  it('registers seed-keyed legacy saves without undoing a later rename', async () => {
    const { service } = fixture();
    const original = await service.registerExisting('-42', settings('Legacy', -42));
    await service.rename(original.id, 'Renamed legacy world');
    const registeredAgain = await service.registerExisting('-42', settings('Menu default', -42));

    expect(registeredAgain.name).toBe('Renamed legacy world');
    expect(registeredAgain.settings.name).toBe('Legacy');
  });

  it('keeps a world discoverable when deleting its stored state fails', async () => {
    const catalog = new InMemoryWorldCatalog();
    const failing = new FailingClearRepository();
    const service = new WorldManagementService(
      catalog,
      () => failing,
      () => 'world-locked',
      () => 100,
    );
    const created = await service.create(settings('Locked'));

    await expect(service.delete(created.id)).rejects.toThrow('save is locked');
    expect((await service.list()).map((world) => world.id)).toEqual([created.id]);
  });
});
