import * as THREE from 'three';
import type { ItemDropView } from '@application/ports/GameRenderer';
import {
  ResourceItemId,
  resourceItem,
  type ItemId,
} from '@domain/inventory/Item';
import { createItemSpriteTexture } from './ItemDropTextures';

const MAX_DROPS_PER_ITEM = 128;

interface SpriteLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly texture: THREE.CanvasTexture;
  count: number;
}

/**
 * Minecraft-style dropped-item presentation.
 *
 * Each resource is a transparent 16px sprite rendered on two crossed planes.
 * Instances of one item share geometry, texture and material, so the maximum
 * draw cost is the number of different dropped resources—not the stack count.
 */
export class ItemDropLayer {
  private readonly geometry = createCrossedSpriteGeometry();
  private readonly layers = new Map<ItemId, SpriteLayer>();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private visible = 0;

  constructor(scene: THREE.Scene) {
    for (const resource of Object.values(ResourceItemId)) {
      const item = resourceItem(resource);
      const texture = createItemSpriteTexture(item);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.2,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
      });
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        material,
        MAX_DROPS_PER_ITEM,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.layers.set(item, { mesh, texture, count: 0 });
    }
  }

  get visibleCount(): number {
    return this.visible;
  }

  sync(views: readonly ItemDropView[]): void {
    for (const layer of this.layers.values()) layer.count = 0;

    for (const view of views) {
      const layer = this.layers.get(view.item);
      if (layer === undefined || layer.count >= MAX_DROPS_PER_ITEM) continue;

      const index = layer.count++;
      const bob = Math.sin(view.age * 3.2 + view.id * 0.7) * 0.06;
      const stackScale = 1 + Math.min(0.24, Math.log2(Math.max(1, view.count)) * 0.055);

      this.position.set(view.x, view.y + 0.08 + bob, view.z);
      // A slow upright turn keeps both crossed faces readable from any camera.
      this.euler.set(0, view.age * 1.8 + view.id * 0.73, 0);
      this.rotation.setFromEuler(this.euler);
      this.scale.setScalar(stackScale);
      this.matrix.compose(this.position, this.rotation, this.scale);
      layer.mesh.setMatrixAt(index, this.matrix);
    }

    this.visible = 0;
    for (const layer of this.layers.values()) {
      this.visible += layer.count;
      layer.mesh.count = layer.count;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const layer of this.layers.values()) {
      layer.mesh.removeFromParent();
      layer.mesh.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.texture.dispose();
    }
    this.layers.clear();
    this.geometry.dispose();
  }
}

function createCrossedSpriteGeometry(): THREE.BufferGeometry {
  const half = 0.28;
  const height = 0.56;
  const positions = new Float32Array([
    -half, 0, 0,
    half, 0, 0,
    half, height, 0,
    -half, height, 0,
    0, 0, -half,
    0, 0, half,
    0, height, half,
    0, height, -half,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  geometry.computeBoundingSphere();
  return geometry;
}
