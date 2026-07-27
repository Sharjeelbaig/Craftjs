import * as THREE from 'three';
import type { Vec3Like } from '@domain/shared/Vec3';
import { cloudBaseAt } from './CloudField';

/**
 * Only columns under cloud produce a drop, and lighter weather retires some of
 * the rest, so well under this many are alive at once.
 */
const DROP_COUNT = 9000;

/**
 * Reach of the rain field.
 *
 * Wide enough to read as a curtain across the view rather than a shower that
 * only exists once you are inside it. Fog dissolves whatever is left at the
 * far edge, so this does not need to match the render distance.
 */
const HORIZONTAL_RADIUS = 92;

/**
 * Concentrates drops near the viewer. Uniform-over-area would be 0.5; above
 * that thins the far field, which is where drops are least legible anyway and
 * cost the most to have too many of.
 */
const RADIUS_BIAS = 0.62;

const DROP_LENGTH = 2.8;

/** Coarser than the drop spacing: this only controls surface re-sampling. */
const CELL_SIZE = 16;

/** Sideways travel per unit fallen. Gives the column a consistent lean. */
const WIND_SHEAR = 0.14;


interface DropSeed {
  readonly x: number;
  readonly z: number;
  readonly phase: number;
  readonly lengthScale: number;
  /** Stable rank in [0, 1]; drops above the intensity sit out the shower. */
  readonly rank: number;
}

/**
 * A bounded world-space precipitation volume.
 *
 * Drops are real line segments in the scene, so perspective, movement
 * parallax and terrain depth all apply naturally. The field follows the player
 * in coarse cells and recycles vertically; GPU cost remains one draw call.
 */
export class WorldRain {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(DROP_COUNT * 2 * 3);
  private readonly material = new THREE.LineBasicMaterial({
    color: 0xb9dbf2,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly lines: THREE.LineSegments;
  private readonly drops: readonly DropSeed[];
  private intensity = 0;
  /** Mirrors the cloud decks' thickened state so rain lands under real cloud. */
  private overcast = false;
  private speed = 24;
  private surfaceSampler: ((x: number, z: number) => number | null) | null = null;
  private readonly surfaces = new Float32Array(DROP_COUNT).fill(Number.NEGATIVE_INFINITY);
  private sampledCellX = Number.NaN;
  private sampledCellZ = Number.NaN;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setDrawRange(0, DROP_COUNT * 2);
    this.drops = Array.from({ length: DROP_COUNT }, (_, index) => createDrop(index));
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  setStrength(strength: number): void {
    this.intensity = Math.max(0, Math.min(1, strength));
    // Any precipitation at all means the cloud pattern is the thickened one;
    // sampling the fair-weather pattern would put rain in the wrong columns.
    this.overcast = this.intensity > 0;
    this.lines.visible = this.intensity > 0;
    this.material.opacity = 0.26 + this.intensity * 0.34;
    this.speed = 22 + this.intensity * 10;
  }

  setSurfaceSampler(sampler: (x: number, z: number) => number | null): void {
    this.surfaceSampler = sampler;
    this.sampledCellX = Number.NaN;
    this.sampledCellZ = Number.NaN;
  }

  update(camera: Vec3Like, elapsedSeconds: number): void {
    if (!this.lines.visible) return;

    // Coarse anchoring is deliberate: a camera-relative particle sheet would
    // recreate the "stuck to the screen" illusion this layer replaces.
    const centreX = Math.floor(camera.x / CELL_SIZE) * CELL_SIZE;
    const centreZ = Math.floor(camera.z / CELL_SIZE) * CELL_SIZE;
    this.sampleSurfaces(centreX, centreZ);
    const travelled = elapsedSeconds * this.speed;

    for (let index = 0; index < this.drops.length; index++) {
      const drop = this.drops[index];
      const x = centreX + drop.x;
      const z = centreZ + drop.z;
      const offset = index * 6;

      // Lighter weather retires the higher-ranked drops, so a shower and a
      // storm differ in how much rain there is, not just how bright it is.
      if (drop.rank > this.intensity) {
        this.hideDrop(offset);
        continue;
      }

      // An unloaded column has no known ground to land on. Skipping it beats
      // guessing a floor, which streaks rain down through the world to bedrock.
      const ground = this.surfaces[index];
      // Rain is what the cloud above is doing, and it starts at whichever deck
      // is lowest over this column — so a gap in the low cloud shows rain
      // falling from further up rather than no rain at all.
      const base = cloudBaseAt(x, z, elapsedSeconds, this.overcast);
      if (base === null || !Number.isFinite(ground)) {
        this.hideDrop(offset);
        continue;
      }

      const fall = base - ground;
      if (fall <= 1) {
        this.hideDrop(offset);
        continue;
      }

      // Each drop cycles the full cloud-to-ground distance, so its lifetime is
      // the real fall rather than a window pinned to the viewer's altitude.
      const y = base - ((travelled + drop.phase * fall) % fall);
      const length = DROP_LENGTH * drop.lengthScale;
      const endY = Math.max(y - length, ground);

      // Lean accumulates with distance fallen: drops leaving the cloud are
      // still overhead, and the ones about to land are well downwind.
      const lean = (base - y) * WIND_SHEAR * this.intensity;
      const leanEnd = (base - endY) * WIND_SHEAR * this.intensity;

      this.positions[offset] = x + lean;
      this.positions[offset + 1] = y;
      this.positions[offset + 2] = z;
      this.positions[offset + 3] = x + leanEnd;
      this.positions[offset + 4] = endY;
      this.positions[offset + 5] = z;
    }

    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }

  /** Collapses a segment to a point so it draws nothing. */
  private hideDrop(offset: number): void {
    for (let i = 0; i < 6; i++) this.positions[offset + i] = 0;
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private sampleSurfaces(centreX: number, centreZ: number): void {
    if (
      this.surfaceSampler === null ||
      (centreX === this.sampledCellX && centreZ === this.sampledCellZ)
    ) {
      return;
    }
    this.sampledCellX = centreX;
    this.sampledCellZ = centreZ;
    for (let index = 0; index < this.drops.length; index++) {
      const drop = this.drops[index];
      this.surfaces[index] =
        this.surfaceSampler(centreX + drop.x, centreZ + drop.z) ??
        Number.NEGATIVE_INFINITY;
    }
  }
}

function createDrop(index: number): DropSeed {
  // Polar rather than a square patch: a square puts its corners 40% further
  // out than its edges, which shows up as a visibly rectangular shower.
  const angle = hash(index * 5 + 1) * Math.PI * 2;
  const radius = HORIZONTAL_RADIUS * Math.pow(hash(index * 5 + 2), RADIUS_BIAS);

  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    phase: hash(index * 5 + 3),
    lengthScale: 0.55 + hash(index * 5 + 4) * 0.9,
    rank: hash(index * 5 + 5),
  };
}

function hash(value: number): number {
  let state = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}
