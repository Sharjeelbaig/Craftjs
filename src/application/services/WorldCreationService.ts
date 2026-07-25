import type { WorldMetadata } from '../ports/WorldRepository';
import {
  GeneratorPreset,
  createWorldCreationSettings,
  deserializeWorldCreationSettings,
  type WorldCreationSettings,
} from '@domain/world/WorldCreationSettings';
import { parseGameMode, type GameMode } from '@domain/player/GameMode';

/**
 * Existing metadata is authoritative. UI values are used only when the world
 * has never been saved, so reopening cannot silently change its generator.
 */
export function settingsForWorld(
  metadata: WorldMetadata | null,
  requested: WorldCreationSettings,
  legacyPlayerMode?: GameMode,
): WorldCreationSettings {
  if (metadata === null) return requested;
  const stored = deserializeWorldCreationSettings(metadata.creation, metadata.seed);
  if (stored !== null) return stored;

  // Legacy saves predate every optional generation feature. Migrating with
  // them disabled preserves existing base terrain and the saved player mode.
  const migrated = createWorldCreationSettings({
    ...requested,
    seed: metadata.seed | 0,
    gameMode: parseGameMode(legacyPlayerMode, requested.gameMode),
    generatorPreset: GeneratorPreset.Default,
    structures: false,
    bonusChest: false,
  });
  if (!migrated.ok) throw new Error(migrated.error);
  return migrated.value;
}
