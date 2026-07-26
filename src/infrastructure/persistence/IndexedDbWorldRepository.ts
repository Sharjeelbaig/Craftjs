import type { WorldMetadata, WorldRepository } from '@application/ports/WorldRepository';
import type { ChunkEdits } from '@domain/world/Chunk';
import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { PlayerSnapshot } from '@domain/player/Player';
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_CHUNKS,
  STORE_STATE,
  ensureCraftjsSchema,
  promisifyRequest,
} from './IndexedDbSchema';

/** Highest code unit, used as the exclusive upper bound of a key prefix scan. */
const KEY_MAX = '￿';

/** Shape written to IndexedDB. Structured-clone friendly. */
interface StoredChunk {
  readonly indices: Uint16Array;
  readonly blocks: Uint8Array;
}

/**
 * Durable world storage backed by IndexedDB.
 *
 * Only the player's edit delta is stored — generated terrain is reproduced
 * from the seed — so a save stays a few kilobytes no matter how far the player
 * travels. Writes are coalesced per chunk and never block a frame.
 *
 * Every record is namespaced by world id. Without it, switching seeds would
 * restore the previous world's player position and replay its edits onto
 * unrelated terrain, which corrupts both saves.
 */
export class IndexedDbWorldRepository implements WorldRepository {
  private readonly prefix: string;
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private disposed = false;

  /**
   * @param worldId Identifies the world; records from different ids never mix.
   */
  constructor(worldId: string) {
    this.prefix = `${worldId}:`;
  }

  private chunkKey(coord: ChunkCoord): string {
    return this.prefix + coord.key;
  }

  private stateKey(name: string): string {
    return this.prefix + name;
  }

  private connect(): Promise<IDBDatabase> {
    if (this.database !== null) return Promise.resolve(this.database);
    if (this.opening !== null) return this.opening;

    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => ensureCraftjsSchema(request.result);

      request.onsuccess = () => {
        const database = request.result;
        // Another tab upgrading the schema would otherwise leave this
        // connection wedged and every later write hanging.
        database.onversionchange = () => {
          database.close();
          this.database = null;
          this.opening = null;
        };
        this.database = database;
        resolve(database);
      };

      request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    }).catch((error: unknown) => {
      this.opening = null;
      throw error;
    });

    return this.opening;
  }

  private async withStore<T>(
    store: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (this.disposed) throw new Error('Repository disposed');
    const database = await this.connect();

    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const request = action(transaction.objectStore(store));

      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));

      promisifyRequest(request).then(resolve, reject);
    });
  }

  async loadMetadata(): Promise<WorldMetadata | null> {
    const value = await this.withStore<WorldMetadata | undefined>(
      STORE_STATE,
      'readonly',
      (store) => store.get(this.stateKey('metadata')),
    );
    return value ?? null;
  }

  async saveMetadata(metadata: WorldMetadata): Promise<void> {
    await this.withStore(STORE_STATE, 'readwrite', (store) =>
      store.put(metadata, this.stateKey('metadata')),
    );
  }

  async loadChunkEdits(coord: ChunkCoord): Promise<ChunkEdits | null> {
    const stored = await this.withStore<StoredChunk | undefined>(
      STORE_CHUNKS,
      'readonly',
      (store) => store.get(this.chunkKey(coord)),
    );
    if (stored === undefined) return null;

    // Guard against records written by an older or corrupted build.
    if (!(stored.indices instanceof Uint16Array) || !(stored.blocks instanceof Uint8Array)) {
      return null;
    }
    return { indices: stored.indices, blocks: stored.blocks };
  }

  async saveChunkEdits(coord: ChunkCoord, edits: ChunkEdits): Promise<void> {
    const record: StoredChunk = { indices: edits.indices, blocks: edits.blocks };
    await this.withStore(STORE_CHUNKS, 'readwrite', (store) =>
      store.put(record, this.chunkKey(coord)),
    );
  }

  async loadPlayer(): Promise<PlayerSnapshot | null> {
    const value = await this.withStore<PlayerSnapshot | undefined>(
      STORE_STATE,
      'readonly',
      (store) => store.get(this.stateKey('player')),
    );
    return value ?? null;
  }

  async savePlayer(snapshot: PlayerSnapshot): Promise<void> {
    await this.withStore(STORE_STATE, 'readwrite', (store) =>
      store.put(snapshot, this.stateKey('player')),
    );
  }

  /** Deletes this world's records only; other worlds are untouched. */
  async clear(): Promise<void> {
    await this.clearPrefixed(STORE_CHUNKS);
    await this.clearPrefixed(STORE_STATE);
  }

  private async clearPrefixed(store: string): Promise<void> {
    const range = IDBKeyRange.bound(this.prefix, this.prefix + KEY_MAX, false, true);
    await this.withStore<undefined>(store, 'readwrite', (objectStore) =>
      objectStore.delete(range),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.database?.close();
    this.database = null;
    this.opening = null;
  }
}
