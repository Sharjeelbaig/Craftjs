import type { WorldMetadata, WorldRepository } from '@application/ports/WorldRepository';
import type { ChunkEdits } from '@domain/world/Chunk';
import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { PlayerSnapshot } from '@domain/player/Player';

/**
 * Volatile repository used when IndexedDB is unavailable, and as a test double.
 *
 * The game must be playable without storage; falling back here means private
 * browsing or a blocked database costs the player persistence, not the session.
 */
export class InMemoryWorldRepository implements WorldRepository {
  private readonly chunks = new Map<string, ChunkEdits>();
  private metadata: WorldMetadata | null = null;
  private player: PlayerSnapshot | null = null;

  loadMetadata(): Promise<WorldMetadata | null> {
    return Promise.resolve(this.metadata);
  }

  saveMetadata(metadata: WorldMetadata): Promise<void> {
    this.metadata = metadata;
    return Promise.resolve();
  }

  loadChunkEdits(coord: ChunkCoord): Promise<ChunkEdits | null> {
    return Promise.resolve(this.chunks.get(coord.key) ?? null);
  }

  saveChunkEdits(coord: ChunkCoord, edits: ChunkEdits): Promise<void> {
    // Copy so later mutations of the caller's arrays cannot corrupt the store.
    this.chunks.set(coord.key, {
      indices: Uint16Array.from(edits.indices),
      blocks: Uint8Array.from(edits.blocks),
    });
    return Promise.resolve();
  }

  loadPlayer(): Promise<PlayerSnapshot | null> {
    return Promise.resolve(this.player);
  }

  savePlayer(snapshot: PlayerSnapshot): Promise<void> {
    this.player = snapshot;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.chunks.clear();
    this.metadata = null;
    this.player = null;
    return Promise.resolve();
  }

  dispose(): void {
    this.chunks.clear();
  }
}
