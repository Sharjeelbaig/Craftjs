import type { WorldCatalog } from '@application/ports/WorldCatalog';
import type { WorldId, WorldRecord } from '@domain/world/WorldRecord';

/** Volatile catalogue used by tests and storage-restricted browsers. */
export class InMemoryWorldCatalog implements WorldCatalog {
  private readonly records = new Map<WorldId, WorldRecord>();

  list(): Promise<readonly WorldRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  load(id: WorldId): Promise<WorldRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  save(record: WorldRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  delete(id: WorldId): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }

  dispose(): void {
    this.records.clear();
  }
}
