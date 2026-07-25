/**
 * Read-only view of voxel space.
 *
 * Physics and raycasting depend only on this port, which keeps them testable
 * against in-memory fixtures and independent of chunk streaming.
 */
export interface VoxelQuery {
  /** Block id at world coordinates. Air outside the vertical bounds. */
  getBlock(x: number, y: number, z: number): number;

  /**
   * Collision view of the world.
   *
   * Unloaded regions report as solid so that a player can never fall through
   * terrain that has not streamed in yet.
   */
  isSolidAt(x: number, y: number, z: number): boolean;
}
