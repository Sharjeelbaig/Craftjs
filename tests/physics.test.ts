import { describe, expect, it } from 'vitest';
import {
  isPositionObstructed,
  isStandingOnGround,
  moveEntity,
} from '@domain/physics/CollisionResolver';
import { raycastVoxels } from '@domain/physics/VoxelRaycaster';
import { boxesOverlap, boxAtFeet, boxOfVoxel } from '@domain/physics/AABB';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import type { VoxelQuery } from '@domain/world/VoxelQuery';
import { PLAYER_SIZE } from '@domain/player/Player';

/** Minimal voxel source backed by an explicit set of solid cells. */
function fixture(solid: readonly (readonly [number, number, number])[]): VoxelQuery {
  const cells = new Set(solid.map(([x, y, z]) => `${x},${y},${z}`));
  return {
    getBlock: (x, y, z) =>
      cells.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)
        ? BlockId.Stone
        : BlockId.Air,
    isSolidAt(x, y, z) {
      return BlockRegistry.isSolid(this.getBlock(x, y, z));
    },
  };
}

/** A solid plane at y = 0, spanning the region the tests use. */
function ground(): VoxelQuery {
  return {
    getBlock: (_x, y) => (Math.floor(y) === 0 ? BlockId.Stone : BlockId.Air),
    isSolidAt: (_x, y) => Math.floor(y) === 0,
  };
}

describe('AABB', () => {
  it('detects overlap but not mere touching', () => {
    expect(boxesOverlap(boxOfVoxel(0, 0, 0), boxOfVoxel(0, 0, 0))).toBe(true);
    // Face-to-face contact is not an overlap, or standing on a block would
    // register as being inside it.
    expect(boxesOverlap(boxOfVoxel(0, 0, 0), boxOfVoxel(1, 0, 0))).toBe(false);
  });

  it('centres the entity box on its footprint', () => {
    const box = boxAtFeet({ x: 4, y: 10, z: -2 }, 0.6, 1.8);
    expect(box.minX).toBeCloseTo(3.7);
    expect(box.maxX).toBeCloseTo(4.3);
    expect(box.minY).toBe(10);
    expect(box.maxY).toBeCloseTo(11.8);
  });
});

describe('moveEntity', () => {
  it('moves freely through empty space', () => {
    const query = fixture([]);
    const result = moveEntity(query, { x: 0, y: 40, z: 0 }, PLAYER_SIZE, 0.5, 0, 0.25);
    expect(result.x).toBeCloseTo(0.5);
    expect(result.z).toBeCloseTo(0.25);
    expect(result.hitX).toBe(false);
  });

  it('lands on the ground without sinking into it', () => {
    const result = moveEntity(ground(), { x: 0.5, y: 4, z: 0.5 }, PLAYER_SIZE, 0, -10, 0);
    expect(result.onGround).toBe(true);
    expect(result.y).toBeGreaterThanOrEqual(1);
    expect(result.y).toBeLessThan(1.01);
  });

  it('slides along a wall instead of stopping dead', () => {
    // Wall filling x = 1 for the player's height.
    const wall: [number, number, number][] = [];
    for (let y = 1; y <= 3; y++) {
      for (let z = -2; z <= 2; z++) wall.push([1, y, z]);
    }

    const result = moveEntity(fixture(wall), { x: 0.5, y: 1, z: 0.5 }, PLAYER_SIZE, 1, 0, 1);
    expect(result.hitX).toBe(true);
    // Blocked on X, but Z motion is preserved.
    expect(result.x).toBeLessThan(0.75);
    expect(result.z).toBeCloseTo(1.5);
  });

  it('cannot tunnel through a thin wall at any speed', () => {
    const wall: [number, number, number][] = [];
    for (let y = 0; y <= 4; y++) {
      for (let z = -4; z <= 4; z++) wall.push([5, y, z]);
    }
    const query = fixture(wall);

    // A single enormous delta, as would happen after a long frame stall.
    const result = moveEntity(query, { x: 0.5, y: 1, z: 0.5 }, PLAYER_SIZE, 500, 0, 0);
    expect(result.hitX).toBe(true);
    expect(result.x).toBeLessThan(5);
    expect(isPositionObstructed(query, result, PLAYER_SIZE)).toBe(false);
  });

  it('produces the same result for one large step as for many small ones', () => {
    const query = ground();
    const single = moveEntity(query, { x: 0, y: 6, z: 0 }, PLAYER_SIZE, 2, -3, 1);

    let position = { x: 0, y: 6, z: 0 };
    for (let i = 0; i < 10; i++) {
      const step = moveEntity(query, position, PLAYER_SIZE, 0.2, -0.3, 0.1);
      position = { x: step.x, y: step.y, z: step.z };
    }

    expect(single.x).toBeCloseTo(position.x, 5);
    expect(single.y).toBeCloseTo(position.y, 5);
    expect(single.z).toBeCloseTo(position.z, 5);
  });

  it('stops upward motion against a ceiling', () => {
    const ceiling: [number, number, number][] = [];
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) ceiling.push([x, 4, z]);
    }
    const result = moveEntity(fixture(ceiling), { x: 0.5, y: 1, z: 0.5 }, PLAYER_SIZE, 0, 5, 0);
    expect(result.hitY).toBe(true);
    expect(result.onGround).toBe(false);
    expect(result.y + PLAYER_SIZE.height).toBeLessThanOrEqual(4);
  });

  it('never leaves the entity intersecting geometry', () => {
    const blocks: [number, number, number][] = [];
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        blocks.push([x, 0, z]);
        if ((x + z) % 3 === 0) blocks.push([x, 1, z]);
      }
    }
    const query = fixture(blocks);

    let position = { x: 0.5, y: 3, z: 0.5 };
    for (let i = 0; i < 200; i++) {
      const result = moveEntity(
        query,
        position,
        PLAYER_SIZE,
        Math.sin(i) * 0.7,
        -0.4,
        Math.cos(i) * 0.7,
      );
      position = { x: result.x, y: result.y, z: result.z };
      expect(isPositionObstructed(query, position, PLAYER_SIZE)).toBe(false);
    }
  });
});

describe('isStandingOnGround', () => {
  it('detects support without any vertical motion', () => {
    expect(isStandingOnGround(ground(), { x: 0.5, y: 1, z: 0.5 }, PLAYER_SIZE)).toBe(true);
    expect(isStandingOnGround(ground(), { x: 0.5, y: 4, z: 0.5 }, PLAYER_SIZE)).toBe(false);
  });
});

describe('raycastVoxels', () => {
  it('hits the nearest block and reports the entered face', () => {
    const hit = raycastVoxels(
      fixture([[3, 0, 0]]),
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1, y: 0, z: 0 },
      10,
    );
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([3, 0, 0]);
    // Entered from -X, so the face normal points back that way.
    expect([hit!.normalX, hit!.normalY, hit!.normalZ]).toEqual([-1, 0, 0]);
    expect(hit!.distance).toBeCloseTo(2.5);
  });

  it('returns null past the maximum distance', () => {
    const query = fixture([[9, 0, 0]]);
    const origin = { x: 0.5, y: 0.5, z: 0.5 };
    expect(raycastVoxels(query, origin, { x: 1, y: 0, z: 0 }, 5)).toBeNull();
    expect(raycastVoxels(query, origin, { x: 1, y: 0, z: 0 }, 12)).not.toBeNull();
  });

  it('visits diagonal cells without skipping geometry', () => {
    // A block sitting exactly on the diagonal path must be found.
    const hit = raycastVoxels(
      fixture([[2, 2, 0]]),
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1, y: 1, z: 0 },
      10,
    );
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([2, 2, 0]);
  });

  it('reports the origin cell when the ray starts inside a block', () => {
    const hit = raycastVoxels(
      fixture([[0, 0, 0]]),
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1, y: 0, z: 0 },
      10,
    );
    expect(hit?.distance).toBe(0);
    expect([hit?.normalX, hit?.normalY, hit?.normalZ]).toEqual([0, 0, 0]);
  });

  it('handles negative directions and negative coordinates', () => {
    const hit = raycastVoxels(
      fixture([[-4, -1, 0]]),
      { x: 0.5, y: -0.5, z: 0.5 },
      { x: -1, y: 0, z: 0 },
      10,
    );
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([-4, -1, 0]);
    expect([hit!.normalX, hit!.normalY, hit!.normalZ]).toEqual([1, 0, 0]);
  });

  it('rejects a degenerate direction instead of looping forever', () => {
    expect(
      raycastVoxels(fixture([]), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 10),
    ).toBeNull();
  });

  it('honours a custom stop predicate', () => {
    const query: VoxelQuery = {
      getBlock: (x) => (Math.floor(x) === 2 ? BlockId.Water : Math.floor(x) === 5 ? BlockId.Stone : BlockId.Air),
      isSolidAt: () => false,
    };

    const throughWater = raycastVoxels(
      query,
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1, y: 0, z: 0 },
      10,
      (block) => block !== BlockId.Air && !BlockRegistry.isLiquid(block),
    );
    expect(throughWater?.x).toBe(5);
  });
});
