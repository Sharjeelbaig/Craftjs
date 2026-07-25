/// <reference lib="webworker" />
import type { ChunkMeshData } from '@application/ports/ChunkMesher';
import { buildChunkMesh, collectTransferables } from './ChunkMeshBuilder';

export interface WorkerMeshRequest {
  readonly jobId: number;
  readonly volume: ArrayBuffer;
}

export type WorkerMeshResponse =
  | { readonly jobId: number; readonly ok: true; readonly data: ChunkMeshData }
  | { readonly jobId: number; readonly ok: false; readonly error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerMeshRequest>) => {
  const { jobId, volume } = event.data;
  try {
    const data = buildChunkMesh(new Uint8Array(volume));
    const response: WorkerMeshResponse = { jobId, ok: true, data };
    // Ownership of the geometry buffers moves to the main thread — no copy.
    scope.postMessage(response, collectTransferables(data));
  } catch (error) {
    const response: WorkerMeshResponse = {
      jobId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
};
