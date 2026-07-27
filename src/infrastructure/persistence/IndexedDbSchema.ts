export const DATABASE_NAME = 'craftjs';
export const DATABASE_VERSION = 2;

export const STORE_CHUNKS = 'chunks';
export const STORE_STATE = 'state';
export const STORE_WORLDS = 'worlds';

/** Every upgrader creates the complete schema, regardless of which adapter opened first. */
export function ensureCraftjsSchema(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(STORE_CHUNKS)) {
    database.createObjectStore(STORE_CHUNKS);
  }
  if (!database.objectStoreNames.contains(STORE_STATE)) {
    database.createObjectStore(STORE_STATE);
  }
  if (!database.objectStoreNames.contains(STORE_WORLDS)) {
    database.createObjectStore(STORE_WORLDS);
  }
}

export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
