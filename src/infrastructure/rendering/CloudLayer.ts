import * as THREE from 'three';
import type { Vec3Like } from '@domain/shared/Vec3';
import {
  CELL_WORLD_SIZE,
  CLOUD_CELLS,
  CLOUD_DECKS,
  CLOUD_THICKNESS,
  TILE_WORLD_SIZE,
  deckDrift,
  isSolidCell,
} from './CloudField';

/**
 * Tiles laid out around the player. Three is enough to reach well past any
 * usable far plane while the middle one stays under the camera.
 */
const TILES_ACROSS = 3;

const WHITE = new THREE.Color(0xffffff);

/**
 * Per-face brightness.
 *
 * The only thing giving the blocks their form — the material is unlit, so
 * without this a cube reads as a flat silhouette. Top catches the sky, sides
 * less, the underside least.
 */
const FACE_LIGHT = { top: 1, side: 0.86, end: 0.76, bottom: 0.62 };

/** How much of the weather's dimming reaches the clouds themselves. */
const WEATHER_DIMMING = 0.35;

/**
 * The cloud decks, built as voxels.
 *
 * Minecraft's clouds are boxes with real thickness, which is where the heavy
 * stepped edges come from. Each solid cell becomes a box; faces between two
 * solid cells are dropped, so a deck is a hollow shell rather than a pile of
 * cubes. Several decks are stacked at different heights and drift at their own
 * speeds, so the sky has depth instead of being one sliding sheet.
 *
 * Each deck is one tile of geometry drawn as instances, so the whole sky costs
 * one draw call per deck no matter how much of it is cloud.
 */
export class CloudLayer {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshBasicMaterial;
  private readonly tint = new THREE.Color(0xffffff);
  private overcast = false;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      // Not writing depth keeps a shell from occluding its own far faces,
      // which is what lets the blocks read as solid volumes rather than
      // flat-shaded outlines.
      depthWrite: false,
      side: THREE.FrontSide,
      fog: true,
    });

    const matrix = new THREE.Matrix4();
    const half = Math.floor(TILES_ACROSS / 2);

    for (let deck = 0; deck < CLOUD_DECKS.length; deck++) {
      const mesh = new THREE.InstancedMesh(
        buildDeckGeometry(deck, this.overcast),
        this.material,
        TILES_ACROSS * TILES_ACROSS,
      );
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;

      // Instances are a fixed lattice; only the parent moves.
      let index = 0;
      for (let tx = -half; tx <= half; tx++) {
        for (let tz = -half; tz <= half; tz++) {
          matrix.makeTranslation(tx * TILE_WORLD_SIZE, 0, tz * TILE_WORLD_SIZE);
          mesh.setMatrixAt(index++, matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;

      this.meshes.push(mesh);
      scene.add(mesh);
    }
  }

  /**
   * Thickens the cloud while it rains.
   *
   * Rebuilding is only sane because weather turns over on the order of
   * minutes; this must never be driven by a per-frame value.
   */
  setOvercast(overcast: boolean): void {
    if (overcast === this.overcast) return;
    this.overcast = overcast;

    for (let deck = 0; deck < this.meshes.length; deck++) {
      const mesh = this.meshes[deck];
      mesh.geometry.dispose();
      mesh.geometry = buildDeckGeometry(deck, overcast);
    }
  }

  /**
   * Tints the decks from the sky that lights them.
   *
   * `daylight` is the undimmed value on purpose. Feeding in the weather-dimmed
   * one would drive the cubed curve below far too dark — an overcast noon
   * would come out closer to dusk than to daylight. Weather is applied after,
   * as a gentle knock-down.
   */
  setAppearance(skyColor: THREE.Color, daylight: number, weatherDarkening: number): void {
    const light = clamp01(daylight);
    // Cubed, with a very small floor. Output is gamma-encoded, so a linear
    // blend that looks slight on paper lands several times brighter on screen:
    // a night factor of 0.11 rendered the deck at sRGB 0.37 over an sRGB 0.08
    // sky, which read as a lit ceiling rather than cloud.
    const toWhite = 0.005 + Math.pow(light, 3) * 0.85;
    this.tint.copy(skyColor).lerp(WHITE, toWhite);
    this.material.color
      .copy(this.tint)
      .multiplyScalar(1 - clamp01(weatherDarkening) * WEATHER_DIMMING);
  }

  update(camera: Vec3Like, elapsedSeconds: number): void {
    for (let deck = 0; deck < this.meshes.length; deck++) {
      const drift = deckDrift(deck, elapsedSeconds);

      // The lattice is anchored to the pattern, not to the player: snapping in
      // whole tiles keeps the camera covered without dragging the clouds
      // along, and adding the drift back is the only thing that moves them.
      const anchorX = Math.floor((camera.x - drift) / TILE_WORLD_SIZE) * TILE_WORLD_SIZE;
      const anchorZ = Math.floor(camera.z / TILE_WORLD_SIZE) * TILE_WORLD_SIZE;

      this.meshes[deck].position.set(anchorX + drift, CLOUD_DECKS[deck].height, anchorZ);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.material.dispose();
  }
}

/**
 * Meshes one tile of a deck into boxes.
 *
 * A face is emitted only where the neighbouring cell is empty. Cells wrap, so
 * the faces along a tile edge match the tile placed next to it and the seam is
 * invisible.
 */
function buildDeckGeometry(deck: number, overcast: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];

  const push = (
    quad: readonly (readonly [number, number, number])[],
    brightness: number,
  ): void => {
    // Two triangles from four corners, wound counter-clockwise from outside.
    for (const corner of [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]) {
      positions.push(corner[0], corner[1], corner[2]);
      colors.push(brightness, brightness, brightness);
    }
  };

  const solid = (column: number, row: number): boolean =>
    isSolidCell(deck, column, row, overcast);

  for (let row = 0; row < CLOUD_CELLS; row++) {
    for (let column = 0; column < CLOUD_CELLS; column++) {
      if (!solid(column, row)) continue;

      const x0 = column * CELL_WORLD_SIZE;
      const x1 = x0 + CELL_WORLD_SIZE;
      const z0 = row * CELL_WORLD_SIZE;
      const z1 = z0 + CELL_WORLD_SIZE;
      const y0 = 0;
      const y1 = CLOUD_THICKNESS;

      push(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        FACE_LIGHT.top,
      );
      push(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        FACE_LIGHT.bottom,
      );

      if (!solid(column + 1, row)) {
        push(
          [
            [x1, y0, z1],
            [x1, y0, z0],
            [x1, y1, z0],
            [x1, y1, z1],
          ],
          FACE_LIGHT.side,
        );
      }
      if (!solid(column - 1, row)) {
        push(
          [
            [x0, y0, z0],
            [x0, y0, z1],
            [x0, y1, z1],
            [x0, y1, z0],
          ],
          FACE_LIGHT.side,
        );
      }
      if (!solid(column, row + 1)) {
        push(
          [
            [x0, y0, z1],
            [x1, y0, z1],
            [x1, y1, z1],
            [x0, y1, z1],
          ],
          FACE_LIGHT.end,
        );
      }
      if (!solid(column, row - 1)) {
        push(
          [
            [x1, y0, z0],
            [x0, y0, z0],
            [x0, y1, z0],
            [x1, y1, z0],
          ],
          FACE_LIGHT.end,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
