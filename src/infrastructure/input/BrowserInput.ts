import {
  InputAction,
  type ButtonState,
  type InputSource,
  type LookDelta,
} from '@application/ports/InputSource';
import type { PlayerIntent } from '@domain/player/PlayerIntent';
import { HOTBAR_BLOCKS } from '@domain/world/BlockType';

/** Radians of rotation per pixel of mouse movement at sensitivity 1. */
const RADIANS_PER_PIXEL = 0.0022;

/**
 * Guards against a single spurious high-delta mouse event — seen when pointer
 * lock engages, or on some trackpads — spinning the camera wildly.
 */
const MAX_DELTA_PER_EVENT = 400;

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
]);

/**
 * Keyboard and pointer-lock mouse adapter.
 *
 * Continuous state is polled by the game loop; discrete actions are queued and
 * drained, so a click is never lost between frames and never applied twice —
 * which matters because a duplicated place/break is a visible world edit.
 */
export class BrowserInput implements InputSource {
  private readonly canvas: HTMLCanvasElement;

  private readonly pressed = new Set<string>();
  private readonly actions: InputAction[] = [];
  private pendingSlot: number | null = null;
  /** Mirrors the selected hotbar slot so wheel steps are relative to it. */
  private currentSlot = 0;

  private primaryDown = false;
  private secondaryDown = false;
  /** Seconds until a held right button places again. */
  private useRepeatTimer = 0;

  private lookYaw = 0;
  private lookPitch = 0;
  private captured = false;
  private disposed = false;

  private readonly captureListeners = new Set<(captured: boolean) => void>();

  /** Multiplies mouse look speed. */
  sensitivity = 1;
  /** Inverts vertical look. */
  invertY = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    // Mouse-up is bound to the document, not the canvas: releasing outside the
    // canvas would otherwise leave the button latched down forever.
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('wheel', this.handleWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    globalThis.addEventListener?.('blur', this.handleBlur);
  }

  get isCaptured(): boolean {
    return this.captured;
  }

  /** Requests pointer lock. Safe to call when already locked. */
  requestCapture(): void {
    if (this.disposed || this.captured) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects if the gesture was stale.
      if (result instanceof Promise) result.catch(() => this.reset());
    } catch {
      /* pointer lock unavailable; the game stays paused */
    }
  }

  releaseCapture(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  getIntent(): PlayerIntent {
    if (!this.captured) return { moveRight: 0, moveForward: 0, up: false, down: false, sprint: false };

    const forward = (this.pressed.has('KeyW') ? 1 : 0) - (this.pressed.has('KeyS') ? 1 : 0);
    const right = (this.pressed.has('KeyD') ? 1 : 0) - (this.pressed.has('KeyA') ? 1 : 0);

    return {
      moveForward: forward,
      moveRight: right,
      up: this.pressed.has('Space'),
      down: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
      sprint: this.pressed.has('ControlLeft') || this.pressed.has('ControlRight'),
    };
  }

  getButtons(): ButtonState {
    if (!this.captured) return RELEASED_BUTTONS;
    return { primary: this.primaryDown, secondary: this.secondaryDown };
  }

  consumeLookDelta(): LookDelta {
    const delta = { yaw: this.lookYaw, pitch: this.lookPitch };
    this.lookYaw = 0;
    this.lookPitch = 0;
    return delta;
  }

  consumeActions(): readonly InputAction[] {
    // Holding the right button keeps placing, at a fixed rate. Emitting it
    // here rather than per mousedown means the repeat rate is independent of
    // frame rate, so a fast machine does not build faster than a slow one.
    if (this.captured && this.secondaryDown) {
      const now = performance.now();
      if (now >= this.useRepeatTimer) {
        this.useRepeatTimer = now + USE_REPEAT_MS;
        this.actions.push(InputAction.Use);
      }
    }

    if (this.actions.length === 0) return EMPTY_ACTIONS;
    return this.actions.splice(0, this.actions.length);
  }

  consumeSlotSelection(): number | null {
    const slot = this.pendingSlot;
    this.pendingSlot = null;
    return slot;
  }

  reset(): void {
    this.pressed.clear();
    this.actions.length = 0;
    this.pendingSlot = null;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.primaryDown = false;
    this.secondaryDown = false;
    this.useRepeatTimer = 0;
  }

  onCaptureChange(listener: (captured: boolean) => void): () => void {
    this.captureListeners.add(listener);
    return () => this.captureListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('wheel', this.handleWheel);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    globalThis.removeEventListener?.('blur', this.handleBlur);

    this.captureListeners.clear();
    this.reset();
    this.releaseCapture();
  }

  // ------------------------------------------------------------------ handlers

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.captured) {
      this.requestCapture();
      return;
    }

    if (event.button === 0) {
      this.primaryDown = true;
      this.actions.push(InputAction.Attack);
    } else if (event.button === 2) {
      this.secondaryDown = true;
      this.actions.push(InputAction.Use);
      // Start the repeat clock after this click so a tap places exactly once.
      this.useRepeatTimer = performance.now() + USE_REPEAT_MS;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.primaryDown = false;
    else if (event.button === 2) this.secondaryDown = false;
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    // Right-click places blocks; the browser menu would interrupt play.
    event.preventDefault();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.captured) return;

    const dx = clampDelta(event.movementX);
    const dy = clampDelta(event.movementY);

    this.lookYaw -= dx * RADIANS_PER_PIXEL * this.sensitivity;
    this.lookPitch -= (this.invertY ? -dy : dy) * RADIANS_PER_PIXEL * this.sensitivity;
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Never interfere with OS-level shortcuts.
    if (event.metaKey || event.altKey) return;

    if (MOVEMENT_KEYS.has(event.code) && this.captured) event.preventDefault();

    // Movement state is tracked even while Ctrl is held — Ctrl *is* the sprint
    // modifier, so ignoring keys during it would make sprinting impossible.
    this.pressed.add(event.code);

    // Auto-repeat must not enqueue a stream of discrete actions.
    if (event.repeat) return;
    // Ctrl combinations are browser shortcuts, never game actions.
    if (event.ctrlKey) return;

    switch (event.code) {
      case 'KeyF':
        if (this.captured) this.actions.push(InputAction.ToggleFlight);
        break;
      case 'KeyG':
        if (this.captured) this.actions.push(InputAction.ToggleGameMode);
        break;
      case 'KeyE':
        event.preventDefault();
        this.actions.push(InputAction.ToggleInventory);
        break;
      case 'KeyR':
      case 'Enter':
        this.actions.push(InputAction.Respawn);
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        // Shift is sneak on foot and dismount in the saddle; the game decides
        // which applies, so the adapter emits it unconditionally.
        if (this.captured) this.actions.push(InputAction.Dismount);
        break;
      case 'F3':
        event.preventDefault();
        this.actions.push(InputAction.ToggleDebug);
        break;
      default:
        this.handleSlotKey(event.code);
    }
  };

  private handleSlotKey(code: string): void {
    if (!code.startsWith('Digit')) return;
    const digit = Number.parseInt(code.slice(5), 10);
    if (!Number.isInteger(digit) || digit < 1 || digit > HOTBAR_BLOCKS.length) return;
    this.currentSlot = digit - 1;
    this.pendingSlot = this.currentSlot;
  }

  /** Aligns the wheel's reference point with the game's authoritative slot. */
  syncSlot(slot: number): void {
    this.currentSlot = slot;
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.captured || event.deltaY === 0) return;
    const step = event.deltaY > 0 ? 1 : -1;
    const count = HOTBAR_BLOCKS.length;
    // Wrap so the hotbar cycles rather than sticking at either end.
    this.currentSlot = (this.currentSlot + step + count) % count;
    this.pendingSlot = this.currentSlot;
  };

  private readonly handlePointerLockChange = (): void => {
    const captured = document.pointerLockElement === this.canvas;
    if (captured === this.captured) return;

    this.captured = captured;
    // Releasing the pointer must not leave keys latched down.
    if (!captured) this.reset();

    for (const listener of this.captureListeners) listener(captured);
  };

  private readonly handlePointerLockError = (): void => {
    this.captured = false;
    this.reset();
    for (const listener of this.captureListeners) listener(false);
  };

  private readonly handleBlur = (): void => {
    this.reset();
  };
}

const EMPTY_ACTIONS: readonly InputAction[] = Object.freeze([]);

const RELEASED_BUTTONS: ButtonState = Object.freeze({ primary: false, secondary: false });

/** Interval between placements while the right button is held. */
const USE_REPEAT_MS = 220;

function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_DELTA_PER_EVENT, Math.min(MAX_DELTA_PER_EVENT, value));
}
