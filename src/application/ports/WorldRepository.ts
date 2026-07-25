import type { ChunkEdits } from '@domain/world/Chunk';
import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { PlayerSnapshot } from '@domain/player/Player';
import type { WeatherSnapshot } from '@domain/world/Weather';
import type { WorldCreationSettings } from '@domain/world/WorldCreationSettings';

export interface WorldMetadata {
  readonly seed: number;
  /** Save format version, so future migrations can detect old data. */
  readonly version: number;
  readonly updatedAt: number;
  /** Point in the day/night cycle, in [0, 1). Absent in version 1 saves. */
  readonly timeOfDay?: number;
  /** Absent in saves written before weather was introduced. */
  readonly weather?: WeatherSnapshot;
  /** Immutable world-defining options. Absent only in legacy saves. */
  readonly creation?: WorldCreationSettings;
}

/**
 * Durable storage for the parts of the world that cannot be recomputed:
 * the seed, the player, and the delta between generated terrain and what the
 * player built.
 *
 * Every method is allowed to fail; the game must remain playable without
 * persistence, so implementations should reject rather than throw
 * synchronously, and callers treat failures as non-fatal.
 */
export interface WorldRepository {
  loadMetadata(): Promise<WorldMetadata | null>;
  saveMetadata(metadata: WorldMetadata): Promise<void>;

  loadChunkEdits(coord: ChunkCoord): Promise<ChunkEdits | null>;
  saveChunkEdits(coord: ChunkCoord, edits: ChunkEdits): Promise<void>;

  loadPlayer(): Promise<PlayerSnapshot | null>;
  savePlayer(snapshot: PlayerSnapshot): Promise<void>;

  /** Deletes every stored record for this world. */
  clear(): Promise<void>;
  dispose(): void;
}
