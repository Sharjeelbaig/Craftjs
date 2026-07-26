import * as THREE from 'three';
import type {
  CameraPose,
  EntityView,
  GameRenderer,
  ItemDropView,
  RenderStats,
  SkyState,
} from '@application/ports/GameRenderer';
import type { ChunkMeshData, MeshGeometry } from '@application/ports/ChunkMesher';
import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { Vec3Like } from '@domain/shared/Vec3';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';
import { createBlockTextureArray } from './TextureAtlas';
import { createVoxelMaterials, type VoxelMaterials } from './VoxelMaterial';
import { EntityLayer } from './EntityLayer';
import { ItemDropLayer } from './ItemDropLayer';
import { WorldRain } from './WorldRain';

/** Sky palette, interpolated across the day by sun height. */
const DAY_SKY = new THREE.Color(0x8fc4ea);
const DUSK_SKY = new THREE.Color(0xe08a52);
const NIGHT_SKY = new THREE.Color(0x0a1020);

const UNDERWATER_COLOR = new THREE.Color(0x1b4a7a);
const UNDERWATER_FOG_NEAR = 0.1;
const UNDERWATER_FOG_FAR = 22;

/** Highlight colour, brightening as a block nears breaking. */
const HIGHLIGHT_IDLE = new THREE.Color(0x101014);
const HIGHLIGHT_BREAKING = new THREE.Color(0xffd479);

interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
}

/**
 * Three.js implementation of the rendering port.
 *
 * Owns every GPU resource in the engine, and is the only place that knows a
 * graphics API exists. Chunk geometry is uploaded once and never touched
 * again until it changes, so per-frame cost is draw submission only.
 */
export class ThreeRenderer implements GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly materials: VoxelMaterials;
  private readonly atlas: THREE.DataArrayTexture;
  private readonly highlight: THREE.LineSegments;
  private readonly entityLayer: EntityLayer;
  private readonly itemDropLayer: ItemDropLayer;
  private readonly rain: WorldRain;
  private readonly chunks = new Map<string, ChunkMeshes>();

  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = () => this.resize();

  /** Current sky colour, recomputed only when the sun moves meaningfully. */
  private readonly skyColor = DAY_SKY.clone();
  private daylight = 1;
  private sunHeight = 1;
  private weatherDarkening = 0;
  private fogMultiplier = 1;

  private renderDistance = 8;
  private submerged = false;
  private contextLost = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, renderDistance = 8) {
    this.canvas = canvas;
    this.renderDistance = renderDistance;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Capping the pixel ratio keeps fill cost sane on high-DPI displays; the
    // nearest-filtered block look does not benefit from more than 2x anyway.
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(this.skyColor, 1);
    this.renderer.sortObjects = true;

    this.scene = new THREE.Scene();
    this.scene.background = this.skyColor.clone();

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
    // YXZ keeps yaw and pitch independent, so looking up never rolls the view.
    this.camera.rotation.order = 'YXZ';

    this.atlas = createBlockTextureArray();
    this.materials = createVoxelMaterials(
      this.atlas,
      this.skyColor,
      this.fogNear,
      this.fogFar,
    );

    this.highlight = this.createHighlight();
    this.scene.add(this.highlight);

    this.entityLayer = new EntityLayer(this.scene, this.skyColor, this.fogNear, this.fogFar);
    this.itemDropLayer = new ItemDropLayer(this.scene);
    this.rain = new WorldRain(this.scene);

    this.applyViewDistance();

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    globalThis.addEventListener?.('resize', this.onWindowResize);

    this.resize();
  }

  private get viewDistance(): number {
    return this.renderDistance * CHUNK_SIZE;
  }

  private get fogNear(): number {
    return this.viewDistance * 0.55 * this.fogMultiplier;
  }

  private get fogFar(): number {
    return Math.max(
      this.fogNear + 1,
      (this.viewDistance - CHUNK_SIZE * 0.5) * this.fogMultiplier,
    );
  }

  setRenderDistance(chunks: number): void {
    const next = Math.max(2, Math.round(chunks));
    if (next === this.renderDistance) return;
    this.renderDistance = next;
    this.applyViewDistance();
  }

  setRainSurfaceSampler(sampler: (x: number, z: number) => number | null): void {
    this.rain.setSurfaceSampler(sampler);
  }

  private applyViewDistance(): void {
    this.camera.far = this.viewDistance + CHUNK_SIZE * 2;
    this.camera.updateProjectionMatrix();
    this.applyAtmosphere();
  }

  /**
   * Applies time of day and sky colour.
   *
   * Sky, fog and ambient light all derive from the same sun height, so they
   * can never disagree — a bright sky over dark terrain is not representable.
   */
  setSky(sky: SkyState): void {
    const darkening = clamp01(sky.weatherDarkening ?? 0);
    const fogMultiplier = Math.max(0.35, Math.min(1, sky.fogMultiplier ?? 1));
    const light = clamp01(sky.light * (1 - darkening));
    const height = Number.isFinite(sky.sunHeight) ? sky.sunHeight : 1;

    // Sun height changes continuously; skip the colour work unless it moved
    // enough to be visible, which is most frames.
    if (
      Math.abs(height - this.sunHeight) < 0.002 &&
      Math.abs(light - this.daylight) < 0.002 &&
      Math.abs(darkening - this.weatherDarkening) < 0.002 &&
      Math.abs(fogMultiplier - this.fogMultiplier) < 0.002
    ) {
      return;
    }

    this.daylight = light;
    this.sunHeight = height;
    this.weatherDarkening = darkening;
    this.fogMultiplier = fogMultiplier;
    this.rain.setStrength(Math.max(0, Math.min(1, sky.precipitation ?? 0)));

    this.materials.setDaylight(light);
    this.entityLayer.setDaylight(light);

    if (height >= 0.2) {
      this.skyColor.copy(DAY_SKY);
    } else if (height >= -0.05) {
      // Low sun: warm horizon between day and night.
      this.skyColor.copy(DUSK_SKY).lerp(DAY_SKY, (height + 0.05) / 0.25);
    } else {
      this.skyColor.copy(NIGHT_SKY).lerp(DUSK_SKY, clamp01((height + 0.35) / 0.3));
    }
    this.skyColor.lerp(NIGHT_SKY, darkening * 0.72);

    this.applyAtmosphere();
  }

  private applyAtmosphere(): void {
    const color = this.submerged ? UNDERWATER_COLOR : this.skyColor;
    const near = this.submerged ? UNDERWATER_FOG_NEAR : this.fogNear;
    const far = this.submerged ? UNDERWATER_FOG_FAR : this.fogFar;

    this.materials.setFog(color, near, far);
    this.entityLayer.setFog(color, near, far);
    (this.scene.background as THREE.Color).copy(color);
    this.renderer.setClearColor(color, 1);
  }

  updateChunk(coord: ChunkCoord, data: ChunkMeshData): void {
    if (this.disposed) return;

    let entry = this.chunks.get(coord.key);
    if (entry === undefined) {
      entry = { opaque: null, transparent: null };
      this.chunks.set(coord.key, entry);
    }

    entry.opaque = this.swapMesh(entry.opaque, data.opaque, coord, this.materials.opaque, 0);
    entry.transparent = this.swapMesh(
      entry.transparent,
      data.transparent,
      coord,
      this.materials.transparent,
      1,
    );

    if (entry.opaque === null && entry.transparent === null) {
      this.chunks.delete(coord.key);
    }
  }

  removeChunk(coord: ChunkCoord): void {
    const entry = this.chunks.get(coord.key);
    if (entry === undefined) return;
    this.disposeMesh(entry.opaque);
    this.disposeMesh(entry.transparent);
    this.chunks.delete(coord.key);
  }

  setBlockHighlight(block: Vec3Like | null): void {
    if (block === null) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
    this.highlight.updateMatrix();
  }

  /**
   * Shows mining progress by brightening and thickening the block outline.
   *
   * Cheaper and more legible than crack textures, which would need a second
   * texture set and an extra draw call per broken block.
   */
  setBreakProgress(progress: number): void {
    const clamped = clamp01(progress);
    const material = this.highlight.material as THREE.LineBasicMaterial;
    material.color.copy(HIGHLIGHT_IDLE).lerp(HIGHLIGHT_BREAKING, clamped);
    material.opacity = 0.55 + clamped * 0.45;

    const scale = 1 + clamped * 0.04;
    this.highlight.scale.setScalar(scale);
    this.highlight.updateMatrix();
  }

  syncEntities(views: readonly EntityView[]): void {
    if (this.disposed) return;
    this.entityLayer.sync(views);
  }

  syncItemDrops(views: readonly ItemDropView[]): void {
    if (this.disposed) return;
    this.itemDropLayer.sync(views);
  }

  setSubmerged(submerged: boolean): void {
    if (submerged === this.submerged) return;
    this.submerged = submerged;
    this.applyAtmosphere();
  }

  render(camera: CameraPose): void {
    if (this.disposed || this.contextLost) return;

    this.camera.position.set(camera.position.x, camera.position.y, camera.position.z);
    this.camera.rotation.set(camera.pitch, camera.yaw, 0);
    this.rain.update(camera.position, performance.now() / 1000);

    this.renderer.render(this.scene, this.camera);
  }

  getStats(): RenderStats {
    const info = this.renderer.info.render;
    return {
      drawCalls: info.calls,
      triangles: info.triangles,
      chunkMeshes: this.chunks.size,
      entities: this.entityLayer.visibleCount + this.itemDropLayer.visibleCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.resizeObserver?.disconnect();
    globalThis.removeEventListener?.('resize', this.onWindowResize);

    for (const entry of this.chunks.values()) {
      this.disposeMesh(entry.opaque);
      this.disposeMesh(entry.transparent);
    }
    this.chunks.clear();

    this.entityLayer.dispose();
    this.itemDropLayer.dispose();
    this.rain.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.scene.clear();

    this.materials.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Replaces a chunk's mesh, disposing the previous geometry.
   *
   * Chunk geometry is rebuilt every time a block changes, so failing to
   * release the old buffers here would leak GPU memory continuously while the
   * player builds.
   */
  private swapMesh(
    previous: THREE.Mesh | null,
    geometry: MeshGeometry | null,
    coord: ChunkCoord,
    material: THREE.Material,
    renderOrder: number,
  ): THREE.Mesh | null {
    this.disposeMesh(previous);
    if (geometry === null) return null;

    const mesh = new THREE.Mesh(this.createGeometry(geometry), material);
    mesh.position.set(coord.originX, 0, coord.originZ);
    mesh.renderOrder = renderOrder;
    // Chunk meshes never move; skipping the per-frame matrix update removes
    // hundreds of redundant recomputations at high render distances.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  private createGeometry(source: MeshGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
    geometry.setAttribute('aUv', new THREE.BufferAttribute(source.uvs, 2));
    geometry.setAttribute('aLayer', new THREE.BufferAttribute(source.layers, 1));
    geometry.setAttribute('aLight', new THREE.BufferAttribute(source.lights, 1));
    geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
    // Required for frustum culling, which is what keeps draw calls proportional
    // to what is on screen rather than to what is loaded.
    geometry.computeBoundingSphere();
    return geometry;
  }

  private disposeMesh(mesh: THREE.Mesh | null): void {
    if (mesh === null) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
  }

  private createHighlight(): THREE.LineSegments {
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();

    const material = new THREE.LineBasicMaterial({
      color: HIGHLIGHT_IDLE.clone(),
      transparent: true,
      opacity: 0.55,
      depthTest: true,
    });

    const lines = new THREE.LineSegments(edges, material);
    lines.visible = false;
    lines.matrixAutoUpdate = false;
    lines.renderOrder = 2;
    return lines;
  }

  private resize(): void {
    if (this.disposed) return;
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the browser will not attempt a restore.
    event.preventDefault();
    this.contextLost = true;
    console.warn('[craftjs] WebGL context lost; rendering paused');
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // Textures are re-uploaded lazily from retained CPU data; geometry three
    // handles itself. Forcing the atlas keeps the first restored frame from
    // rendering untextured.
    this.atlas.needsUpdate = true;
    this.applyAtmosphere();
    this.resize();
    console.info('[craftjs] WebGL context restored');
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
