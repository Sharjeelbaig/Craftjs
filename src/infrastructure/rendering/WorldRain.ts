import * as THREE from 'three';
import type { Vec3Like } from '@domain/shared/Vec3';

const DROP_COUNT = 960;
const HORIZONTAL_RADIUS = 30;
const VERTICAL_RANGE = 42;
const DROP_LENGTH = 2.8;
const CELL_SIZE = 8;

interface DropSeed {
  readonly x: number;
  readonly z: number;
  readonly phase: number;
  readonly lengthScale: number;
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
    const top = camera.y + VERTICAL_RANGE * 0.55;
    const travelled = elapsedSeconds * this.speed;
    const wind = this.intensity * 0.38;

    for (let index = 0; index < this.drops.length; index++) {
      const drop = this.drops[index];
      const x = centreX + drop.x;
      const z = centreZ + drop.z;
      const y = top - ((travelled + drop.phase * VERTICAL_RANGE) % VERTICAL_RANGE);
      const length = DROP_LENGTH * drop.lengthScale;
      const surface = this.surfaces[index];
      const endY = Math.min(y, Math.max(y - length, surface + 0.04));
      const offset = index * 6;

      this.positions[offset] = x;
      this.positions[offset + 1] = y <= surface ? surface : y;
      this.positions[offset + 2] = z;
      this.positions[offset + 3] = y <= surface ? x : x + wind;
      this.positions[offset + 4] = y <= surface ? surface : endY;
      this.positions[offset + 5] = y <= surface ? z : z + wind * 0.18;
    }

    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
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
  return {
    x: (hash(index * 4 + 1) * 2 - 1) * HORIZONTAL_RADIUS,
    z: (hash(index * 4 + 2) * 2 - 1) * HORIZONTAL_RADIUS,
    phase: hash(index * 4 + 3),
    lengthScale: 0.55 + hash(index * 4 + 4) * 0.9,
  };
}

function hash(value: number): number {
  let state = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}
