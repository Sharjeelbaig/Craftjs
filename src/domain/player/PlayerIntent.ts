/**
 * What the player wants to do this tick, expressed without reference to any
 * input device. The input adapter translates keys into this; movement rules
 * consume only this. Rebinding, gamepads or replays need no domain changes.
 */
export interface PlayerIntent {
  /** Strafe axis: -1 left, +1 right. */
  readonly moveRight: number;
  /** Forward axis: -1 backward, +1 forward. */
  readonly moveForward: number;
  /** Jump, swim up, or ascend while flying. */
  readonly up: boolean;
  /** Sneak, sink, or descend while flying. */
  readonly down: boolean;
  readonly sprint: boolean;
}

export const NO_INTENT: PlayerIntent = Object.freeze({
  moveRight: 0,
  moveForward: 0,
  up: false,
  down: false,
  sprint: false,
});
