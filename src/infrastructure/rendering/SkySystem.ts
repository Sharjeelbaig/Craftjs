import * as THREE from 'three';
import { SkyDome } from './SkyDome';
import { CelestialBody } from './CelestialBody';
import { StarField } from './StarField';
import { CloudLayer } from './CloudLayer';

const SUN_COLOR = new THREE.Color(0xfff4d0);
const MOON_COLOR = new THREE.Color(0xdde6f5);

/** Zenith is a deeper shade of the horizon colour, never a separate palette. */
const ZENITH_DARKENING = 0.72;

/**
 * Owns every element drawn beyond the terrain: dome, sun, moon, stars, clouds.
 *
 * It deliberately holds no time-of-day rules. Colour and daylight arrive
 * already resolved from the renderer, which is the single place the day/night
 * cycle is interpreted — a second palette here is what made the sky read orange
 * at night. Everything is placed relative to the camera and scaled to its far
 * plane, so nothing is ever clipped or reachable.
 */
export class SkySystem {
  private readonly skyDome: SkyDome;
  private readonly sun: CelestialBody;
  private readonly moon: CelestialBody;
  private readonly stars: StarField;
  private readonly clouds: CloudLayer;

  private readonly zenith = new THREE.Color();
  /** Retained because the clouds need colour and daylight together, and the
   * renderer supplies them from two separate callbacks. */
  private readonly horizon = new THREE.Color(0x8fc4ea);
  private daylight = 1;
  private darkening = 0;

  constructor(scene: THREE.Scene) {
    this.skyDome = new SkyDome(scene);
    this.sun = new CelestialBody(scene, 0.07, SUN_COLOR);
    this.moon = new CelestialBody(scene, 0.05, MOON_COLOR);
    this.stars = new StarField(scene);
    this.clouds = new CloudLayer(scene);
  }

  /**
   * Adopts the renderer's resolved sky colour as the horizon, deriving the
   * zenith from it. Weather darkening and the night palette are already folded
   * into the value, so they carry through without being recomputed.
   */
  setSkyColor(horizon: THREE.Color): void {
    this.horizon.copy(horizon);
    this.zenith.copy(horizon).multiplyScalar(ZENITH_DARKENING);
    this.skyDome.setColors(this.zenith, horizon);
    this.clouds.setAppearance(this.horizon, this.daylight, this.darkening);
  }

  /**
   * `daylight` is the undimmed value; weather arrives separately so each
   * element can decide how much of it to take.
   */
  setDaylight(daylight: number, weatherDarkening: number): void {
    this.daylight = clamp01(daylight);
    this.darkening = clamp01(weatherDarkening);
    this.clouds.setAppearance(this.horizon, this.daylight, this.darkening);
    // Stars fade out as soon as there is any real daylight, not linearly —
    // a half-lit sky already washes them out completely. Overcast hides them
    // outright: cloud between the viewer and the stars is not a dimmer sky.
    this.stars.setVisibility(clamp01(1 - this.daylight * 2.2) * (1 - this.darkening));
  }

  /** Thickens the decks while it rains. Weather-rate, never per frame. */
  setOvercast(overcast: boolean): void {
    this.clouds.setOvercast(overcast);
  }

  /**
   * Places the dome and the orbiting bodies for this frame.
   *
   * `sunHeight` is the same value the renderer uses to pick the sky palette,
   * so the sun is always where the light says it is.
   */
  update(
    camera: THREE.PerspectiveCamera,
    sunHeight: number,
    sunHorizontal: number,
    elapsedSeconds: number,
  ): void {
    // Everything sits just inside the far plane. Fixed world distances would
    // be clipped the moment the render distance dropped.
    const radius = camera.far * 0.92;
    const eye = camera.position;

    this.skyDome.setPosition(eye, radius);
    this.stars.setPosition(eye, radius * 0.98);
    this.stars.update(elapsedSeconds);

    // Height and horizontal together are a point on the sun's circle. Deriving
    // the horizontal from the height instead would lose its sign, and the sun
    // would set on the side it rose from.
    const height = Math.max(-1, Math.min(1, sunHeight));
    const horizontal = Math.max(-1, Math.min(1, sunHorizontal));
    const orbit = radius * 0.85;

    this.sun.setPosition(eye.x + horizontal * orbit, eye.y + height * orbit, eye.z);
    this.moon.setPosition(eye.x - horizontal * orbit, eye.y - height * orbit, eye.z);
    this.sun.setScale(orbit);
    this.moon.setScale(orbit);
    this.sun.faceCamera(camera);
    this.moon.faceCamera(camera);

    // Below the horizon each body is behind the dome anyway; hiding them saves
    // the draw and avoids a sliver poking through at the seam.
    this.sun.setVisibility(height > -0.15);
    this.moon.setVisibility(height < 0.15);

    this.clouds.update(eye, elapsedSeconds);
  }

  dispose(): void {
    this.skyDome.dispose();
    this.sun.dispose();
    this.moon.dispose();
    this.stars.dispose();
    this.clouds.dispose();
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
