import * as THREE from 'three';

/**
 * Vertex shader for voxel geometry.
 *
 * Written as a raw GLSL ES 3.00 shader: sampling a texture array needs
 * `sampler2DArray`, and declaring every input explicitly avoids depending on
 * whatever three.js injects into a `ShaderMaterial` prefix in a given release.
 */
const VERTEX_SHADER = /* glsl */ `
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
out float vDepth;

void main() {
  vUv = aUv;
  vLayer = int(aLayer + 0.5);
  vLight = aLight;

  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vDepth = -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}
`;

/**
 * Fragment shader.
 *
 * Lighting is entirely baked into `aLight` (directional face shading times
 * ambient occlusion) — no runtime lights, so shading costs one multiply and
 * stays identical no matter how many chunks are on screen.
 */
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
uniform float uAlphaTest;
uniform float uDaylight;

in vec2 vUv;
flat in int vLayer;
in float vLight;
in float vDepth;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vec3(vUv, float(vLayer)));
  if (texel.a < uAlphaTest) discard;

  // Baked lighting is scaled by the world clock, so the same geometry reads
  // as lit at noon and dim at midnight without remeshing anything.
  vec3 color = texel.rgb * vLight * uDaylight;

  // Distance fog hides the streaming boundary where chunks pop in.
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  color = mix(color, uFogColor, fog);

  fragColor = vec4(color, texel.a * uOpacity);
}
`;

export interface VoxelMaterials {
  readonly opaque: THREE.RawShaderMaterial;
  readonly transparent: THREE.RawShaderMaterial;
  setFog(color: THREE.Color, near: number, far: number): void;
  setDaylight(level: number): void;
  dispose(): void;
}

function createMaterial(
  atlas: THREE.DataArrayTexture,
  fogColor: THREE.Color,
  fogNear: number,
  fogFar: number,
  translucent: boolean,
): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uAtlas: { value: atlas },
      uFogColor: { value: fogColor.clone() },
      uFogNear: { value: fogNear },
      uFogFar: { value: fogFar },
      uOpacity: { value: 1 },
      uAlphaTest: { value: translucent ? 0.02 : 0.5 },
      uDaylight: { value: 1 },
    },
    transparent: translucent,
    // Translucent surfaces do not write depth, so water and glass behind them
    // stay visible instead of being culled by whichever quad drew first.
    depthWrite: !translucent,
    // Water must be visible from below the surface as well as above.
    side: translucent ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** Builds the shared material pair used by every chunk mesh. */
export function createVoxelMaterials(
  atlas: THREE.DataArrayTexture,
  fogColor: THREE.Color,
  fogNear: number,
  fogFar: number,
): VoxelMaterials {
  const opaque = createMaterial(atlas, fogColor, fogNear, fogFar, false);
  const transparent = createMaterial(atlas, fogColor, fogNear, fogFar, true);

  return {
    opaque,
    transparent,
    setFog(color, near, far) {
      for (const material of [opaque, transparent]) {
        (material.uniforms.uFogColor.value as THREE.Color).copy(color);
        material.uniforms.uFogNear.value = near;
        material.uniforms.uFogFar.value = far;
      }
    },
    setDaylight(level) {
      for (const material of [opaque, transparent]) {
        material.uniforms.uDaylight.value = level;
      }
    },
    dispose() {
      opaque.dispose();
      transparent.dispose();
    },
  };
}
