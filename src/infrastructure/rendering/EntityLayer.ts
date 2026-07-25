import * as THREE from 'three';
import type { EntityView } from '@application/ports/GameRenderer';
import type { EntityTypeId } from '@domain/entity/EntityType';
import {
  AnimationRole,
  MODELLED_TYPES,
  modelFor,
  type PartDefinition,
} from './EntityModels';

/**
 * Instances allocated per body part.
 *
 * Capacity is fixed at build time because growing an `InstancedMesh` means
 * reallocating GPU buffers mid-frame. The entity manager caps the population
 * well below this, so the ceiling is never reached in practice.
 */
const MAX_INSTANCES_PER_PART = 48;

/** Colour multiplied in while a creature is flashing from damage. */
const HURT_TINT = new THREE.Color(0xff6a5a);
const NORMAL_TINT = new THREE.Color(0xffffff);

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in vec3 instanceColor;

out vec3 vTint;
out float vShade;
out float vDepth;

void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vec4 viewPosition = modelViewMatrix * local;

  // The instance matrix carries the limb rotation, so the normal has to be
  // rotated by it too or a swinging leg keeps the shading of its rest pose.
  vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
  vec3 lightDirection = normalize(vec3(0.45, 0.9, 0.25));
  vShade = 0.55 + 0.45 * max(dot(worldNormal, lightDirection), 0.0);

  vTint = instanceColor;
  vDepth = -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDaylight;

in vec3 vTint;
in float vShade;
in float vDepth;

out vec4 fragColor;

void main() {
  vec3 color = uColor * vTint * vShade * uDaylight;
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  fragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

interface PartLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly definition: PartDefinition;
}

interface TypeLayer {
  readonly parts: readonly PartLayer[];
  readonly swingAmplitude: number;
  /** Instances written so far this frame. */
  count: number;
}

/**
 * Draws every creature with one instanced draw call per body part.
 *
 * Per-creature meshes would cost roughly six draw calls each and dominate the
 * frame at any real population; instancing makes the cost proportional to the
 * number of distinct body parts in the game — a constant — rather than to how
 * many creatures are alive.
 */
export class EntityLayer {
  private readonly group = new THREE.Group();
  private readonly layers = new Map<EntityTypeId, TypeLayer>();
  private readonly materials: THREE.RawShaderMaterial[] = [];
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);

  // Scratch objects reused every frame; allocating per creature per part would
  // produce thousands of short-lived objects a second.
  private readonly matrix = new THREE.Matrix4();
  private readonly partMatrix = new THREE.Matrix4();
  private readonly pivotMatrix = new THREE.Matrix4();
  private readonly swingMatrix = new THREE.Matrix4();
  private readonly baseMatrix = new THREE.Matrix4();
  private readonly offsetMatrix = new THREE.Matrix4();
  private readonly scaleMatrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private visible = 0;

  constructor(scene: THREE.Scene, fogColor: THREE.Color, fogNear: number, fogFar: number) {
    for (const type of MODELLED_TYPES) {
      const model = modelFor(type);
      const parts: PartLayer[] = [];

      for (const definition of model.parts) {
        const material = this.createMaterial(definition.colour, fogColor, fogNear, fogFar);
        const mesh = new THREE.InstancedMesh(this.geometry, material, MAX_INSTANCES_PER_PART);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(MAX_INSTANCES_PER_PART * 3).fill(1),
          3,
        );
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        // Creatures move every frame, so a static bounding volume would cull
        // them incorrectly; the population is small enough to always submit.
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.renderOrder = 0;

        this.materials.push(material);
        parts.push({ mesh, definition });
        this.group.add(mesh);
      }

      this.layers.set(type, { parts, swingAmplitude: model.swingAmplitude, count: 0 });
    }

    scene.add(this.group);
  }

  get visibleCount(): number {
    return this.visible;
  }

  setFog(color: THREE.Color, near: number, far: number): void {
    for (const material of this.materials) {
      (material.uniforms.uFogColor.value as THREE.Color).copy(color);
      material.uniforms.uFogNear.value = near;
      material.uniforms.uFogFar.value = far;
    }
  }

  setDaylight(level: number): void {
    for (const material of this.materials) {
      material.uniforms.uDaylight.value = level;
    }
  }

  /** Rebuilds every instance transform from this frame's creature list. */
  sync(views: readonly EntityView[]): void {
    for (const layer of this.layers.values()) layer.count = 0;

    for (const view of views) {
      const layer = this.layers.get(view.type);
      if (layer === undefined) continue;
      if (layer.count >= MAX_INSTANCES_PER_PART) continue;

      const index = layer.count++;
      this.writeInstance(layer, index, view);
    }

    this.visible = 0;
    for (const layer of this.layers.values()) {
      this.visible += layer.count;
      for (const partLayer of layer.parts) {
        partLayer.mesh.count = layer.count;
        partLayer.mesh.instanceMatrix.needsUpdate = true;
        if (partLayer.mesh.instanceColor !== null) {
          partLayer.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  dispose(): void {
    for (const layer of this.layers.values()) {
      for (const partLayer of layer.parts) {
        this.group.remove(partLayer.mesh);
        partLayer.mesh.dispose();
      }
    }
    this.layers.clear();

    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.geometry.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------ private

  private writeInstance(layer: TypeLayer, index: number, view: EntityView): void {
    // Limbs on opposite sides swing out of phase, which is what turns a
    // rocking body into a walk.
    const swing = Math.sin(view.walkPhase) * layer.swingAmplitude;
    // Head bob is deliberately subtle and at half the limb rate.
    const bob = Math.sin(view.walkPhase * 0.5) * 0.06;

    this.euler.set(0, view.yaw, 0);
    this.matrix.makeRotationFromEuler(this.euler);
    this.matrix.setPosition(view.x, view.y, view.z);

    const tint = view.hurt ? HURT_TINT : NORMAL_TINT;

    for (const partLayer of layer.parts) {
      const part = partLayer.definition;
      const angle = angleFor(part, swing, bob);

      this.pivotMatrix.makeTranslation(part.pivotX, part.pivotY, part.pivotZ);
      this.swingMatrix.makeRotationX(angle);

      this.euler.set(part.rotationX, part.rotationY, part.rotationZ);
      this.baseMatrix.makeRotationFromEuler(this.euler);

      this.offsetMatrix.makeTranslation(part.centreX, part.centreY, part.centreZ);
      this.scaleMatrix.makeScale(part.sizeX, part.sizeY, part.sizeZ);

      // entity -> pivot -> animated swing -> fixed pose -> box centre -> size
      this.partMatrix
        .copy(this.matrix)
        .multiply(this.pivotMatrix)
        .multiply(this.swingMatrix)
        .multiply(this.baseMatrix)
        .multiply(this.offsetMatrix)
        .multiply(this.scaleMatrix);

      partLayer.mesh.setMatrixAt(index, this.partMatrix);
      partLayer.mesh.setColorAt(index, tint);
    }
  }

  private createMaterial(
    colour: number,
    fogColor: THREE.Color,
    fogNear: number,
    fogFar: number,
  ): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(colour) },
        uFogColor: { value: fogColor.clone() },
        uFogNear: { value: fogNear },
        uFogFar: { value: fogFar },
        uDaylight: { value: 1 },
      },
    });
  }
}

function angleFor(part: PartDefinition, swing: number, bob: number): number {
  switch (part.role) {
    case AnimationRole.LimbA:
      return swing * part.swingScale;
    case AnimationRole.LimbB:
      return -swing * part.swingScale;
    case AnimationRole.Head:
      return bob;
    default:
      return 0;
  }
}
