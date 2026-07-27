import {
  deserializeWorldCreationSettings,
  validateWorldName,
  type WorldCreationSettings,
} from './WorldCreationSettings';

declare const worldIdBrand: unique symbol;

/** Stable storage identity. Names and seeds may change or collide; ids may not. */
export type WorldId = string & { readonly [worldIdBrand]: true };

const WORLD_ID_PATTERN = /^[-a-zA-Z0-9._]{1,96}$/u;

export interface WorldRecord {
  readonly id: WorldId;
  /** Mutable library label. Generation metadata remains immutable. */
  readonly name: string;
  readonly settings: WorldCreationSettings;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastPlayedAt: number;
}

export function parseWorldId(value: unknown): WorldId | null {
  return typeof value === 'string' && WORLD_ID_PATTERN.test(value)
    ? (value as WorldId)
    : null;
}

export function createWorldRecord(
  id: WorldId,
  settings: WorldCreationSettings,
  now: number,
): WorldRecord {
  const timestamp = validTimestamp(now);
  return Object.freeze({
    id,
    name: settings.name,
    settings,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastPlayedAt: timestamp,
  });
}

export function renameWorldRecord(
  record: WorldRecord,
  requestedName: unknown,
  now: number,
): WorldRecord | null {
  const name = validateWorldName(requestedName);
  if (name === null) return null;
  return Object.freeze({
    ...record,
    name,
    updatedAt: Math.max(record.updatedAt, validTimestamp(now)),
  });
}

export function touchWorldRecord(record: WorldRecord, now: number): WorldRecord {
  const timestamp = Math.max(record.updatedAt, validTimestamp(now));
  return Object.freeze({
    ...record,
    updatedAt: timestamp,
    lastPlayedAt: timestamp,
  });
}

/** Parses an untrusted catalogue row as one complete value or rejects it. */
export function deserializeWorldRecord(value: unknown): WorldRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<WorldRecord>;
  const id = parseWorldId(raw.id);
  const name = validateWorldName(raw.name);
  const settings = deserializeWorldCreationSettings(raw.settings);
  if (id === null || name === null || settings === null) return null;

  const createdAt = storedTimestamp(raw.createdAt);
  const updatedAt = storedTimestamp(raw.updatedAt);
  const lastPlayedAt = storedTimestamp(raw.lastPlayedAt);
  if (createdAt === null || updatedAt === null || lastPlayedAt === null) return null;
  if (updatedAt < createdAt || lastPlayedAt < createdAt) return null;

  return Object.freeze({
    id,
    name,
    settings,
    createdAt,
    updatedAt,
    lastPlayedAt,
  });
}

function validTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function storedTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}
