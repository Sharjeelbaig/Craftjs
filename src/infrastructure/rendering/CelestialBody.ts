import * as THREE from 'three';

/**
 * The sun or the moon.
 *
 * A flat camera-facing quad rather than a sphere: at this distance a lit
 * sphere is indistinguishable from a disc, and the disc costs two triangles
 * and no lighting. Size is expressed as a fraction of orbit distance so the
 * body keeps a constant apparent size when the render distance changes.
 */
export class CelestialBody {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly angularSize: number;

  constructor(scene: THREE.Scene, angularSize: number, color: THREE.Color) {
    this.angularSize = angularSize;

    const geometry = new THREE.PlaneGeometry(1, 1);
    // Opaque on purpose. A transparent disc lands in three's transparent pass,
    // which runs after all terrain, so it would hang in front of the world.
    // Opaque keeps it depth-sorted against the ground, and writing depth lets
    // it occlude the stars behind it.
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    // After the dome, before the terrain: the sky is a backdrop, and the
    // horizon must still cover the sun as it sets.
    this.mesh.renderOrder = -999;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setPosition(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  setScale(orbitRadius: number): void {
    this.mesh.scale.setScalar(this.angularSize * orbitRadius);
  }

  setVisibility(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Keeps the disc square-on to the viewer. */
  faceCamera(camera: THREE.Camera): void {
    this.mesh.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
