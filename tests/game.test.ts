import { describe, expect, it } from 'vitest';
import { Game } from '@application/Game';
import type { LoopClock } from '@application/GameLoop';
import type { ChunkMesher, MeshRequest, MeshResponse } from '@application/ports/ChunkMesher';
import type { CameraPose, GameRenderer, RenderStats } from '@application/ports/GameRenderer';
import {
  InputAction,
  type ButtonState,
  type InputSource,
  type LookDelta,
} from '@application/ports/InputSource';
import type { PlayerIntent } from '@domain/player/PlayerIntent';
import { NO_INTENT } from '@domain/player/PlayerIntent';
import { MovementMode, PLAYER_EYE_HEIGHT } from '@domain/player/Player';
import { GameMode } from '@domain/player/GameMode';
import { BlockId, HOTBAR_BLOCKS } from '@domain/world/BlockType';
import { buildChunkMesh } from '@infrastructure/meshing/ChunkMeshBuilder';
import { InMemoryWorldRepository } from '@infrastructure/persistence/InMemoryWorldRepository';

class ManualClock implements LoopClock {
  private time = 0;
  private pending: ((timestamp: number) => void) | null = null;

  now(): number {
    return this.time;
  }
  request(callback: (timestamp: number) => void): number {
    this.pending = callback;
    return 1;
  }
  cancel(): void {
    this.pending = null;
  }
  /** Advances one frame of `ms`. */
  frame(ms = 1000 / 60): void {
    this.time += ms;
    const callback = this.pending;
    this.pending = null;
    callback?.(this.time);
  }
}

class StubInput implements InputSource {
  isCaptured = true;
  intent: PlayerIntent = NO_INTENT;
  look: LookDelta = { yaw: 0, pitch: 0 };
  actions: InputAction[] = [];
  slot: number | null = null;
  buttons: ButtonState = { primary: false, secondary: false };
  resets = 0;

  getIntent(): PlayerIntent {
    return this.intent;
  }

  getButtons(): ButtonState {
    return this.buttons;
  }
  consumeLookDelta(): LookDelta {
    const delta = this.look;
    this.look = { yaw: 0, pitch: 0 };
    return delta;
  }
  consumeActions(): readonly InputAction[] {
    return this.actions.splice(0, this.actions.length);
  }
  consumeSlotSelection(): number | null {
    const slot = this.slot;
    this.slot = null;
    return slot;
  }
  reset(): void {
    this.resets++;
  }
  onCaptureChange(): () => void {
    return () => {};
  }
  dispose(): void {}
}

class StubRenderer implements GameRenderer {
  lastCamera: CameraPose | null = null;
  highlights: (string | null)[] = [];
  submerged = false;
  renders = 0;
  disposed = false;
  breakProgress = 0;
  entityCount = 0;
  daylight = 1;

  updateChunk(): void {}
  removeChunk(): void {}
  syncEntities(views: readonly { id: number }[]): void {
    this.entityCount = views.length;
  }
  setBlockHighlight(block: { x: number; y: number; z: number } | null): void {
    this.highlights.push(block === null ? null : `${block.x},${block.y},${block.z}`);
  }
  setBreakProgress(progress: number): void {
    this.breakProgress = progress;
  }
  setSubmerged(submerged: boolean): void {
    this.submerged = submerged;
  }
  setSky(sky: { light: number }): void {
    this.daylight = sky.light;
  }
  setRenderDistance(): void {}
  render(camera: CameraPose): void {
    this.lastCamera = camera;
    this.renders++;
  }
  getStats(): RenderStats {
    return { drawCalls: 0, triangles: 0, chunkMeshes: 0, entities: this.entityCount };
  }
  dispose(): void {
    this.disposed = true;
  }
}

const immediateMesher: ChunkMesher = {
  capacity: 4,
  submit: (request: MeshRequest): Promise<MeshResponse> =>
    Promise.resolve({
      coord: request.coord,
      revision: request.revision,
      data: buildChunkMesh(request.paddedVolume),
    }),
  dispose() {},
};

interface Built {
  game: Game;
  clock: ManualClock;
  input: StubInput;
  renderer: StubRenderer;
  repository: InMemoryWorldRepository;
}

function build(
  seed = 777,
  repository = new InMemoryWorldRepository(),
  gameMode: GameMode = GameMode.Creative,
): Built {
  const clock = new ManualClock();
  const input = new StubInput();
  const renderer = new StubRenderer();

  const game = new Game({
    renderer,
    input,
    mesher: immediateMesher,
    repository,
    durablePersistence: true,
    seed,
    gameMode,
    clock,
    // Creature spawning is exercised in its own suite; leaving it on here
    // would make unrelated assertions depend on random population.
    spawning: { maxPassive: 0, maxHostile: 0 },
    adaptiveQuality: false,
    streaming: { renderDistance: 1, generationBudgetMs: 1000, maxUploadsPerFrame: 64 },
  });

  return { game, clock, input, renderer, repository };
}

/** Runs `count` frames, draining promises between them. */
async function frames(built: Built, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    built.clock.frame();
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('Game', () => {
  it('spawns the player on solid ground, not inside terrain', async () => {
    const built = build();
    await built.game.start();

    const { player, world } = built.game;
    expect(world.loadedChunkCount).toBeGreaterThan(0);
    // Feet are in open space and there is something underneath.
    expect(world.getBlock(player.x, player.y, player.z)).toBe(BlockId.Air);
    expect(player.y).toBeGreaterThan(0);

    await built.game.dispose();
  });

  it('renders once per frame from the eye position', async () => {
    const built = build();
    await built.game.start();
    await frames(built, 3);

    expect(built.renderer.renders).toBe(3);
    const camera = built.renderer.lastCamera!;
    expect(camera.position.y).toBeCloseTo(built.game.player.y + PLAYER_EYE_HEIGHT, 1);
    expect(camera.yaw).toBe(built.game.player.yaw);

    await built.game.dispose();
  });

  it('applies look input exactly once even when several ticks run', async () => {
    const built = build();
    await built.game.start();

    built.input.look = { yaw: 0.5, pitch: 0 };
    // A long frame runs multiple simulation steps.
    built.clock.frame(100);
    await Promise.resolve();

    expect(built.game.player.yaw).toBeCloseTo(0.5, 6);

    await built.game.dispose();
  });

  it('toggles flight and the debug overlay through input actions', async () => {
    const built = build();
    await built.game.start();

    let debugVisible = false;
    built.game.onDebugToggle((visible) => {
      debugVisible = visible;
    });

    built.input.actions.push(InputAction.ToggleFlight, InputAction.ToggleDebug);
    await frames(built, 1);

    expect(built.game.player.mode).toBe(MovementMode.Flying);
    expect(debugVisible).toBe(true);
    expect(built.game.debugVisible).toBe(true);

    await built.game.dispose();
  });

  it('changes the selected block and notifies listeners', async () => {
    const built = build();
    await built.game.start();

    const seen: number[] = [];
    built.game.onSlotChange((slot) => seen.push(slot));

    built.input.slot = 3;
    await frames(built, 1);

    expect(built.game.player.selectedSlot).toBe(3);
    expect(built.game.selectedBlock).toBe(HOTBAR_BLOCKS[3]);
    expect(seen).toEqual([3]);

    await built.game.dispose();
  });

  it('breaks and places blocks through input actions', async () => {
    const built = build();
    await built.game.start();
    await frames(built, 4);

    const { player, world } = built.game;
    const groundY = Math.floor(player.y) - 1;
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    expect(world.getBlock(x, groundY, z)).not.toBe(BlockId.Air);

    // Hover clear of the target so the replacement block cannot intersect the
    // player, which would legitimately reject the placement.
    player.mode = MovementMode.Flying;
    player.moveTo(player.x, groundY + 3, player.z);
    player.pitch = -Math.PI / 2 + 0.01; // straight down

    built.input.actions.push(InputAction.Attack);
    await frames(built, 1);
    expect(world.getBlock(x, groundY, z)).toBe(BlockId.Air);

    built.input.actions.push(InputAction.Use);
    await frames(built, 1);
    expect(world.getBlock(x, groundY, z)).toBe(built.game.selectedBlock);

    await built.game.dispose();
  });

  it('refuses to place a block into the space the player occupies', async () => {
    const built = build();
    await built.game.start();
    await frames(built, 4);

    const { player, world } = built.game;
    const groundY = Math.floor(player.y) - 1;
    const x = Math.floor(player.x);
    const z = Math.floor(player.z);

    player.pitch = -Math.PI / 2 + 0.01;
    built.input.actions.push(InputAction.Attack);
    await frames(built, 1);
    expect(world.getBlock(x, groundY, z)).toBe(BlockId.Air);

    // The player is now falling into the hole; refilling it would entomb them.
    built.input.actions.push(InputAction.Use);
    await frames(built, 1);
    expect(world.getBlock(x, groundY, z)).toBe(BlockId.Air);

    await built.game.dispose();
  });

  it('persists the player and restores them on the next session', async () => {
    const repository = new InMemoryWorldRepository();
    const first = build(1234, repository);
    await first.game.start();

    first.game.player.moveTo(40.5, 90, -20.5);
    first.game.player.yaw = 1.25;
    first.game.player.selectedSlot = 2;
    await first.game.save();
    await first.game.dispose();

    const second = build(1234, repository);
    await second.game.start();

    expect(second.game.player.x).toBeCloseTo(40.5);
    expect(second.game.player.z).toBeCloseTo(-20.5);
    expect(second.game.player.yaw).toBeCloseTo(1.25);
    expect(second.game.player.selectedSlot).toBe(2);

    await second.game.dispose();
  });

  it('lifts a restored player out of solid terrain', async () => {
    const repository = new InMemoryWorldRepository();
    // A snapshot that would leave the player buried at bedrock level.
    await repository.savePlayer({
      x: 0.5,
      y: 1,
      z: 0.5,
      yaw: 0,
      pitch: 0,
      mode: MovementMode.Walking,
      selectedSlot: 0,
    });

    const built = build(1234, repository);
    await built.game.start();

    expect(built.game.player.y).toBeGreaterThan(1);
    expect(built.game.world.getBlock(0, built.game.player.y, 0)).toBe(BlockId.Air);

    await built.game.dispose();
  });

  it('ignores a snapshot containing non-finite values', async () => {
    const repository = new InMemoryWorldRepository();
    await repository.savePlayer({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      z: 0,
      yaw: 0,
      pitch: 0,
      mode: MovementMode.Walking,
      selectedSlot: 0,
    });

    const built = build(1234, repository);
    await built.game.start();

    expect(Number.isFinite(built.game.player.x)).toBe(true);
    expect(Number.isFinite(built.game.player.y)).toBe(true);

    await built.game.dispose();
  });

  it('records the seed in metadata when saving', async () => {
    const repository = new InMemoryWorldRepository();
    const built = build(4321, repository);
    await built.game.start();
    await built.game.save();

    const metadata = await repository.loadMetadata();
    expect(metadata?.seed).toBe(4321);
    expect(metadata?.version).toBeGreaterThan(0);

    await built.game.dispose();
  });

  it('stops the loop and releases adapters on dispose', async () => {
    const built = build();
    await built.game.start();
    expect(built.game.isRunning).toBe(true);

    await built.game.dispose();
    expect(built.game.isRunning).toBe(false);
    expect(built.renderer.disposed).toBe(true);

    // Frames scheduled before disposal must not resurrect the loop.
    const before = built.renderer.renders;
    built.clock.frame();
    expect(built.renderer.renders).toBe(before);
  });

  it('is safe to dispose twice', async () => {
    const built = build();
    await built.game.start();
    await built.game.dispose();
    await expect(built.game.dispose()).resolves.toBeUndefined();
  });
});
