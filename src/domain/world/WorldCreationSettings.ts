import { seedFromString } from '../generation/Noise';
import { GameMode, parseGameMode } from '../player/GameMode';

export const GeneratorPreset = {
  Default: 'default',
  Flat: 'flat',
} as const;

export type GeneratorPreset = (typeof GeneratorPreset)[keyof typeof GeneratorPreset];

export const WORLD_NAME_MAX_LENGTH = 48;
export const SEED_TEXT_MAX_LENGTH = 128;
const MIN_SEED = -2147483648;
const MAX_SEED = 2147483647;

/**
 * Immutable choices that define a world.
 *
 * This value crosses the presentation/application boundary once at creation
 * and is then loaded from metadata. Runtime UI defaults never mutate it.
 */
export interface WorldCreationSettings {
  readonly name: string;
  readonly seed: number;
  readonly gameMode: GameMode;
  readonly generatorPreset: GeneratorPreset;
  readonly structures: boolean;
  readonly bonusChest: boolean;
}

export interface WorldCreationSettingsInput {
  readonly name: string;
  readonly seed: number;
  readonly gameMode: GameMode;
  readonly generatorPreset: GeneratorPreset;
  readonly structures: boolean;
  readonly bonusChest: boolean;
}

export type WorldCreationValidation =
  | { readonly ok: true; readonly value: WorldCreationSettings }
  | { readonly ok: false; readonly error: string };

export function validateWorldName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > WORLD_NAME_MAX_LENGTH) return null;
  return /[\u0000-\u001f\u007f]/u.test(name) ? null : name;
}

/** Accepts signed integers or text seeds, matching the generator's int32 seed. */
export function parseWorldSeed(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > SEED_TEXT_MAX_LENGTH) return null;
  if (/^[+-]?\d+$/u.test(text)) {
    const numeric = Number(text);
    return Number.isSafeInteger(numeric) && numeric >= MIN_SEED && numeric <= MAX_SEED
      ? numeric
      : null;
  }
  return seedFromString(text) | 0;
}

export function parseGeneratorPreset(
  value: unknown,
  fallback: GeneratorPreset = GeneratorPreset.Default,
): GeneratorPreset {
  return value === GeneratorPreset.Default || value === GeneratorPreset.Flat ? value : fallback;
}

/** Validates new-world input and returns a frozen domain value. */
export function createWorldCreationSettings(
  input: WorldCreationSettingsInput,
): WorldCreationValidation {
  const name = validateWorldName(input.name);
  if (name === null) {
    return {
      ok: false,
      error: `World name must be 1–${WORLD_NAME_MAX_LENGTH} characters without control characters.`,
    };
  }
  if (
    !Number.isFinite(input.seed) ||
    !Number.isInteger(input.seed) ||
    input.seed < MIN_SEED ||
    input.seed > MAX_SEED
  ) {
    return { ok: false, error: 'World seed must resolve to a valid 32-bit integer.' };
  }
  if (parseGameMode(input.gameMode, '' as GameMode) !== input.gameMode) {
    return { ok: false, error: 'Choose a valid game mode.' };
  }
  if (parseGeneratorPreset(input.generatorPreset, '' as GeneratorPreset) !== input.generatorPreset) {
    return { ok: false, error: 'Choose a valid generator preset.' };
  }
  if (typeof input.structures !== 'boolean' || typeof input.bonusChest !== 'boolean') {
    return { ok: false, error: 'World options must be enabled or disabled explicitly.' };
  }

  return {
    ok: true,
    value: Object.freeze({
      name,
      seed: input.seed | 0,
      gameMode: input.gameMode,
      generatorPreset: input.generatorPreset,
      structures: input.structures,
      bonusChest: input.bonusChest,
    }),
  };
}

/**
 * Parses untrusted persisted data. Invalid records return null instead of
 * partially applying settings from a corrupt save.
 */
export function deserializeWorldCreationSettings(
  value: unknown,
  expectedSeed?: number,
): WorldCreationSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<WorldCreationSettings>;
  const result = createWorldCreationSettings({
    name: raw.name as string,
    seed: raw.seed as number,
    gameMode: raw.gameMode as GameMode,
    generatorPreset: raw.generatorPreset as GeneratorPreset,
    structures: raw.structures as boolean,
    bonusChest: raw.bonusChest as boolean,
  });
  if (!result.ok) return null;
  if (expectedSeed !== undefined && result.value.seed !== (expectedSeed | 0)) return null;
  return result.value;
}

export function defaultWorldCreationSettings(
  seed: number,
  gameMode: GameMode = GameMode.Survival,
): WorldCreationSettings {
  const result = createWorldCreationSettings({
    name: `World ${seed | 0}`,
    seed: seed | 0,
    gameMode,
    generatorPreset: GeneratorPreset.Default,
    structures: true,
    bonusChest: false,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
