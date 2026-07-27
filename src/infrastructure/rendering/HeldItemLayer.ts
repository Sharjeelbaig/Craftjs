import * as THREE from 'three';
import type { HeldItemView } from '@application/ports/GameRenderer';
import { BlockRegistry } from '@domain/world/BlockType';
import { heldGenericModel, heldToolModel, type HeldItemModel } from './HeldItemModels';

/** Seconds one swing takes. Long enough to read, short enough not to lag input. */
const SWING_SECONDS = 0.26;

/** Rest pose of the hand in camera space, in blocks. */
const REST_X = 0.34;
const REST_Y = -0.3;
const REST_Z = -0.58;

/** Per-face shading for the held block, matching the world's face brightness. */
const FACE_SHADE: readonly number[] = Object.freeze([0.74, 0.74, 1, 0.5, 0.88, 0.88]);

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec3 normal;

out float vShade;

void main() {
  vec3 viewNormal = normalize(mat3(modelViewMatrix) * normal);
  vShade = 0.62 + 0.38 * max(dot(viewNormal, normalize(vec3(0.3, 0.7, 0.6))), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uDaylight;

in float vShade;

out vec4 fragColor;

void main() {
  fragColor = vec4(uColor * vShade * uDaylight, 1.0);
}
`;

/**
 * The first-person view model.
 *
 * Drawn into its own scene with its own camera and a cleared depth buffer, so
 * the item can sit centimetres from the eye without being clipped by the near
 * plane or intersecting the wall the player is standing against — the two
 * artefacts that make an in-world hand model unusable.
 */
export class HeldItemLayer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.01, 4);
  private readonly pivot = new THREE.Group();
  private readonly atlas: THREE.DataArrayTexture;

  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private current: string | null = null;
  private swingRemaining = 0;
  private daylight = 1;
  private disposed = false;

  constructor(atlas: THREE.DataArrayTexture) {
    this.atlas = atlas;
    this.scene.add(this.pivot);
  }

  get hasItem(): boolean {
    return this.current !== null;
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setDaylight(level: number): void {
    // Held items are lit by the same clock as the world, but never fully dark:
    // a hand you cannot see at night is worse than a slightly bright one.
    this.daylight = 0.45 + 0.55 * Math.max(0, Math.min(1, level));
    for (const material of this.materials) {
      const uniforms = (material as THREE.RawShaderMaterial).uniforms;
      if (uniforms?.uDaylight !== undefined) uniforms.uDaylight.value = this.daylight;
    }
  }

  /** Starts a swing. Re-triggering mid-swing restarts it, as a click should. */
  swing(): void {
    this.swingRemaining = SWING_SECONDS;
  }

  /**
   * Replaces the model when the equipped item changes.
   *
   * Keyed on the item id so holding down a mine on the same block does not
   * rebuild geometry sixty times a second.
   */
  setItem(view: HeldItemView | null): void {
    if (this.disposed) return;
    const key = view === null ? null : view.item;
    if (key === this.current) return;
    this.current = key;

    this.clearModel();
    if (view === null) return;

    if (view.block !== null) this.buildBlock(view.block);
    else this.buildItem(view);
  }

  /**
   * Draws the hand over the finished world frame.
   *
   * `autoClear` is disabled and only depth is cleared, so the colour buffer
   * keeps the world behind the item.
   */
  render(renderer: THREE.WebGLRenderer, dt: number): void {
    if (this.disposed || this.current === null) return;

    if (this.swingRemaining > 0) {
      this.swingRemaining = Math.max(0, this.swingRemaining - dt);
    }
    this.applyPose();

    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearModel();
    this.scene.clear();
  }

  // ------------------------------------------------------------------ private

  /**
   * Swings along an arc that dips out of view and back.
   *
   * A single sine over the swing gives the rise and fall for free, and keeps
   * the rest pose exactly where the arc begins and ends.
   */
  private applyPose(): void {
    const progress = 1 - this.swingRemaining / SWING_SECONDS;
    const arc = this.swingRemaining > 0 ? Math.sin(progress * Math.PI) : 0;

    this.pivot.position.set(
      REST_X - arc * 0.1,
      REST_Y - arc * 0.22,
      REST_Z + arc * 0.16,
    );
    this.pivot.rotation.set(-arc * 1.35, -0.42 + arc * 0.3, 0.22 - arc * 0.35);
  }

  private clearModel(): void {
    this.pivot.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  /**
   * A held block is a shrunken world cube, textured from the same array the
   * terrain uses, so it is unmistakably the block that will be placed.
   */
  private buildBlock(block: number): void {
    const textures = BlockRegistry.get(block).textures;
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    // BoxGeometry emits its faces in +X, -X, +Y, -Y, +Z, -Z order — the same
    // order `FaceTextures` uses — with four vertices each.
    const vertexCount = geometry.attributes.position.count;
    const layers = new Float32Array(vertexCount);
    const lights = new Float32Array(vertexCount);
    for (let face = 0; face < 6; face++) {
      for (let corner = 0; corner < 4; corner++) {
        const index = face * 4 + corner;
        if (index >= vertexCount) break;
        layers[index] = textures[face];
        lights[index] = FACE_SHADE[face];
      }
    }

    geometry.setAttribute('aUv', geometry.attributes.uv);
    geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
    geometry.setAttribute('aLight', new THREE.BufferAttribute(lights, 1));
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');

    const material = this.createBlockMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(0.34);
    mesh.rotation.set(0, -0.5, 0);

    this.geometries.push(geometry);
    this.materials.push(material);
    this.pivot.add(mesh);
  }

  private buildItem(view: HeldItemView): void {
    const model: HeldItemModel =
      view.tool === null
        ? heldGenericModel(view.colour)
        : heldToolModel(view.tool, materialOf(view.item));

    for (const part of model.parts) {
      const geometry = new THREE.BoxGeometry(part.sizeX, part.sizeY, part.sizeZ);
      const material = this.createItemMaterial(part.colour ?? model.tint);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(part.offsetX, part.offsetY, part.offsetZ);

      this.geometries.push(geometry);
      this.materials.push(material);
      this.pivot.add(mesh);
    }

    // Tools read as held rather than floating when tipped away from the eye.
    this.pivot.scale.setScalar(0.9);
  }

  private createBlockMaterial(): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BLOCK_VERTEX_SHADER,
      fragmentShader: BLOCK_FRAGMENT_SHADER,
      uniforms: {
        uAtlas: { value: this.atlas },
        uDaylight: { value: this.daylight },
      },
    });
  }

  private createItemMaterial(colour: number): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(colour) },
        uDaylight: { value: this.daylight },
      },
    });
  }
}

/** Reads the tier prefix out of a tool item id, e.g. `item:iron-pickaxe`. */
function materialOf(item: string): string {
  const raw = item.slice(item.indexOf(':') + 1);
  const separator = raw.indexOf('-');
  return separator < 0 ? 'iron' : raw.slice(0, separator);
}

const BLOCK_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 aUv;
in float aLayer;
in float aLight;

out vec2 vUv;
flat out int vLayer;
out float vLight;

void main() {
  vUv = aUv;
  vLayer = int(aLayer + 0.5);
  vLight = aLight;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLOCK_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uDaylight;

in vec2 vUv;
flat in int vLayer;
in float vLight;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vec3(vUv, float(vLayer)));
  if (texel.a < 0.5) discard;
  fragColor = vec4(texel.rgb * vLight * uDaylight, 1.0);
}
`;
