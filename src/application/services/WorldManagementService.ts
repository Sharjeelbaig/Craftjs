import type { WorldCatalog } from '../ports/WorldCatalog';
import type { WorldRepository } from '../ports/WorldRepository';
import type { WorldCreationSettings } from '@domain/world/WorldCreationSettings';
import {
  createWorldRecord,
  parseWorldId,
  renameWorldRecord,
  touchWorldRecord,
  type WorldId,
  type WorldRecord,
} from '@domain/world/WorldRecord';

export type WorldRepositoryFactory = (id: WorldId) => WorldRepository;
export type WorldIdFactory = () => string;

export interface OpenedWorld {
  readonly record: WorldRecord;
  readonly repository: WorldRepository;
}

export class WorldNotFoundError extends Error {
  constructor(id: string) {
    super(`World "${id}" does not exist.`);
    this.name = 'WorldNotFoundError';
  }
}

/**
 * Named-world lifecycle independent of presentation.
 *
 * The service never interprets DOM state and never reaches into IndexedDB.
 * It coordinates a catalogue with isolated per-world repositories, which is
 * what allows two named worlds to use the same seed without sharing edits.
 */
export class WorldManagementService {
  constructor(
    private readonly catalog: WorldCatalog,
    private readonly openRepository: WorldRepositoryFactory,
    private readonly createId: WorldIdFactory = defaultWorldId,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<readonly WorldRecord[]> {
    const records = await this.catalog.list();
    return [...records].sort(
      (a, b) => b.lastPlayedAt - a.lastPlayedAt || a.name.localeCompare(b.name),
    );
  }

  /** Creates a new isolated world entry, even when another entry has the same seed. */
  async create(settings: WorldCreationSettings): Promise<WorldRecord> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = parseWorldId(this.createId());
      if (id === null) throw new Error('World id generator returned an invalid id.');
      if ((await this.catalog.load(id)) !== null) continue;

      const record = createWorldRecord(id, settings, this.now());
      await this.catalog.save(record);
      return record;
    }
    throw new Error('Could not allocate a unique world id.');
  }

  /**
   * Adds a legacy or externally-created world without overwriting a renamed
   * catalogue entry. Used while migrating the former seed-keyed save layout.
   */
  async registerExisting(
    rawId: string,
    settings: WorldCreationSettings,
  ): Promise<WorldRecord> {
    const id = parseWorldId(rawId);
    if (id === null) throw new Error('Cannot register an invalid world id.');
    const existing = await this.catalog.load(id);
    if (existing !== null) return existing;

    const record = createWorldRecord(id, settings, this.now());
    await this.catalog.save(record);
    return record;
  }

  async open(rawId: string): Promise<OpenedWorld> {
    const id = parseWorldId(rawId);
    if (id === null) throw new WorldNotFoundError(rawId);
    const existing = await this.catalog.load(id);
    if (existing === null) throw new WorldNotFoundError(rawId);

    const record = touchWorldRecord(existing, this.now());
    await this.catalog.save(record);
    return { record, repository: this.openRepository(id) };
  }

  async rename(rawId: string, requestedName: unknown): Promise<WorldRecord> {
    const existing = await this.required(rawId);
    const renamed = renameWorldRecord(existing, requestedName, this.now());
    if (renamed === null) {
      throw new Error('World name is empty, too long, or contains control characters.');
    }
    await this.catalog.save(renamed);
    return renamed;
  }

  /**
   * Deletes state before its library row. A storage failure therefore leaves
   * a retryable world entry instead of an orphaned save the player cannot find.
   */
  async delete(rawId: string): Promise<void> {
    const record = await this.required(rawId);
    const repository = this.openRepository(record.id);
    try {
      await repository.clear();
    } finally {
      repository.dispose();
    }
    await this.catalog.delete(record.id);
  }

  dispose(): void {
    this.catalog.dispose();
  }

  private async required(rawId: string): Promise<WorldRecord> {
    const id = parseWorldId(rawId);
    if (id === null) throw new WorldNotFoundError(rawId);
    const record = await this.catalog.load(id);
    if (record === null) throw new WorldNotFoundError(rawId);
    return record;
  }
}

function defaultWorldId(): string {
  const random = Math.floor(Math.random() * 0x100000000)
    .toString(36)
    .padStart(7, '0');
  return `world-${Date.now().toString(36)}-${random}`;
}
