import { describe, expect, it } from 'vitest';
import { Weather, WeatherKind } from '@domain/world/Weather';

describe('Weather', () => {
  it('is deterministic for a world seed', () => {
    const first = new Weather(1234);
    const second = new Weather(1234);
    for (let index = 0; index < 20; index++) {
      first.advance(60);
      second.advance(60);
      expect(first.snapshot()).toEqual(second.snapshot());
    }
  });

  it('alternates weather events with clear periods', () => {
    const weather = new Weather(7);
    expect(weather.kind).toBe(WeatherKind.Clear);
    weather.advance(1000);
    expect([WeatherKind.Rain, WeatherKind.Storm]).toContain(weather.kind);
    weather.advance(1000);
    expect(weather.kind).toBe(WeatherKind.Clear);
  });

  it('restores safe state and rejects invalid durations', () => {
    const weather = new Weather(1);
    weather.restore({ kind: WeatherKind.Storm, secondsRemaining: 12 });
    expect(weather.kind).toBe(WeatherKind.Storm);
    expect(weather.secondsRemaining).toBe(12);

    weather.restore({ kind: 'tornado' as never, secondsRemaining: Number.NaN });
    expect(weather.kind).toBe(WeatherKind.Storm);
    expect(weather.secondsRemaining).toBe(12);
  });
});
