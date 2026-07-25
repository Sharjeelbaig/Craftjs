import type { PlayerIntent } from '@domain/player/PlayerIntent';

/** Discrete actions consumed once per occurrence. */
export const InputAction = {
  ToggleFlight: 'toggleFlight',
  ToggleDebug: 'toggleDebug',
  ToggleGameMode: 'toggleGameMode',
  ToggleInventory: 'toggleInventory',
  /** Left click: attacks a creature if one is targeted, else starts mining. */
  Attack: 'attack',
  /** Right click: places the selected block. */
  Use: 'use',
  Respawn: 'respawn',
} as const;

export type InputAction = (typeof InputAction)[keyof typeof InputAction];

/** Accumulated look delta in radians since the last frame. */
export interface LookDelta {
  readonly yaw: number;
  readonly pitch: number;
}

/** Buttons whose held state matters, not just their transitions. */
export interface ButtonState {
  /** Left button: mining continues only while held. */
  readonly primary: boolean;
  /** Right button: placing repeats while held. */
  readonly secondary: boolean;
}

/**
 * Device-agnostic input port.
 *
 * Continuous state is polled; discrete events are drained. A click can
 * therefore never be missed or double-applied when frames run long or short —
 * which matters because a duplicated place or attack is a visible change to
 * the world.
 */
export interface InputSource {
  /** True while the input device has exclusive control (pointer lock). */
  readonly isCaptured: boolean;

  /** Continuous movement state for this tick. */
  getIntent(): PlayerIntent;

  /** Continuous mouse button state for this tick. */
  getButtons(): ButtonState;

  /** Consumes accumulated mouse motion. */
  consumeLookDelta(): LookDelta;

  /** Consumes discrete actions triggered since the last call. */
  consumeActions(): readonly InputAction[];

  /** Consumes a hotbar slot selection, or null when unchanged. */
  consumeSlotSelection(): number | null;

  /** Drops all pending state — used when focus or pointer lock is lost. */
  reset(): void;

  onCaptureChange(listener: (captured: boolean) => void): () => void;

  dispose(): void;
}
