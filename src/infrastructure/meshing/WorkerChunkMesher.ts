import {
  PADDED_VOLUME,
  type ChunkMesher,
  type MeshRequest,
  type MeshResponse,
} from '@application/ports/ChunkMesher';
import { buildChunkMesh } from './ChunkMeshBuilder';
import type { WorkerMeshRequest, WorkerMeshResponse } from './mesher.worker';

/** Jobs each worker may hold at once — enough to hide message latency. */
const JOBS_PER_WORKER = 2;
const MAX_WORKERS = 4;

interface PendingJob {
  readonly request: MeshRequest;
  readonly resolve: (response: MeshResponse) => void;
  readonly reject: (error: unknown) => void;
}

interface WorkerSlot {
  readonly worker: Worker;
  /** Jobs dispatched to this worker and not yet answered. */
  readonly inFlight: Map<number, PendingJob>;
  healthy: boolean;
}

/**
 * Meshes chunks on a pool of workers, with a synchronous fallback.
 *
 * Meshing is the single most expensive operation in the engine; running it on
 * the main thread is what causes the hitch when terrain streams in. Workers
 * remove it from the frame entirely. If workers are unavailable — old browser,
 * blocked by CSP, construction error — the fallback keeps the game playable
 * rather than leaving the world invisible.
 */
export class WorkerChunkMesher implements ChunkMesher {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingJob[] = [];
  private nextJobId = 1;
  private nextSlot = 0;
  private disposed = false;

  constructor(workerCount = defaultWorkerCount()) {
    for (let i = 0; i < workerCount; i++) {
      const slot = this.spawn();
      if (slot !== null) this.slots.push(slot);
    }
  }

  /** Zero healthy workers means every job runs synchronously. */
  get usesWorkers(): boolean {
    return this.slots.some((slot) => slot.healthy);
  }

  get capacity(): number {
    const healthy = this.slots.filter((slot) => slot.healthy).length;
    return healthy > 0 ? healthy * JOBS_PER_WORKER : 1;
  }

  submit(request: MeshRequest): Promise<MeshResponse> {
    if (this.disposed) return Promise.reject(new Error('Mesher disposed'));

    if (!this.usesWorkers) return Promise.resolve(this.meshSynchronously(request));

    return new Promise<MeshResponse>((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.drain();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.healthy = false;
      for (const job of slot.inFlight.values()) {
        job.reject(new Error('Mesher disposed'));
      }
      slot.inFlight.clear();
      slot.worker.terminate();
    }
    this.slots.length = 0;
    for (const job of this.queue) job.reject(new Error('Mesher disposed'));
    this.queue.length = 0;
  }

  private spawn(): WorkerSlot | null {
    try {
      const worker = new Worker(new URL('./mesher.worker.ts', import.meta.url), {
        type: 'module',
        name: 'craftjs-mesher',
      });
      const slot: WorkerSlot = { worker, inFlight: new Map(), healthy: true };

      worker.onmessage = (event: MessageEvent<WorkerMeshResponse>) => {
        this.handleResponse(slot, event.data);
      };
      worker.onerror = (event) => {
        this.retireSlot(slot, event.message || 'worker error');
      };
      worker.onmessageerror = () => {
        this.retireSlot(slot, 'worker message could not be deserialised');
      };

      return slot;
    } catch {
      return null;
    }
  }

  private handleResponse(slot: WorkerSlot, message: WorkerMeshResponse): void {
    const job = slot.inFlight.get(message.jobId);
    if (job === undefined) return;
    slot.inFlight.delete(message.jobId);

    if (message.ok) {
      job.resolve({
        coord: job.request.coord,
        revision: job.request.revision,
        data: message.data,
      });
    } else {
      job.reject(new Error(message.error));
    }

    this.drain();
  }

  /**
   * A worker that failed is not trusted again: the pool shrinks and, once the
   * last one goes, `submit` falls back to synchronous meshing so the world
   * still renders.
   *
   * Jobs already dispatched are rejected rather than retried here: their
   * volume buffer was transferred to the dead worker and is now detached. The
   * streamer treats a rejection as "still stale" and resubmits with a freshly
   * built volume, which is the only correct way to recover.
   */
  private retireSlot(slot: WorkerSlot, reason: string): void {
    if (!slot.healthy) return;
    slot.healthy = false;

    const orphaned = [...slot.inFlight.values()];
    slot.inFlight.clear();
    try {
      slot.worker.terminate();
    } catch {
      /* already gone */
    }

    for (const job of orphaned) {
      job.reject(new Error(`mesher worker failed: ${reason}`));
    }

    if (this.usesWorkers) {
      this.drain();
      return;
    }

    // No workers left. Queued jobs still own their volumes, so they can be
    // completed here; everything after this goes down the synchronous path.
    console.warn(`[craftjs] mesher workers unavailable (${reason}); meshing on main thread`);
    const pending = this.queue.splice(0, this.queue.length);
    for (const job of pending) {
      try {
        job.resolve(this.meshSynchronously(job.request));
      } catch (error) {
        job.reject(error);
      }
    }
  }

  private drain(): void {
    if (this.disposed) return;

    while (this.queue.length > 0) {
      const slot = this.pickSlot();
      if (slot === null) return;

      const job = this.queue.shift();
      if (job === undefined) return;

      const jobId = this.nextJobId++;
      slot.inFlight.set(jobId, job);

      const volume = job.request.paddedVolume;
      const message: WorkerMeshRequest = { jobId, volume: volume.buffer as ArrayBuffer };
      try {
        slot.worker.postMessage(message, [volume.buffer as ArrayBuffer]);
      } catch (error) {
        slot.inFlight.delete(jobId);
        this.retireSlot(slot, error instanceof Error ? error.message : 'postMessage failed');
        return;
      }
    }
  }

  /** Least-loaded healthy worker, or null when all are saturated. */
  private pickSlot(): WorkerSlot | null {
    let best: WorkerSlot | null = null;
    const count = this.slots.length;

    for (let i = 0; i < count; i++) {
      // Start from a rotating offset so equal-load workers share evenly.
      const slot = this.slots[(this.nextSlot + i) % count];
      if (!slot.healthy || slot.inFlight.size >= JOBS_PER_WORKER) continue;
      if (best === null || slot.inFlight.size < best.inFlight.size) best = slot;
    }

    if (best !== null) this.nextSlot = (this.nextSlot + 1) % Math.max(1, count);
    return best;
  }

  private meshSynchronously(request: MeshRequest): MeshResponse {
    if (request.paddedVolume.length !== PADDED_VOLUME) {
      // The buffer was transferred away; only a fresh request can succeed.
      throw new Error('mesh volume is no longer owned by this thread');
    }
    return {
      coord: request.coord,
      revision: request.revision,
      data: buildChunkMesh(request.paddedVolume),
    };
  }
}

function defaultWorkerCount(): number {
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  // Leave headroom for the main thread; never spawn more than we can feed.
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}
