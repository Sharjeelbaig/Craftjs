import * as THREE from 'three';
import type { Vec3Like } from '@domain/shared/Vec3';

/**
 * The gradient backdrop.
 *
 * A unit sphere scaled to the camera's far plane each frame rather than a
 * fixed-radius one: the render distance changes at runtime, and a dome sized
 * for the wrong distance is either clipped away entirely or buried inside the
 * terrain.
 */
export class SkyDome {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(1, 24, 16);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        zenithColor: { value: new THREE.Color(0x4d7ba8) },
        horizonColor: { value: new THREE.Color(0x8fc4ea) },
      },
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 zenithColor;
        uniform vec3 horizonColor;
        varying vec3 vPosition;
        void main() {
          // Biased towards the horizon so the gradient reads as atmosphere
          // rather than a linear wash from pole to pole.
          float h = normalize(vPosition).y;
          float t = pow(clamp(h, 0.0, 1.0), 0.55);
          gl_FragColor = vec4(mix(horizonColor, zenithColor, t), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    // Drawn before everything else, with no depth write, so it can never
    // occlude terrain regardless of where the far plane lands.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setColors(zenith: THREE.Color, horizon: THREE.Color): void {
    (this.material.uniforms.zenithColor.value as THREE.Color).copy(zenith);
    (this.material.uniforms.horizonColor.value as THREE.Color).copy(horizon);
  }

  setPosition(camera: Vec3Like, radius: number): void {
    this.mesh.position.set(camera.x, camera.y, camera.z);
    this.mesh.scale.setScalar(radius);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
