import { describe, expect, it } from 'vitest';
import { settingsForWorld } from '@application/services/WorldCreationService';
import {
  ConfiguredTerrainGenerator,
  createTerrainGenerator,
  safeRuinOrigin,
} from '@domain/generation/ConfiguredTerrainGenerator';
import { FlatTerrainGenerator, FLAT_SURFACE_Y } from '@domain/generation/FlatTerrainGenerator';
import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { GameMode } from '@domain/player/GameMode';
import { BlockId } from '@domain/world/BlockType';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { starterChestLoot, starterChestPosition } from '@domain/world/StarterChest';
import {
  GeneratorPreset,
  createWorldCreationSettings,
  deserializeWorldCreationSettings,
  parseWorldSeed,
  validateWorldName,
  type WorldCreationSettings,
} from '@domain/world/WorldCreationSettings';

function settings(
  overrides: Partial<WorldCreationSettings> = {},
): WorldCreationSettings {
  const result = createWorldCreationSettings({
    name: 'Test world',
    seed: 4242,
    gameMode: GameMode.Survival,
    generatorPreset: GeneratorPreset.Default,
    structures: true,
    bonusChest: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function generatedBlockAt(
  generator: ReturnType<typeof createTerrainGenerator>,
  x: number,
  y: number,
  z: number,
): number {
  const coord = ChunkCoord.fromWorld(x, z);
  const chunk = generator.generate(coord);
  return chunk.get(x - coord.originX, y, z - coord.originZ);
}

describe('WorldCreationSettings', () => {
  it('round-trips the complete immutable configuration through JSON', () => {
    const original = settings({
      name: 'Hard flat',
      seed: -93,
      gameMode: GameMode.Hardcore,
      generatorPreset: GeneratorPreset.Flat,
      structures: false,
      bonusChest: true,
    });

    const restored = deserializeWorldCreationSettings(
      JSON.parse(JSON.stringify(original)) as unknown,
      -93,
    );

    expect(restored).toEqual(original);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it('rejects invalid names, seeds, modes and presets', () => {
    expect(validateWorldName('   ')).toBeNull();
    expect(validateWorldName('bad\u0000name')).toBeNull();
    expect(parseWorldSeed('')).toBeNull();
    expect(parseWorldSeed('2147483648')).toBeNull();
    expect(parseWorldSeed('9007199254740992')).toBeNull();
    expect(parseWorldSeed('same text')).toBe(parseWorldSeed('same text'));

    expect(
      createWorldCreationSettings({
        ...settings(),
        gameMode: 'spectator' as GameMode,
      }).ok,
    ).toBe(false);
    expect(
      createWorldCreationSettings({
        ...settings(),
        generatorPreset: 'custom' as GeneratorPreset,
      }).ok,
    ).toBe(false);
  });

  it('uses saved settings instead of current menu defaults', () => {
    const stored = settings({
      name: 'Original',
      seed: 7,
      gameMode: GameMode.Hardcore,
      generatorPreset: GeneratorPreset.Flat,
      structures: false,
      bonusChest: true,
    });
    const requested = settings({
      name: 'Menu default',
      seed: 7,
      gameMode: GameMode.Creative,
      generatorPreset: GeneratorPreset.Default,
      structures: true,
      bonusChest: false,
    });

    const resolved = settingsForWorld(
      { seed: 7, version: 4, updatedAt: 1, creation: stored },
      requested,
    );
    expect(resolved).toEqual(stored);
  });

  it('migrates legacy worlds without introducing structures or bonus loot', () => {
    const requested = settings({
      seed: 19,
      gameMode: GameMode.Survival,
      structures: true,
      bonusChest: true,
    });
    const migrated = settingsForWorld(
      { seed: 19, version: 3, updatedAt: 1 },
      requested,
      GameMode.Creative,
    );

    expect(migrated.gameMode).toBe(GameMode.Creative);
    expect(migrated.generatorPreset).toBe(GeneratorPreset.Default);
    expect(migrated.structures).toBe(false);
    expect(migrated.bonusChest).toBe(false);
  });
});

describe('configured terrain generation', () => {
  it('selects Default and Flat as separate generator strategies', () => {
    const defaultGenerator = createTerrainGenerator(
      settings({ generatorPreset: GeneratorPreset.Default, structures: false }),
    );
    const flatGenerator = createTerrainGenerator(
      settings({ generatorPreset: GeneratorPreset.Flat, structures: false }),
    );

    expect(defaultGenerator).toBeInstanceOf(ConfiguredTerrainGenerator);
    expect(flatGenerator.heightAt(1000, -1000)).toBe(FLAT_SURFACE_Y);
    expect(defaultGenerator.heightAt(1000, -1000)).not.toBe(FLAT_SURFACE_Y);
  });

  it('generates the documented stable Flat layer stack', () => {
    const generator = new FlatTerrainGenerator(1);
    const chunk = generator.generate(ChunkCoord.of(0, 0));
    expect(chunk.get(4, 0, 4)).toBe(BlockId.Bedrock);
    expect(chunk.get(4, 1, 4)).toBe(BlockId.Stone);
    expect(chunk.get(4, 43, 4)).toBe(BlockId.Stone);
    expect(chunk.get(4, 44, 4)).toBe(BlockId.Dirt);
    expect(chunk.get(4, 46, 4)).toBe(BlockId.Dirt);
    expect(chunk.get(4, 47, 4)).toBe(BlockId.Grass);
    expect(chunk.get(4, 48, 4)).toBe(BlockId.Air);
  });

  it('places the safe ruin only when structures are enabled', () => {
    const enabledSettings = settings({
      generatorPreset: GeneratorPreset.Flat,
      structures: true,
      bonusChest: false,
    });
    const disabledSettings = settings({ ...enabledSettings, structures: false });
    const origin = safeRuinOrigin(enabledSettings.seed);
    const y = FLAT_SURFACE_Y + 1;

    expect(
      generatedBlockAt(createTerrainGenerator(enabledSettings), origin.x, y, origin.z),
    ).toBe(BlockId.Cobblestone);
    expect(
      generatedBlockAt(createTerrainGenerator(disabledSettings), origin.x, y, origin.z),
    ).toBe(BlockId.Air);
  });

  it('places the deterministic starter chest only when requested', () => {
    const enabled = settings({
      generatorPreset: GeneratorPreset.Flat,
      structures: false,
      bonusChest: true,
    });
    const disabled = settings({ ...enabled, bonusChest: false });
    const base = new FlatTerrainGenerator(enabled.seed);
    const position = starterChestPosition(base, enabled.seed);

    expect(
      generatedBlockAt(
        createTerrainGenerator(enabled),
        position.x,
        position.y,
        position.z,
      ),
    ).toBe(BlockId.Chest);
    expect(
      generatedBlockAt(
        createTerrainGenerator(disabled),
        position.x,
        position.y,
        position.z,
      ),
    ).toBe(BlockId.Air);
    expect(starterChestPosition(base, enabled.seed)).toEqual(position);
  });

  it('uses a minimal deterministic starter loot table', () => {
    expect(starterChestLoot(123)).toEqual(starterChestLoot(123));
    expect(starterChestLoot(123)).not.toEqual(starterChestLoot(124));
    expect(starterChestLoot(123)).toHaveLength(3);
    expect(starterChestLoot(123).every((entry) => entry.count > 0)).toBe(true);
  });

  it('keeps decorated chunks deterministic', () => {
    const configured = settings({ structures: true, bonusChest: true });
    const a = new ConfiguredTerrainGenerator(
      new TerrainGenerator(configured.seed),
      configured,
    );
    const b = new ConfiguredTerrainGenerator(
      new TerrainGenerator(configured.seed),
      configured,
    );
    expect(Array.from(a.generate(ChunkCoord.of(0, 0)).data)).toEqual(
      Array.from(b.generate(ChunkCoord.of(0, 0)).data),
    );
  });
});
