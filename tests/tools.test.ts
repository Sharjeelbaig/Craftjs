import { describe, expect, it } from 'vitest';
import {
  attackDamageFor,
  canHarvest,
  harvestLevelOf,
  miningSpeedFor,
  toolProfile,
} from '@domain/inventory/Tool';
import { blockDrop } from '@domain/inventory/BlockDrops';
import { blockItem, catalogItem } from '@domain/inventory/Item';
import { PLAYER_ATTACK_DAMAGE } from '@domain/player/Player';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import { MiningController } from '@application/services/MiningController';
import type { WorldEditor } from '@application/services/WorldEditor';
import type { RaycastHit } from '@domain/physics/VoxelRaycaster';
import { GameMode } from '@domain/player/GameMode';
import { Player } from '@domain/player/Player';

const pickaxes = [
  ['wooden-pickaxe', 1, 2],
  ['stone-pickaxe', 2, 4],
  ['iron-pickaxe', 3, 6],
  ['diamond-pickaxe', 4, 8],
] as const;

describe('tool profiles', () => {
  it('derives class and material from the item id', () => {
    expect(toolProfile(catalogItem('diamond-pickaxe'))).toMatchObject({
      toolClass: 'pickaxe',
      material: 'diamond',
    });
    expect(toolProfile(catalogItem('golden-sword'))).toMatchObject({
      toolClass: 'sword',
      material: 'golden',
    });
  });

  it('reports nothing for items that are not tools', () => {
    for (const item of [null, blockItem(BlockId.Stone), catalogItem('coal'), catalogItem('saddle')]) {
      expect(toolProfile(item)).toBeNull();
    }
  });

  it('raises harvest level and speed with each pickaxe tier', () => {
    for (const [id, level, speed] of pickaxes) {
      const item = catalogItem(id);
      expect(harvestLevelOf(item), id).toBe(level);
      expect(miningSpeedFor(item, BlockId.Stone), id).toBe(speed);
    }
  });

  it('keeps gold fast but low-tier, as the era it comes from did', () => {
    const gold = catalogItem('golden-pickaxe');
    expect(miningSpeedFor(gold, BlockId.Stone)).toBe(12);
    expect(harvestLevelOf(gold)).toBe(1);
    // Fast enough to strip stone, still too soft to collect iron.
    expect(canHarvest(gold, BlockId.Stone)).toBe(true);
    expect(canHarvest(gold, BlockId.IronOre)).toBe(false);
  });
});

describe('mining speed', () => {
  it('only speeds up the material the tool class suits', () => {
    const pickaxe = catalogItem('iron-pickaxe');
    const axe = catalogItem('iron-axe');
    const shovel = catalogItem('iron-shovel');

    expect(miningSpeedFor(pickaxe, BlockId.Cobblestone)).toBe(6);
    expect(miningSpeedFor(axe, BlockId.Log)).toBe(6);
    expect(miningSpeedFor(shovel, BlockId.Dirt)).toBe(6);

    // An axe on stone is no faster than bare hands, but still harvests it
    // because iron outranks stone's requirement.
    expect(miningSpeedFor(axe, BlockId.Cobblestone)).toBe(1);
  });

  it('penalises a tool too weak to harvest what it is hitting', () => {
    // A wooden pickaxe cannot collect diamond, and grinds while it tries.
    expect(miningSpeedFor(catalogItem('wooden-pickaxe'), BlockId.DiamondOre)).toBeLessThan(1);
    expect(miningSpeedFor(null, BlockId.DiamondOre)).toBeLessThan(1);
  });

  it('leaves blocks needing no tool at bare-handed speed', () => {
    expect(miningSpeedFor(null, BlockId.Dirt)).toBe(1);
    expect(miningSpeedFor(null, BlockId.Leaves)).toBe(1);
  });
});

describe('harvest gating', () => {
  it('requires a pickaxe for stone and better pickaxes for deeper ore', () => {
    expect(canHarvest(null, BlockId.Stone)).toBe(false);
    expect(canHarvest(catalogItem('wooden-pickaxe'), BlockId.Stone)).toBe(true);

    expect(canHarvest(catalogItem('wooden-pickaxe'), BlockId.IronOre)).toBe(false);
    expect(canHarvest(catalogItem('stone-pickaxe'), BlockId.IronOre)).toBe(true);

    expect(canHarvest(catalogItem('stone-pickaxe'), BlockId.DiamondOre)).toBe(false);
    expect(canHarvest(catalogItem('iron-pickaxe'), BlockId.DiamondOre)).toBe(true);
  });

  it('never gates blocks that break by hand', () => {
    for (const block of [BlockId.Dirt, BlockId.Grass, BlockId.Sand, BlockId.Log, BlockId.Leaves]) {
      expect(canHarvest(null, block), BlockRegistry.get(block).name).toBe(true);
    }
  });
});

describe('block drops', () => {
  it('turns stone into cobblestone and grass into dirt', () => {
    expect(blockDrop(BlockId.Stone)).toBe(blockItem(BlockId.Cobblestone));
    expect(blockDrop(BlockId.Grass)).toBe(blockItem(BlockId.Dirt));
  });

  it('hands over the resource inside an ore rather than the ore block', () => {
    expect(blockDrop(BlockId.CoalOre)).toBe(catalogItem('coal'));
    expect(blockDrop(BlockId.IronOre)).toBe(catalogItem('iron-ingot'));
    expect(blockDrop(BlockId.GoldOre)).toBe(catalogItem('gold-ingot'));
    expect(blockDrop(BlockId.DiamondOre)).toBe(catalogItem('diamond'));
  });

  it('yields nothing from blocks that leave no remains', () => {
    expect(blockDrop(BlockId.Glass)).toBeNull();
    expect(blockDrop(BlockId.Bedrock)).toBeNull();
    expect(blockDrop(BlockId.Air)).toBeNull();
  });

  it('drops the placed blocks that are made rather than found', () => {
    expect(blockDrop(BlockId.Rail)).toBe(blockItem(BlockId.Rail));
    expect(blockDrop(BlockId.Bed)).toBe(blockItem(BlockId.Bed));
  });
});

describe('weapon damage', () => {
  it('makes every sword tier stronger than a bare hand', () => {
    let previous = PLAYER_ATTACK_DAMAGE;
    for (const material of ['wooden', 'stone', 'iron', 'diamond'] as const) {
      const damage = attackDamageFor(catalogItem(`${material}-sword`));
      expect(damage, material).not.toBeNull();
      expect(damage as number, material).toBeGreaterThan(previous);
      previous = damage as number;
    }
  });

  it('ranks a sword above the other tools of its own tier', () => {
    const sword = attackDamageFor(catalogItem('iron-sword')) as number;
    for (const shape of ['axe', 'pickaxe', 'shovel'] as const) {
      expect(attackDamageFor(catalogItem(`iron-${shape}`)) as number, shape).toBeLessThan(sword);
    }
  });

  it('falls back to the bare-handed value for a non-weapon', () => {
    expect(attackDamageFor(null)).toBeNull();
    expect(attackDamageFor(blockItem(BlockId.Stone))).toBeNull();
  });
});

describe('MiningController with tools', () => {
  /** Editor double: records breaks without needing a world or a streamer. */
  function stubEditor(): { editor: WorldEditor; breaks: number } {
    const state = { breaks: 0 };
    const editor = {
      breakBlock: () => {
        state.breaks++;
        return { ok: true as const, x: 0, y: 0, z: 0 };
      },
    } as unknown as WorldEditor;
    return { editor, get breaks() { return state.breaks; } };
  }

  const target: RaycastHit = {
    x: 0,
    y: 4,
    z: 0,
    block: BlockId.Stone,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    distance: 2,
  };

  function survivalPlayer(): Player {
    const player = new Player(0.5, 5, 0.5);
    player.gameMode = GameMode.Survival;
    return player;
  }

  /** Seconds of held mining before the block gives way. */
  function timeToBreak(tool: string | null): number {
    const stub = stubEditor();
    const mining = new MiningController(stub.editor);
    const player = survivalPlayer();
    const step = 1 / 60;

    for (let tick = 0; tick < 60 * 30; tick++) {
      const broken = mining.update(
        player,
        target,
        true,
        step,
        tool === null ? null : catalogItem(tool as 'iron-pickaxe'),
      );
      if (broken !== null) return (tick + 1) * step;
    }
    throw new Error('block never broke');
  }

  it('breaks stone faster with each better pickaxe', () => {
    const bare = timeToBreak(null);
    const wood = timeToBreak('wooden-pickaxe');
    const stone = timeToBreak('stone-pickaxe');
    const iron = timeToBreak('iron-pickaxe');
    const diamond = timeToBreak('diamond-pickaxe');

    expect(wood).toBeLessThan(bare);
    expect(stone).toBeLessThan(wood);
    expect(iron).toBeLessThan(stone);
    expect(diamond).toBeLessThan(iron);
  });

  it('takes hardness divided by tool speed, so the numbers are predictable', () => {
    const hardness = BlockRegistry.get(BlockId.Stone).hardness;
    // Six times the speed, so within one tick of a sixth of the bare time.
    expect(timeToBreak('iron-pickaxe')).toBeCloseTo(hardness / 6, 1);
  });

  it('reports no progress once the target is released', () => {
    const stub = stubEditor();
    const mining = new MiningController(stub.editor);
    const player = survivalPlayer();

    mining.update(player, target, true, 0.2, catalogItem('wooden-pickaxe'));
    expect(mining.currentProgress).toBeGreaterThan(0);

    mining.update(player, target, false, 0.2, catalogItem('wooden-pickaxe'));
    expect(mining.currentProgress).toBe(0);
  });
});
