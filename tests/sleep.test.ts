import { describe, expect, it } from 'vitest';
import {
  MONSTER_WATCH_RADIUS,
  SleepRejection,
  WAKE_FRACTION,
  canSleep,
  sleepRejectionMessage,
} from '@domain/world/Sleep';
import { TimeOfDay } from '@domain/world/TimeOfDay';
import { Weather, WeatherKind } from '@domain/world/Weather';
import { PLAYER_REACH } from '@domain/player/Player';

const base = {
  isNight: true,
  isStorming: false,
  distance: 2,
  reach: PLAYER_REACH,
  nearestHostileDistance: null,
} as const;

describe('canSleep', () => {
  it('allows sleeping at night with a reachable bed and nothing nearby', () => {
    expect(canSleep(base)).toEqual({ ok: true });
  });

  it('refuses in daylight with clear skies', () => {
    expect(canSleep({ ...base, isNight: false })).toEqual({
      ok: false,
      reason: SleepRejection.NotTired,
    });
  });

  it('allows sleeping through a daytime storm', () => {
    expect(canSleep({ ...base, isNight: false, isStorming: true })).toEqual({ ok: true });
  });

  it('refuses while a hostile is within the watch radius', () => {
    expect(canSleep({ ...base, nearestHostileDistance: MONSTER_WATCH_RADIUS - 0.5 })).toEqual({
      ok: false,
      reason: SleepRejection.Monsters,
    });
  });

  it('ignores a hostile beyond the watch radius', () => {
    expect(canSleep({ ...base, nearestHostileDistance: MONSTER_WATCH_RADIUS + 0.5 })).toEqual({
      ok: true,
    });
  });

  it('refuses a bed out of reach, and rejects a non-finite distance', () => {
    expect(canSleep({ ...base, distance: PLAYER_REACH + 0.1 })).toEqual({
      ok: false,
      reason: SleepRejection.OutOfRange,
    });
    expect(canSleep({ ...base, distance: Number.NaN })).toEqual({
      ok: false,
      reason: SleepRejection.OutOfRange,
    });
  });

  it('reports reach before time, so aiming feedback comes first', () => {
    // Out of range during the day: the player needs to know they missed the bed
    // before being told the sun is up.
    const outcome = canSleep({ ...base, isNight: false, distance: 99 });
    expect(outcome).toEqual({ ok: false, reason: SleepRejection.OutOfRange });
  });

  it('has a message for every rejection', () => {
    for (const reason of Object.values(SleepRejection)) {
      expect(sleepRejectionMessage(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('waking up', () => {
  it('wakes into daylight, not back into the night', () => {
    const time = new TimeOfDay(0.75);
    expect(time.isNight).toBe(true);

    time.fraction = WAKE_FRACTION;
    expect(time.isNight).toBe(false);
    expect(time.lightLevel).toBeGreaterThan(new TimeOfDay(0.75).lightLevel);
  });

  it('clears a storm, and reports whether there was one', () => {
    const weather = new Weather(1);
    weather.kind = WeatherKind.Storm;
    expect(weather.clear()).toBe(true);
    expect(weather.kind).toBe(WeatherKind.Clear);

    // Already clear: nothing changed, so nothing is announced.
    expect(weather.clear()).toBe(false);
  });

  it('gives the cleared spell a fresh duration rather than expiring at once', () => {
    const weather = new Weather(7);
    weather.kind = WeatherKind.Rain;
    weather.secondsRemaining = 0.5;
    weather.clear();
    expect(weather.secondsRemaining).toBeGreaterThan(1);
  });
});
