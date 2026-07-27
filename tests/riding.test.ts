import { describe, expect, it } from 'vitest';
import { EntityManager } from '@application/services/EntityManager';
import { EditRejection, WorldEditor } from '@application/services/WorldEditor';
import type { ChunkStreamer } from '@application/services/ChunkStreamer';
import { EntityRegistry, EntityTypeId } from '@domain/entity/EntityType';
import { Mob } from '@domain/entity/Mob';
import { RailAxis, canPlaceCart, driveRailCart, railAxisAt, steerMount } from '@domain/entity/Vehicle';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import { Chunk } from '@domain/world/Chunk';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { TimeOfDay } from '@domain/world/TimeOfDay';
import { World } from '@domain/world/World';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';
import { GameMode } from '@domain/player/GameMode';
import { Player } from '@domain/player/Player';
import type { PlayerIntent } from '@domain/player/PlayerIntent';

const STILL: PlayerIntent = Object.freeze({
  moveForward: 0,
  moveRight: 0,
  up: false,
  down: false,
  sprint: false,
});

const FORWARD: PlayerIntent = Object.freeze({ ...STILL, moveForward: 1 });

/** A flat world with its surface at `surface`. */
function flatWorld(surface = 20, radius = 3): World {
  const world = new World();
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new Chunk(ChunkCoord.of(cx, cz));
      for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
        for (let localX = 0; localX < CHUNK_SIZE; localX++) {
          chunk.setGenerated(localX, 0, localZ, BlockId.Bedrock);
          for (let y = 1; y <= surface; y++) {
            chunk.setGenerated(localX, y, localZ, BlockId.Stone);
          }
        }
      }
      chunk.markGenerated();
      world.addChunk(chunk);
    }
  }
  return world;
}

function survivalPlayer(x = 0.5, y = 21, z = 0.5): Player {
  const player = new Player(x, y, z);
  player.gameMode = GameMode.Survival;
  return player;
}

describe('rail layout', () => {
  it('reports no axis where there is no rail', () => {
    const world = flatWorld();
    expect(railAxisAt(world, 0.5, 21, 0.5)).toBeNull();
  });

  it('reads an east-west run from its neighbours', () => {
    const world = flatWorld();
    for (let x = -3; x <= 3; x++) world.setBlock(x, 21, 0, BlockId.Rail);
    expect(railAxisAt(world, 0.5, 21, 0.5)).toBe(RailAxis.EastWest);
  });

  it('reads a north-south run from its neighbours', () => {
    const world = flatWorld();
    for (let z = -3; z <= 3; z++) world.setBlock(0, 21, z, BlockId.Rail);
    expect(railAxisAt(world, 0.5, 21, 0.5)).toBe(RailAxis.NorthSouth);
  });

  it('defaults an isolated rail to north-south', () => {
    const world = flatWorld();
    world.setBlock(0, 21, 0, BlockId.Rail);
    expect(railAxisAt(world, 0.5, 21, 0.5)).toBe(RailAxis.NorthSouth);
  });

  it('accepts a cart only on rail with clear space above', () => {
    const world = flatWorld();
    world.setBlock(0, 21, 0, BlockId.Rail);
    expect(canPlaceCart(world, 0.5, 21, 0.5)).toBe(true);

    // Plain ground is not track.
    expect(canPlaceCart(world, 4.5, 21, 4.5)).toBe(false);

    // Roofed in at head height, so a cart could never be occupied.
    world.setBlock(0, 22, 0, BlockId.Stone);
    expect(canPlaceCart(world, 0.5, 21, 0.5)).toBe(false);
  });
});

describe('rail block rules', () => {
  it('is walk-through and visually flat, so collision stays whole-voxel', () => {
    const rail = BlockRegistry.get(BlockId.Rail);
    expect(rail.solid).toBe(false);
    expect(rail.renderHeight).toBeLessThan(1);
    expect(rail.needsSupport).toBe(true);
  });

  it('keeps every solid block at full height', () => {
    for (const block of BlockRegistry.all()) {
      if (!block.solid) continue;
      expect(block.renderHeight, block.name).toBe(1);
    }
  });
});

describe('driveRailCart', () => {
  function railedWorld(): World {
    const world = flatWorld();
    for (let x = -20; x <= 20; x++) world.setBlock(x, 21, 0, BlockId.Rail);
    return world;
  }

  const definition = EntityRegistry.get(EntityTypeId.Minecart);

  it('moves along the track and not across it', () => {
    const world = railedWorld();
    const cart = new Mob(EntityTypeId.Minecart, 0.5, 21, 0.5);
    // Looking east along the rail.
    const result = driveRailCart(cart, definition, FORWARD, -Math.PI / 2, 0, 1 / 60, world);

    expect(result.onRail).toBe(true);
    expect(Math.abs(result.desiredVelocityX)).toBeGreaterThan(0);
    // Perpendicular motion is only the centring pull, which is zero on-centre.
    expect(result.desiredVelocityZ).toBeCloseTo(0, 6);
  });

  it('builds up speed while driven and coasts to a stop when released', () => {
    const world = railedWorld();
    const cart = new Mob(EntityTypeId.Minecart, 0.5, 21, 0.5);

    let speed = 0;
    for (let tick = 0; tick < 120; tick++) {
      speed = driveRailCart(cart, definition, FORWARD, -Math.PI / 2, speed, 1 / 60, world).railSpeed;
    }
    expect(Math.abs(speed)).toBeGreaterThan(definition.rideSpeed * 0.8);

    for (let tick = 0; tick < 600; tick++) {
      speed = driveRailCart(cart, definition, STILL, -Math.PI / 2, speed, 1 / 60, world).railSpeed;
    }
    expect(speed).toBe(0);
  });

  it('reverses when the rider turns to look back down the line', () => {
    const world = railedWorld();
    const cart = new Mob(EntityTypeId.Minecart, 0.5, 21, 0.5);

    const east = driveRailCart(cart, definition, FORWARD, -Math.PI / 2, 0, 1 / 60, world);
    const west = driveRailCart(cart, definition, FORWARD, Math.PI / 2, 0, 1 / 60, world);
    expect(Math.sign(east.railSpeed)).toBe(-Math.sign(west.railSpeed));
  });

  it('pulls a cart drifting off the centre line back onto it', () => {
    const world = railedWorld();
    const cart = new Mob(EntityTypeId.Minecart, 0.5, 21, 0.2);
    const result = driveRailCart(cart, definition, STILL, -Math.PI / 2, 0, 1 / 60, world);
    // Sitting at z=0.2 with the centre at 0.5, so the correction points +Z.
    expect(result.desiredVelocityZ).toBeGreaterThan(0);
  });

  it('goes nowhere and keeps no momentum once off the rails', () => {
    const world = flatWorld();
    const cart = new Mob(EntityTypeId.Minecart, 0.5, 21, 0.5);
    const result = driveRailCart(cart, definition, FORWARD, 0, 8, 1 / 60, world);

    expect(result.onRail).toBe(false);
    expect(result.railSpeed).toBe(0);
    expect(result.desiredVelocityX).toBe(0);
    expect(result.desiredVelocityZ).toBe(0);
  });
});

describe('steerMount', () => {
  const horse = EntityRegistry.get(EntityTypeId.Horse);

  it('goes where the rider looks, not where the animal faces', () => {
    const mount = new Mob(EntityTypeId.Horse, 0.5, 21, 0.5, 0);
    // Rider looking east; the horse is still facing north.
    const result = steerMount(mount, horse, FORWARD, -Math.PI / 2);

    expect(result.desiredVelocityX).toBeCloseTo(horse.rideSpeed, 4);
    expect(result.desiredVelocityZ).toBeCloseTo(0, 4);
  });

  it('turns the animal toward the direction of travel', () => {
    const mount = new Mob(EntityTypeId.Horse, 0.5, 21, 0.5, 0);
    steerMount(mount, horse, FORWARD, -Math.PI / 2);
    expect(mount.targetYaw).toBeCloseTo(-Math.PI / 2, 4);
  });

  it('holds its facing when the rider stops rather than snapping north', () => {
    const mount = new Mob(EntityTypeId.Horse, 0.5, 21, 0.5, 1.2);
    mount.targetYaw = 1.2;
    steerMount(mount, horse, STILL, 0);
    expect(mount.targetYaw).toBe(1.2);
  });

  it('never exceeds the ride speed on a diagonal', () => {
    const mount = new Mob(EntityTypeId.Horse, 0.5, 21, 0.5);
    const diagonal: PlayerIntent = { ...STILL, moveForward: 1, moveRight: 1 };
    const result = steerMount(mount, horse, diagonal, 0);
    const speed = Math.hypot(result.desiredVelocityX, result.desiredVelocityZ);
    expect(speed).toBeLessThanOrEqual(horse.rideSpeed * 1.0001);
  });

  it('carries a rider faster than they can sprint on foot', () => {
    expect(horse.rideSpeed).toBeGreaterThan(4.6 * 1.4);
  });

  it('passes a jump request through to the mount', () => {
    const mount = new Mob(EntityTypeId.Horse, 0.5, 21, 0.5);
    expect(steerMount(mount, horse, { ...STILL, up: true }, 0).jump).toBe(true);
    expect(steerMount(mount, horse, STILL, 0).jump).toBe(false);
  });
});

describe('EntityManager riding', () => {
  function manager(world: World): EntityManager {
    return new EntityManager({ world, random: () => 0.5 });
  }

  it('seats the player only on something rideable', () => {
    const world = flatWorld();
    const entities = manager(world);

    const pig = entities.spawn(EntityTypeId.Pig, 0.5, 21, 0.5) as Mob;
    expect(entities.mount(pig)).toBe(false);
    expect(entities.ridden).toBeNull();

    const horse = entities.spawn(EntityTypeId.Horse, 0.5, 21, 2.5) as Mob;
    expect(entities.mount(horse)).toBe(true);
    expect(entities.ridden).toBe(horse);
  });

  it('drives the mount from rider intent and leaves other creatures alone', () => {
    const world = flatWorld();
    const entities = manager(world);
    const horse = entities.spawn(EntityTypeId.Horse, 0.5, 21, 0.5) as Mob;
    const pig = entities.spawn(EntityTypeId.Pig, 8.5, 21, 8.5) as Mob;
    entities.mount(horse);

    const player = survivalPlayer();
    const time = new TimeOfDay(0.25);
    const startX = horse.x;
    const pigStart = { x: pig.x, z: pig.z };

    for (let tick = 0; tick < 60; tick++) {
      entities.update(player, time, 1 / 60, { intent: FORWARD, yaw: -Math.PI / 2 });
    }

    // Driven east by the rider's heading.
    expect(horse.x).toBeGreaterThan(startX + 2);
    // The pig kept its own brain, and did not inherit the rider's intent.
    expect(pig.x).not.toBe(startX);
    expect({ x: pig.x, z: pig.z }).not.toEqual(pigStart);
  });

  it('drops the rider when the mount dies', () => {
    const world = flatWorld();
    const entities = manager(world);
    const horse = entities.spawn(EntityTypeId.Horse, 0.5, 21, 0.5) as Mob;
    entities.mount(horse);

    expect(entities.damage(horse, 999, 0, 0, 0)).toBe(true);
    expect(entities.ridden).toBeNull();
  });

  it('stands the player up on dismount and reports what they left', () => {
    const world = flatWorld();
    const entities = manager(world);
    const horse = entities.spawn(EntityTypeId.Horse, 0.5, 21, 0.5) as Mob;
    entities.mount(horse);

    expect(entities.dismount()).toBe(horse);
    expect(entities.ridden).toBeNull();
    // Dismounting twice is harmless.
    expect(entities.dismount()).toBeNull();
  });

  it('never despawns a minecart for distance, but still despawns wildlife', () => {
    const world = flatWorld(20, 8);
    const entities = manager(world);
    const cart = entities.spawn(EntityTypeId.Minecart, 0.5, 21, 0.5) as Mob;
    const pig = entities.spawn(EntityTypeId.Pig, 0.5, 21, 4.5) as Mob;

    // The player walks far past the despawn radius.
    const player = survivalPlayer(0.5, 21, 0.5);
    player.moveTo(0.5, 21, 120.5);
    entities.update(player, new TimeOfDay(0.25), 4);

    expect(entities.get(cart.id)).not.toBeNull();
    expect(entities.get(pig.id)).toBeNull();
  });

  it('counts placed carts separately so they cannot starve wildlife spawning', () => {
    const world = flatWorld();
    const entities = new EntityManager({ world, random: () => 0.5, maxEntities: 2 });

    expect(entities.spawn(EntityTypeId.Minecart, 0.5, 21, 0.5)).not.toBeNull();
    expect(entities.spawn(EntityTypeId.Minecart, 1.5, 21, 0.5)).not.toBeNull();
    expect(entities.spawn(EntityTypeId.Minecart, 2.5, 21, 0.5)).not.toBeNull();
    expect(entities.placedCount).toBe(3);

    // Creature room is untouched by the three carts already present.
    expect(entities.spawn(EntityTypeId.Pig, 4.5, 21, 0.5)).not.toBeNull();
    expect(entities.spawn(EntityTypeId.Pig, 5.5, 21, 0.5)).not.toBeNull();
    expect(entities.spawn(EntityTypeId.Pig, 6.5, 21, 0.5)).toBeNull();
  });

  it('keeps a ridden hostile alive through the dawn cull', () => {
    const world = flatWorld();
    const entities = manager(world);
    const cart = entities.spawn(EntityTypeId.Minecart, 0.5, 21, 0.5) as Mob;
    entities.mount(cart);

    const player = survivalPlayer();
    entities.update(player, new TimeOfDay(0.25), 1 / 60, { intent: STILL, yaw: 0 });
    expect(entities.ridden).toBe(cart);
  });
});

describe('vehicle catalogue', () => {
  it('marks the minecart as a placed vehicle rather than wildlife', () => {
    const cart = EntityRegistry.get(EntityTypeId.Minecart);
    expect(cart.rideable).toBe(true);
    expect(cart.railBound).toBe(true);
    expect(cart.placedByPlayer).toBe(true);
    expect(cart.wildlife).toBe(false);
  });

  it('marks the horse as saddle-gated wildlife', () => {
    const horse = EntityRegistry.get(EntityTypeId.Horse);
    expect(horse.rideable).toBe(true);
    expect(horse.needsSaddle).toBe(true);
    expect(horse.railBound).toBe(false);
    expect(horse.wildlife).toBe(true);
    expect(horse.seatHeight).toBeGreaterThan(0);
  });

  it('gives every rideable entity a seat above its feet', () => {
    for (const definition of EntityRegistry.all()) {
      if (!definition.rideable) continue;
      expect(definition.seatHeight, definition.name).toBeGreaterThan(0);
      expect(definition.rideSpeed, definition.name).toBeGreaterThan(0);
    }
  });
});

describe('placing support-dependent blocks', () => {
  /** Streamer double: records invalidations without meshing anything. */
  function editorFor(world: World): WorldEditor {
    const streamer = { invalidateMesh: () => {} } as unknown as ChunkStreamer;
    return new WorldEditor(world, streamer);
  }

  /** A player aiming straight down at the block below their feet. */
  function lookingDown(x: number, y: number, z: number): Player {
    const player = survivalPlayer(x, y, z);
    player.pitch = -Math.PI / 2 + 1e-4;
    return player;
  }

  it('lays a rail on top of solid ground', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    const player = lookingDown(0.5, 21, 0.5);

    const result = editor.placeBlock(player, BlockId.Rail);
    expect(result.ok).toBe(true);
    expect(world.getBlock(0, 21, 0)).toBe(BlockId.Rail);
  });

  it('refuses a rail with nothing underneath it', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    // A pillar at x=3 reaching past eye height, so the crosshair lands on its
    // side face and the placement cell beside it hangs over open air.
    for (let y = 21; y <= 23; y++) world.setBlock(3, y, 0, BlockId.Stone);

    const player = survivalPlayer(0.5, 21, 0.5);
    player.yaw = -Math.PI / 2;
    player.pitch = 0;

    const target = editor.findTarget(player);
    expect(target).not.toBeNull();
    expect(target?.x).toBe(3);
    expect(target?.normalX).toBe(-1);

    const result = editor.placeBlock(player, BlockId.Rail);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe(EditRejection.Unsupported);
  });

  it('still allows an ordinary block in that same unsupported cell', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    for (let y = 21; y <= 23; y++) world.setBlock(3, y, 0, BlockId.Stone);

    const player = survivalPlayer(0.5, 21, 0.5);
    player.yaw = -Math.PI / 2;
    player.pitch = 0;

    // Only rails and beds need a floor; normal building is unrestricted.
    expect(editor.placeBlock(player, BlockId.Planks).ok).toBe(true);
    expect(world.getBlock(2, 22, 0)).toBe(BlockId.Planks);
  });

  it('removes a rail when the block carrying it is mined out', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    world.setBlock(0, 21, 0, BlockId.Rail);

    // Break the floor beneath the rail.
    expect(editor.applyBlockEdit(0, 20, 0, BlockId.Air).ok).toBe(true);
    expect(world.getBlock(0, 21, 0)).toBe(BlockId.Air);
  });

  it('leaves ordinary blocks above an excavation alone', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    world.setBlock(0, 21, 0, BlockId.Planks);

    expect(editor.applyBlockEdit(0, 20, 0, BlockId.Air).ok).toBe(true);
    expect(world.getBlock(0, 21, 0)).toBe(BlockId.Planks);
  });

  it('drops a bed whose floor disappears, and only that one cell', () => {
    const world = flatWorld();
    const editor = editorFor(world);
    world.setBlock(0, 21, 0, BlockId.Bed);
    world.setBlock(0, 22, 0, BlockId.Bed);

    editor.applyBlockEdit(0, 20, 0, BlockId.Air);
    expect(world.getBlock(0, 21, 0)).toBe(BlockId.Air);
    // The cascade stops after one step rather than sweeping the column.
    expect(world.getBlock(0, 22, 0)).toBe(BlockId.Bed);
  });
});
