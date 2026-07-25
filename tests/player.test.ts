import { describe, expect, it } from 'vitest';
import {
  MovementMode,
  PLAYER_EYE_HEIGHT,
  PLAYER_MAX_HEALTH,
  Player,
} from '@domain/player/Player';
import { GameMode } from '@domain/player/GameMode';
import { DEFAULT_MOVEMENT, PlayerMovement } from '@domain/player/PlayerMovement';
import { NO_INTENT, type PlayerIntent } from '@domain/player/PlayerIntent';
import { WorldEditor } from '@application/services/WorldEditor';
import { ChunkStreamer } from '@application/services/ChunkStreamer';
import { InMemoryWorldRepository } from '@infrastructure/persistence/InMemoryWorldRepository';
import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { Chunk } from '@domain/world/Chunk';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { BlockId } from '@domain/world/BlockType';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';
import type { VoxelQuery } from '@domain/world/VoxelQuery';
import type { GameRenderer } from '@application/ports/GameRenderer';
import type { ChunkMesher } from '@application/ports/ChunkMesher';

const STEP = 1 / 60;

const intent = (overrides: Partial<PlayerIntent> = {}): PlayerIntent => ({
  ...NO_INTENT,
  ...overrides,
});

/** Flat stone floor at y = 40, open above. */
function flatWorld(): VoxelQuery {
  return {
    getBlock: (_x, y) => (Math.floor(y) <= 40 ? BlockId.Stone : BlockId.Air),
    isSolidAt: (_x, y) => Math.floor(y) <= 40,
  };
}

function simulate(
  player: Player,
  world: VoxelQuery,
  playerIntent: PlayerIntent,
  ticks: number,
  movement = new PlayerMovement(),
): void {
  for (let i = 0; i < ticks; i++) movement.step(player, world, playerIntent, STEP);
}

describe('Player', () => {
  it('clamps pitch and wraps yaw', () => {
    const player = new Player(0, 0, 0);

    player.rotate(0, 100);
    expect(player.pitch).toBeLessThan(Math.PI / 2);
    expect(player.pitch).toBeGreaterThan(Math.PI / 2 - 0.01);

    player.rotate(0, -100);
    expect(player.pitch).toBeGreaterThan(-Math.PI / 2);

    player.rotate(Math.PI * 6.5, 0);
    expect(player.yaw).toBeGreaterThanOrEqual(0);
    expect(player.yaw).toBeLessThan(Math.PI * 2);
  });

  it('derives a unit look direction that matches yaw and pitch', () => {
    const player = new Player(0, 0, 0);
    expect(player.lookDirection.length()).toBeCloseTo(1);

    // Default orientation faces -Z, matching the camera convention.
    expect(player.lookDirection.z).toBeCloseTo(-1);

    player.yaw = Math.PI / 2;
    expect(player.lookDirection.x).toBeCloseTo(-1);
    expect(player.lookDirection.z).toBeCloseTo(0);

    player.yaw = 0;
    player.pitch = Math.PI / 4;
    expect(player.lookDirection.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('places the camera at eye height above the feet', () => {
    const player = new Player(1, 64, -2);
    expect(player.eyePosition.y).toBeCloseTo(64 + PLAYER_EYE_HEIGHT);
  });

  it('round-trips through a snapshot', () => {
    const player = new Player(1.5, 70.25, -3.75, 1.2, -0.4);
    player.gameMode = GameMode.Creative;
    player.mode = MovementMode.Flying;
    player.selectedSlot = 4;
    player.health = 14;
    player.setSpawnPoint(3, 64, 9);

    const restored = Player.fromSnapshot(player.toSnapshot());
    expect(restored.x).toBe(1.5);
    expect(restored.y).toBe(70.25);
    expect(restored.z).toBe(-3.75);
    expect(restored.yaw).toBeCloseTo(1.2);
    expect(restored.mode).toBe(MovementMode.Flying);
    expect(restored.gameMode).toBe(GameMode.Creative);
    expect(restored.selectedSlot).toBe(4);
    expect(restored.health).toBe(14);
    expect([restored.spawnX, restored.spawnY, restored.spawnZ]).toEqual([3, 64, 9]);
  });

  it('never restores a survival save into flight', () => {
    const player = new Player(0, 64, 0);
    player.gameMode = GameMode.Creative;
    player.mode = MovementMode.Flying;

    // A save that claims survival plus flight is inconsistent — flight loses.
    const restored = Player.fromSnapshot({
      ...player.toSnapshot(),
      gameMode: GameMode.Survival,
    });
    expect(restored.gameMode).toBe(GameMode.Survival);
    expect(restored.mode).toBe(MovementMode.Walking);
  });

  it('repairs missing or absurd health from an older save', () => {
    const base = new Player(0, 64, 0).toSnapshot();

    expect(Player.fromSnapshot({ ...base, health: undefined }).health).toBe(PLAYER_MAX_HEALTH);
    expect(Player.fromSnapshot({ ...base, health: 999 }).health).toBe(PLAYER_MAX_HEALTH);
    expect(Player.fromSnapshot({ ...base, health: Number.NaN }).health).toBe(PLAYER_MAX_HEALTH);
    expect(Player.fromSnapshot({ ...base, health: -5 }).health).toBe(PLAYER_MAX_HEALTH);
    expect(Player.fromSnapshot({ ...base, health: 7 }).health).toBe(7);
  });

  it('rejects an unknown movement mode from a corrupt snapshot', () => {
    const restored = Player.fromSnapshot({
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      mode: 'teleporting' as MovementMode,
      selectedSlot: 0,
    });
    expect(restored.mode).toBe(MovementMode.Walking);
  });

  it('clears the interpolation trail when teleporting', () => {
    const player = new Player(0, 0, 0);
    player.beginTick();
    player.x = 50;
    player.moveTo(10, 20, 30);
    expect(player.previousX).toBe(10);
    expect(player.velocityY).toBe(0);
  });
});

describe('PlayerMovement', () => {
  it('falls under gravity and comes to rest on the ground', () => {
    const player = new Player(0.5, 60, 0.5);
    simulate(player, flatWorld(), NO_INTENT, 240);

    expect(player.y).toBeCloseTo(41, 1);
    expect(player.onGround).toBe(true);
    expect(player.velocityY).toBe(0);
  });

  it('does not accelerate past terminal velocity', () => {
    const player = new Player(0.5, 60, 0.5);
    const openSky: VoxelQuery = { getBlock: () => BlockId.Air, isSolidAt: () => false };
    simulate(player, openSky, NO_INTENT, 600);
    expect(player.velocityY).toBeGreaterThanOrEqual(DEFAULT_MOVEMENT.terminalVelocity);
  });

  it('jumps only when grounded', () => {
    const player = new Player(0.5, 41, 0.5);
    const world = flatWorld();
    const movement = new PlayerMovement();

    movement.step(player, world, NO_INTENT, STEP);
    expect(player.onGround).toBe(true);

    movement.step(player, world, intent({ up: true }), STEP);
    const apexVelocity = player.velocityY;
    expect(apexVelocity).toBeGreaterThan(0);

    // Airborne: holding jump must not add thrust.
    movement.step(player, world, intent({ up: true }), STEP);
    expect(player.velocityY).toBeLessThan(apexVelocity);
  });

  it('moves diagonally no faster than straight ahead', () => {
    const world = flatWorld();

    const straight = new Player(0.5, 41, 0.5);
    simulate(straight, world, intent({ moveForward: 1 }), 120);

    const diagonal = new Player(0.5, 41, 0.5);
    simulate(diagonal, world, intent({ moveForward: 1, moveRight: 1 }), 120);

    const straightDistance = Math.hypot(straight.x - 0.5, straight.z - 0.5);
    const diagonalDistance = Math.hypot(diagonal.x - 0.5, diagonal.z - 0.5);
    expect(diagonalDistance).toBeCloseTo(straightDistance, 1);
  });

  it('walks in the direction the player is facing', () => {
    const world = flatWorld();
    const player = new Player(0.5, 41, 0.5);
    simulate(player, world, intent({ moveForward: 1 }), 60);
    // Yaw 0 faces -Z.
    expect(player.z).toBeLessThan(0.5);
    expect(player.x).toBeCloseTo(0.5, 3);

    const turned = new Player(0.5, 41, 0.5, Math.PI / 2);
    simulate(turned, world, intent({ moveForward: 1 }), 60);
    expect(turned.x).toBeLessThan(0.5);
  });

  it('sprints faster than it walks', () => {
    const world = flatWorld();
    const walking = new Player(0.5, 41, 0.5);
    const sprinting = new Player(0.5, 41, 0.5);

    simulate(walking, world, intent({ moveForward: 1 }), 120);
    simulate(sprinting, world, intent({ moveForward: 1, sprint: true }), 120);

    expect(Math.abs(sprinting.z - 0.5)).toBeGreaterThan(Math.abs(walking.z - 0.5));
  });

  it('ignores gravity while flying and holds altitude', () => {
    const player = new Player(0.5, 80, 0.5);
    player.mode = MovementMode.Flying;
    simulate(player, flatWorld(), NO_INTENT, 120);

    expect(player.y).toBeCloseTo(80, 1);
    expect(player.onGround).toBe(false);
  });

  it('ascends and descends on demand while flying', () => {
    const world = flatWorld();
    const up = new Player(0.5, 80, 0.5);
    up.mode = MovementMode.Flying;
    simulate(up, world, intent({ up: true }), 60);
    expect(up.y).toBeGreaterThan(80);

    const down = new Player(0.5, 80, 0.5);
    down.mode = MovementMode.Flying;
    simulate(down, world, intent({ down: true }), 60);
    expect(down.y).toBeLessThan(80);
  });

  it('detects water and slows the player down in it', () => {
    const ocean: VoxelQuery = {
      getBlock: (_x, y) =>
        Math.floor(y) <= 40 ? BlockId.Stone : Math.floor(y) <= 60 ? BlockId.Water : BlockId.Air,
      isSolidAt: (_x, y) => Math.floor(y) <= 40,
    };

    const swimmer = new Player(0.5, 50, 0.5);
    simulate(swimmer, ocean, intent({ moveForward: 1 }), 60);
    expect(swimmer.inLiquid).toBe(true);

    const runner = new Player(0.5, 41, 0.5);
    simulate(runner, flatWorld(), intent({ moveForward: 1 }), 60);

    expect(Math.abs(swimmer.z - 0.5)).toBeLessThan(Math.abs(runner.z - 0.5));
  });

  it('produces the same result at any tick rate', () => {
    const world = flatWorld();
    const movement = new PlayerMovement();

    const fast = new Player(0.5, 60, 0.5);
    for (let i = 0; i < 240; i++) movement.step(fast, world, intent({ moveForward: 1 }), 1 / 120);

    const slow = new Player(0.5, 60, 0.5);
    for (let i = 0; i < 120; i++) movement.step(slow, world, intent({ moveForward: 1 }), 1 / 60);

    // Exponential smoothing makes velocity rate-independent; positions agree
    // to within integration error.
    expect(fast.z).toBeCloseTo(slow.z, 1);
    expect(fast.y).toBeCloseTo(slow.y, 1);
  });

  it('never pushes the player inside terrain, however long the tick', () => {
    const player = new Player(0.5, 60, 0.5);
    const movement = new PlayerMovement();
    // A pathological 1-second step, as after a tab stall.
    movement.step(player, flatWorld(), intent({ moveForward: 1 }), 1);
    expect(player.y).toBeGreaterThanOrEqual(41);
  });
});

describe('WorldEditor', () => {
  function setup() {
    const world = new World();
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) world.addChunk(new Chunk(ChunkCoord.of(cx, cz)));
    }

    const noopRenderer = {
      updateChunk() {},
      removeChunk() {},
      syncEntities() {},
      setBlockHighlight() {},
      setBreakProgress() {},
      setSubmerged() {},
      setSky() {},
      setRenderDistance() {},
      render() {},
      getStats: () => ({ drawCalls: 0, triangles: 0, chunkMeshes: 0, entities: 0 }),
      dispose() {},
    } satisfies GameRenderer;

    const noopMesher: ChunkMesher = {
      capacity: 1,
      submit: () => new Promise(() => {}),
      dispose() {},
    };

    const streamer = new ChunkStreamer({
      world,
      generator: new TerrainGenerator(1),
      mesher: noopMesher,
      renderer: noopRenderer,
      repository: new InMemoryWorldRepository(),
    });

    return { world, editor: new WorldEditor(world, streamer) };
  }

  it('breaks the block the player is looking at', () => {
    const { world, editor } = setup();
    world.setBlock(0, 40, -3, BlockId.Stone);

    const player = new Player(0.5, 40 - 1.62 + 0.5, 0.5);
    player.yaw = 0; // facing -Z
    player.pitch = 0;
    // Put the eye exactly at block-centre height.
    player.y = 40.5 - 1.62;

    const result = editor.breakBlock(player);
    expect(result.ok).toBe(true);
    expect(world.getBlock(0, 40, -3)).toBe(BlockId.Air);
  });

  it('refuses to break indestructible blocks', () => {
    const { world, editor } = setup();
    world.setBlock(0, 40, -3, BlockId.Bedrock);

    const player = new Player(0.5, 40.5 - 1.62, 0.5);
    const result = editor.breakBlock(player);
    expect(result.ok).toBe(false);
    expect(world.getBlock(0, 40, -3)).toBe(BlockId.Bedrock);
  });

  it('places a block against the face that was hit', () => {
    const { world, editor } = setup();
    world.setBlock(0, 40, -3, BlockId.Stone);

    const player = new Player(0.5, 40.5 - 1.62, 0.5);
    const result = editor.placeBlock(player, BlockId.Planks);
    expect(result.ok).toBe(true);
    // The new block sits on the +Z side, between the player and the target.
    expect(world.getBlock(0, 40, -2)).toBe(BlockId.Planks);
  });

  it('refuses to place a block inside the player', () => {
    const { world, editor } = setup();
    // Floor directly beneath the player's feet.
    world.setBlock(0, 39, 0, BlockId.Stone);

    const player = new Player(0.5, 40, 0.5);
    player.pitch = -Math.PI / 2 + 0.01; // look straight down

    const result = editor.placeBlock(player, BlockId.Stone);
    expect(result.ok).toBe(false);
    expect(world.getBlock(0, 40, 0)).toBe(BlockId.Air);
  });

  it('reports no target when nothing is in reach', () => {
    const { editor } = setup();
    const player = new Player(0.5, 40, 0.5);
    expect(editor.breakBlock(player).ok).toBe(false);
    expect(editor.placeBlock(player, BlockId.Stone).ok).toBe(false);
  });

  it('treats water as replaceable but not as a target', () => {
    const { world, editor } = setup();
    world.setBlock(0, 40, -3, BlockId.Water);
    world.setBlock(0, 40, -5, BlockId.Stone);

    const player = new Player(0.5, 40.5 - 1.62, 0.5);
    // The ray passes through water and stops on stone.
    const hit = editor.findTarget(player);
    expect(hit?.z).toBe(-5);
  });

  it('does not edit outside the loaded world', () => {
    const { world, editor } = setup();
    world.setBlock(0, 40, -3, BlockId.Stone);

    const outside = new Player(CHUNK_SIZE * 40 + 0.5, 40.5 - 1.62, 0.5);
    expect(editor.breakBlock(outside).ok).toBe(false);
  });
});
