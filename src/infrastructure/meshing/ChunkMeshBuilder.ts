import {
  PADDED_SIZE,
  paddedIndex,
  type ChunkMeshData,
  type MeshGeometry,
} from '@application/ports/ChunkMesher';
import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '@domain/world/WorldConstants';

/**
 * Face geometry, defined once in a basis so every derived quantity — vertex
 * positions, UVs and ambient-occlusion samples — is generated from the same
 * three vectors. Hand-writing 24 vertices per face is where winding bugs
 * (invisible or inside-out faces) come from.
 *
 * `origin` is the corner of the unit cube at face-space (0,0); `right` and
 * `up` span the face such that the winding origin -> right -> right+up -> up
 * is counter-clockwise when viewed from outside the block.
 */
interface FaceDefinition {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly ux: number;
  readonly uy: number;
  readonly uz: number;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  /** Directional shading, standing in for a light model. */
  readonly shade: number;
}

const FACES: readonly FaceDefinition[] = [
  // +X
  { nx: 1, ny: 0, nz: 0, rx: 0, ry: 0, rz: -1, ux: 0, uy: 1, uz: 0, ox: 1, oy: 0, oz: 1, shade: 0.74 },
  // -X
  { nx: -1, ny: 0, nz: 0, rx: 0, ry: 0, rz: 1, ux: 0, uy: 1, uz: 0, ox: 0, oy: 0, oz: 0, shade: 0.74 },
  // +Y
  { nx: 0, ny: 1, nz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 0, uz: -1, ox: 0, oy: 1, oz: 1, shade: 1.0 },
  // -Y
  { nx: 0, ny: -1, nz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 0, uz: 1, ox: 0, oy: 0, oz: 0, shade: 0.5 },
  // +Z
  { nx: 0, ny: 0, nz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, ox: 0, oy: 0, oz: 1, shade: 0.88 },
  // -Z
  { nx: 0, ny: 0, nz: -1, rx: -1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, ox: 1, oy: 0, oz: 0, shade: 0.88 },
];

/** Face-space corners in winding order. */
const CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Brightness for ambient-occlusion levels 0 (most occluded) to 3 (open). */
const AO_LEVELS = [0.45, 0.63, 0.81, 1.0] as const;

/** Growable typed-array-backed geometry accumulator. */
class GeometryBuffer {
  private positions: number[] = [];
  private uvs: number[] = [];
  private layers: number[] = [];
  private lights: number[] = [];
  private indices: number[] = [];
  private vertexCount = 0;

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  addQuad(
    positions: readonly number[],
    uvs: readonly number[],
    layer: number,
    lights: readonly number[],
  ): void {
    const base = this.vertexCount;

    for (let i = 0; i < 12; i++) this.positions.push(positions[i]);
    for (let i = 0; i < 8; i++) this.uvs.push(uvs[i]);
    for (let i = 0; i < 4; i++) {
      this.layers.push(layer);
      this.lights.push(lights[i]);
    }
    this.vertexCount += 4;

    // Split the quad along the darker diagonal. Using a fixed diagonal makes
    // ambient occlusion visibly warp across the seam on unevenly lit quads.
    if (lights[0] + lights[2] > lights[1] + lights[3]) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  build(): MeshGeometry | null {
    if (this.indices.length === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      layers: new Float32Array(this.layers),
      lights: new Float32Array(this.lights),
      indices:
        this.vertexCount > 65535
          ? new Uint32Array(this.indices)
          : new Uint16Array(this.indices),
    };
  }
}

function sample(volume: Uint8Array, px: number, y: number, pz: number): number {
  if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
  if (px < 0 || px >= PADDED_SIZE || pz < 0 || pz >= PADDED_SIZE) return BlockId.Air;
  return volume[paddedIndex(px, y, pz)];
}

/**
 * A face is drawn when the block beyond it does not fully hide it.
 * Identical translucent blocks hide each other so a body of water is a shell
 * rather than a stack of overlapping surfaces.
 */
function isFaceVisible(self: number, neighbour: number): boolean {
  if (neighbour === BlockId.Air) return true;
  if (BlockRegistry.isOpaque(neighbour)) return false;
  return neighbour !== self;
}

/**
 * Classic three-sample vertex occlusion: a corner is darkened by the two
 * edge-adjacent blocks and the diagonal one. Two adjacent edges fully enclose
 * the corner, so the diagonal cannot lighten it.
 */
function vertexOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
}

/**
 * Builds renderable geometry for one chunk from a padded voxel volume.
 *
 * Pure and self-contained: no world access, no graphics API, no shared state.
 * That is what allows it to run unchanged on the main thread or in a worker,
 * and to be unit-tested directly.
 */
export function buildChunkMesh(volume: Uint8Array): ChunkMeshData {
  const opaque = new GeometryBuffer();
  const transparent = new GeometryBuffer();

  const quadPositions = new Array<number>(12);
  const quadUvs = new Array<number>(8);
  const quadLights = new Array<number>(4);

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const px = x + 1;
        const pz = z + 1;
        const block = volume[paddedIndex(px, y, pz)];
        if (block === BlockId.Air) continue;

        const definition = BlockRegistry.get(block);
        const target = definition.translucent ? transparent : opaque;
        // Flat blocks like rails occupy a fraction of their cell. Only
        // pass-through blocks may be short, so collision stays whole-voxel.
        const flattenTo = definition.renderHeight === 1 ? 0 : definition.renderHeight;

        for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
          const face = FACES[faceIndex];
          const neighbour = sample(volume, px + face.nx, y + face.ny, pz + face.nz);
          if (!isFaceVisible(block, neighbour)) continue;

          for (let corner = 0; corner < 4; corner++) {
            const [a, b] = CORNERS[corner];
            const signR = a === 1 ? 1 : -1;
            const signU = b === 1 ? 1 : -1;

            // Ambient occlusion samples sit in the plane one step outside the
            // face, offset toward this corner.
            const side1 = BlockRegistry.isOpaque(
              sample(
                volume,
                px + face.nx + face.rx * signR,
                y + face.ny + face.ry * signR,
                pz + face.nz + face.rz * signR,
              ),
            );
            const side2 = BlockRegistry.isOpaque(
              sample(
                volume,
                px + face.nx + face.ux * signU,
                y + face.ny + face.uy * signU,
                pz + face.nz + face.uz * signU,
              ),
            );
            const diagonal = BlockRegistry.isOpaque(
              sample(
                volume,
                px + face.nx + face.rx * signR + face.ux * signU,
                y + face.ny + face.ry * signR + face.uy * signU,
                pz + face.nz + face.rz * signR + face.uz * signU,
              ),
            );

            const offset = corner * 3;
            quadPositions[offset] = x + face.ox + face.rx * a + face.ux * b;
            quadPositions[offset + 1] = y + face.oy + face.ry * a + face.uy * b;
            quadPositions[offset + 2] = z + face.oz + face.rz * a + face.uz * b;

            // V is flipped because texture row 0 is the top of the source image.
            quadUvs[corner * 2] = a;
            quadUvs[corner * 2 + 1] = 1 - b;

            quadLights[corner] =
              face.shade * AO_LEVELS[vertexOcclusion(side1, side2, diagonal)];
          }

          // Squashing afterwards, and only for the rare short block, keeps the
          // per-vertex arithmetic above free of a multiply that every one of the
          // hundreds of thousands of vertices in a chunk would otherwise pay.
          if (flattenTo !== 0) {
            for (let corner = 0; corner < 4; corner++) {
              const index = corner * 3 + 1;
              quadPositions[index] = y + (quadPositions[index] - y) * flattenTo;
            }
          }

          target.addQuad(quadPositions, quadUvs, definition.textures[faceIndex], quadLights);
        }
      }
    }
  }

  return { opaque: opaque.build(), transparent: transparent.build() };
}

/** Buffers to hand to `postMessage` as transferables. */
export function collectTransferables(data: ChunkMeshData): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const geometry of [data.opaque, data.transparent]) {
    if (geometry === null) continue;
    buffers.push(
      geometry.positions.buffer as ArrayBuffer,
      geometry.uvs.buffer as ArrayBuffer,
      geometry.layers.buffer as ArrayBuffer,
      geometry.lights.buffer as ArrayBuffer,
      geometry.indices.buffer as ArrayBuffer,
    );
  }
  return buffers;
}
