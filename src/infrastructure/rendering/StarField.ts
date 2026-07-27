import * as THREE from 'three';
import type { Vec3Like } from '@domain/shared/Vec3';

const STAR_COUNT = 900;

/** Radians per second. One slow sweep, matched to the length of a night. */
const ROTATION_SPEED = 0.004;

/**
 * The night sky.
 *
 * Points on a unit sphere scaled to the camera's far plane, so the field
 * survives a render-distance change. Stars are placed with an area-preserving
 * distribution — sampling the polar angle directly would visibly bunch them at
 * the poles.
 */
export class StarField {
  private readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);

    for (let index = 0; index < STAR_COUNT; index++) {
      const theta = Math.random() * Math.PI * 2;
      // acos of a uniform value keeps the density even over the sphere.
      const phi = Math.acos(Math.random() * 2 - 1);
      const sinPhi = Math.sin(phi);

      positions[index * 3] = sinPhi * Math.cos(theta);
      positions[index * 3 + 1] = Math.cos(phi);
      positions[index * 3 + 2] = sinPhi * Math.sin(theta);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      // Screen-space size: attenuation would shrink them to nothing at the
      // distance the field actually sits.
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // Depth testing is not optional here. A transparent material is drawn in
      // three's transparent pass, which runs after all opaque geometry, so
      // renderOrder cannot put the field behind the terrain — without the test
      // the stars paint straight over the ground.
      depthTest: true,
      fog: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.renderOrder = -998;
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  setVisibility(factor: number): void {
    const opacity = factor < 0 ? 0 : factor > 1 ? 1 : factor;
    this.material.opacity = opacity;
    // Skipping the draw entirely during the day is worth the branch; a fully
    // transparent 900-point cloud still costs a pass.
    this.points.visible = opacity > 0.01;
  }

  setPosition(camera: Vec3Like, radius: number): void {
    this.points.position.set(camera.x, camera.y, camera.z);
    this.points.scale.setScalar(radius);
  }

  update(elapsedSeconds: number): void {
    if (!this.points.visible) return;
    // Derived from absolute time rather than accumulated: the field keeps its
    // place across the frames where it is skipped for being invisible.
    this.points.rotation.y = elapsedSeconds * ROTATION_SPEED;
  }

  dispose(): void {
    this.material.dispose();
    this.points.geometry.dispose();
  }
}
