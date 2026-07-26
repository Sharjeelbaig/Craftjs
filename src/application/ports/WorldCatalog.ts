import type { WorldId, WorldRecord } from '@domain/world/WorldRecord';

/**
 * Cross-world persistence boundary.
 *
 * A `WorldRepository` owns one world's state. This catalogue owns only the
 * library records needed to find and manage those isolated repositories.
 */
export interface WorldCatalog {
  list(): Promise<readonly WorldRecord[]>;
  load(id: WorldId): Promise<WorldRecord | null>;
  save(record: WorldRecord): Promise<void>;
  delete(id: WorldId): Promise<void>;
  dispose(): void;
}
