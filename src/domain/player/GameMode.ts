/**
 * How the world treats the player.
 *
 * Every difference between the two modes is expressed as a rule here, so
 * behaviour cannot drift apart across the codebase — there is exactly one
 * place that answers "can this happen in this mode?".
 */
export const GameMode = {
  /** Build freely: flight, instant mining, no damage. */
  Creative: 'creative',
  /** Health, fall damage, hostile creatures, timed mining. */
  Survival: 'survival',
} as const;

export type GameMode = (typeof GameMode)[keyof typeof GameMode];

export interface GameModeRules {
  readonly canFly: boolean;
  readonly takesDamage: boolean;
  /** Blocks break instantly rather than over time. */
  readonly instantMining: boolean;
  /** Hostile creatures hunt the player. */
  readonly attractsHostiles: boolean;
}

const RULES: Readonly<Record<GameMode, GameModeRules>> = Object.freeze({
  [GameMode.Creative]: Object.freeze({
    canFly: true,
    takesDamage: false,
    instantMining: true,
    attractsHostiles: false,
  }),
  [GameMode.Survival]: Object.freeze({
    canFly: false,
    takesDamage: true,
    instantMining: false,
    attractsHostiles: true,
  }),
});

export function rulesFor(mode: GameMode): GameModeRules {
  return RULES[mode] ?? RULES[GameMode.Survival];
}

/** Normalises an untrusted value (query string, save file) to a valid mode. */
export function parseGameMode(value: unknown, fallback: GameMode = GameMode.Survival): GameMode {
  return value === GameMode.Creative || value === GameMode.Survival ? value : fallback;
}
