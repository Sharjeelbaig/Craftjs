import { describe, expect, it } from 'vitest';
import {
  INVULNERABILITY_SECONDS,
  applyDamage,
  applyKnockback,
  fallDamageFor,
} from '@domain/combat/Combat';
import { GameMode, rulesFor } from '@domain/player/GameMode';
import { PLAYER_MAX_HEALTH, Player } from '@domain/player/Player';
import { TimeOfDay } from '@domain/world/TimeOfDay';

describe('applyDamage', () => {
  it('reduces health and starts the invulnerability window', () => {
    const target = { health: 20, hurtTimer: 0 };
    const result = applyDamage(target, 5);

    expect(result.applied).toBe(true);
    expect(result.fatal).toBe(false);
    expect(target.health).toBe(15);
    expect(target.hurtTimer).toBe(INVULNERABILITY_SECONDS);
  });

  it('absorbs hits landed during invulnerability', () => {
    const target = { health: 20, hurtTimer: 0 };
    applyDamage(target, 5);

    // Without this, standing next to a creature drains a full bar in under a
    // second because contact damage applies on every tick.
    for (let i = 0; i < 10; i++) applyDamage(target, 5);
    expect(target.health).toBe(15);
  });

  it('reports a fatal blow and never drives health below zero', () => {
    const target = { health: 3, hurtTimer: 0 };
    const result = applyDamage(target, 99);

    expect(result.fatal).toBe(true);
    expect(target.health).toBe(0);
  });

  it('ignores meaningless amounts', () => {
    const target = { health: 20, hurtTimer: 0 };
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      // Infinity would be "applied" but must not corrupt health into NaN.
      applyDamage(target, amount);
    }
    expect(Number.isFinite(target.health)).toBe(true);
    expect(target.health).toBeGreaterThanOrEqual(0);
  });

  it('cannot damage something already dead', () => {
    const target = { health: 0, hurtTimer: 0 };
    expect(applyDamage(target, 5).applied).toBe(false);
  });
});

describe('applyKnockback', () => {
  it('pushes away from the source and adds lift', () => {
    const body = { velocityX: 0, velocityY: 0, velocityZ: 0 };
    applyKnockback(body, 0, 0, 3, 0, 6);

    expect(body.velocityX).toBeCloseTo(6);
    expect(body.velocityZ).toBeCloseTo(0);
    // Lift matters: pure horizontal knockback into a wall reads as a miss.
    expect(body.velocityY).toBeGreaterThan(0);
  });

  it('picks a stable direction when attacker and target coincide', () => {
    const body = { velocityX: 0, velocityY: 0, velocityZ: 0 };
    applyKnockback(body, 5, 5, 5, 5, 4);

    expect(Number.isFinite(body.velocityX)).toBe(true);
    expect(Number.isFinite(body.velocityZ)).toBe(true);
    expect(Math.hypot(body.velocityX, body.velocityZ)).toBeCloseTo(4);
  });
});

describe('fallDamageFor', () => {
  it('is free below the safe distance', () => {
    expect(fallDamageFor(0)).toBe(0);
    expect(fallDamageFor(3)).toBe(0);
    expect(fallDamageFor(3.5)).toBe(0);
  });

  it('scales with distance beyond the safe threshold', () => {
    expect(fallDamageFor(5)).toBe(1);
    expect(fallDamageFor(10)).toBe(6);
    expect(fallDamageFor(24.5)).toBe(21);
  });

  it('ignores non-finite distances', () => {
    expect(fallDamageFor(Number.NaN)).toBe(0);
  });
});

describe('GameMode', () => {
  it('gives creative flight and immunity, survival neither', () => {
    expect(rulesFor(GameMode.Creative).canFly).toBe(true);
    expect(rulesFor(GameMode.Creative).takesDamage).toBe(false);
    expect(rulesFor(GameMode.Survival).canFly).toBe(false);
    expect(rulesFor(GameMode.Survival).takesDamage).toBe(true);
    expect(rulesFor(GameMode.Hardcore).takesDamage).toBe(true);
    expect(rulesFor(GameMode.Hardcore).canRespawn).toBe(false);
    expect(rulesFor(GameMode.Hardcore).canChangeMode).toBe(false);
  });

  it('refuses flight in survival and restores health on leaving it', () => {
    const player = new Player(0, 64, 0);
    player.setGameMode(GameMode.Survival);
    expect(player.toggleMovementMode()).toBe(false);

    player.health = 4;
    player.setGameMode(GameMode.Creative);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.toggleMovementMode()).toBe(true);
  });

  it('drops out of flight when switching into survival', () => {
    const player = new Player(0, 64, 0);
    player.setGameMode(GameMode.Creative);
    player.toggleMovementMode();

    player.setGameMode(GameMode.Survival);
    expect(player.mode).toBe('walking');
  });

  it('only counts as dead in a mode that takes damage', () => {
    const player = new Player(0, 64, 0);
    player.setGameMode(GameMode.Survival);
    player.health = 0;
    expect(player.isDead).toBe(true);

    player.setGameMode(GameMode.Creative);
    expect(player.isDead).toBe(false);
  });

  it('respawns at the spawn point with full health', () => {
    const player = new Player(10, 70, -4);
    player.setGameMode(GameMode.Survival);
    player.setSpawnPoint(1, 65, 2);
    player.health = 0;
    player.moveTo(500, 12, 500);

    player.respawn();
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect([player.x, player.y, player.z]).toEqual([1, 65, 2]);
    expect(player.isDead).toBe(false);
  });
});

describe('TimeOfDay', () => {
  it('runs from dawn through noon to night', () => {
    const time = new TimeOfDay(0);
    expect(time.isNight).toBe(false);

    time.fraction = 0.25;
    expect(time.sunHeight).toBeCloseTo(1);
    expect(time.lightLevel).toBeCloseTo(1);
    expect(time.isNight).toBe(false);

    time.fraction = 0.75;
    expect(time.sunHeight).toBeCloseTo(-1);
    expect(time.isNight).toBe(true);
    expect(time.lightLevel).toBeLessThan(0.3);
  });

  it('keeps light within range at every point of the cycle', () => {
    const time = new TimeOfDay(0);
    for (let i = 0; i <= 200; i++) {
      time.fraction = i / 200;
      expect(time.lightLevel).toBeGreaterThan(0);
      expect(time.lightLevel).toBeLessThanOrEqual(1);
    }
  });

  it('wraps rather than running off the end of the day', () => {
    const time = new TimeOfDay(0.99);
    time.advance(60 * 60);
    expect(time.fraction).toBeGreaterThanOrEqual(0);
    expect(time.fraction).toBeLessThan(1);
  });

  it('ignores nonsense deltas', () => {
    const time = new TimeOfDay(0.3);
    const before = time.fraction;
    time.advance(Number.NaN);
    time.advance(-100);
    expect(time.fraction).toBe(before);
  });

  it('normalises an out-of-range starting fraction', () => {
    expect(new TimeOfDay(2.25).fraction).toBeCloseTo(0.25);
    expect(new TimeOfDay(-0.25).fraction).toBeCloseTo(0.75);
    expect(new TimeOfDay(Number.NaN).fraction).toBe(0);
  });

  it('reports a readable clock starting at dawn', () => {
    const time = new TimeOfDay(0);
    expect(time.clock).toBe('06:00');
    time.fraction = 0.25;
    expect(time.clock).toBe('12:00');
    time.fraction = 0.75;
    expect(time.clock).toBe('00:00');
  });
});
