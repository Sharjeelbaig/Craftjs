import type { WorldCatalog } from '@application/ports/WorldCatalog';
import {
  deserializeWorldRecord,
  type WorldId,
  type WorldRecord,
} from '@domain/world/WorldRecord';
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_WORLDS,
  ensureCraftjsSchema,
  promisifyRequest,
} from './IndexedDbSchema';

/** IndexedDB-backed library of named worlds. World contents stay in scoped repositories. */
export class IndexedDbWorldCatalog implements WorldCatalog {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private disposed = false;

  async list(): Promise<readonly WorldRecord[]> {
    const values = await this.withStore<unknown[]>(IDBTransactionModeReadOnly, (store) =>
      store.getAll(),
    );
    return values
      .map(deserializeWorldRecord)
      .filter((record): record is WorldRecord => record !== null);
  }

  async load(id: WorldId): Promise<WorldRecord | null> {
    const value = await this.withStore<unknown>(IDBTransactionModeReadOnly, (store) =>
      store.get(id),
    );
    return deserializeWorldRecord(value);
  }

  async save(record: WorldRecord): Promise<void> {
    await this.withStore(IDBTransactionModeReadWrite, (store) => store.put(record, record.id));
  }

  async delete(id: WorldId): Promise<void> {
    await this.withStore(IDBTransactionModeReadWrite, (store) => store.delete(id));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.database?.close();
    this.database = null;
    this.opening = null;
  }

  private connect(): Promise<IDBDatabase> {
    if (this.database !== null) return Promise.resolve(this.database);
    if (this.opening !== null) return this.opening;
    if (this.disposed) return Promise.reject(new Error('World catalogue disposed'));

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
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.connect();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_WORLDS, mode);
      const request = action(transaction.objectStore(STORE_WORLDS));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      promisifyRequest(request).then(resolve, reject);
    });
  }
}

const IDBTransactionModeReadOnly: IDBTransactionMode = 'readonly';
const IDBTransactionModeReadWrite: IDBTransactionMode = 'readwrite';
