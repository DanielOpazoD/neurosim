/**
 * Cliente de render con política latest-wins y fallback síncrono.
 * La capa no conoce canvas ni elementos de interfaz.
 */
import { logError } from '../core/errorLog';
import { renderCase, renderRequest, type RenderRequest, type RenderResponse } from './renderRequest';

export interface RenderClientLike {
  request(request: RenderRequest): Promise<RenderResponse>;
  /** Solicitudes que pueden estar en vuelo a la vez sin reemplazarse. */
  readonly capacity: number;
  /** Huecos libres ahora mismo (0 → una nueva solicitud reemplazaría otra). */
  readonly idle: number;
}

export interface RenderWorkerLike {
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  postMessage(request: RenderRequest, transfer?: Transferable[]): void;
}

export class SyncRenderClient implements RenderClientLike {
  readonly capacity = 1;
  readonly idle = 1;
  request(request: RenderRequest): Promise<RenderResponse> {
    return Promise.resolve(
      renderRequest(request, renderCase(request.seed, request.willisVariant, request.caseId)),
    );
  }
}

export class SupersededRenderRequest extends Error {}

interface Pending {
  request: RenderRequest;
  resolve: (response: RenderResponse) => void;
  reject: (error: unknown) => void;
  superseded?: boolean;
}

export class RenderClient implements RenderClientLike {
  private worker: RenderWorkerLike | null;
  private active: Pending | null = null;
  private queued: Pending | null = null;
  private readonly sync = new SyncRenderClient();

  readonly capacity = 1;
  get idle(): number {
    return this.active ? 0 : 1;
  }

  constructor(worker: RenderWorkerLike) {
    this.worker = worker;
    worker.onmessage = (event) => this.complete(event.data);
    worker.onerror = (event) => this.workerFailed(event);
  }

  request(request: RenderRequest): Promise<RenderResponse> {
    return new Promise<RenderResponse>((resolve, reject) => {
      const pending = { request, resolve, reject };
      if (this.active) {
        this.active.superseded = true;
        this.active.reject(new SupersededRenderRequest('render reemplazado por una solicitud más reciente'));
        this.queued?.reject(new SupersededRenderRequest('render reemplazado por una solicitud más reciente'));
        this.queued = pending;
      } else {
        this.dispatch(pending);
      }
    });
  }

  private dispatch(pending: Pending): void {
    this.active = pending;
    if (!this.worker) {
      this.sync
        .request(pending.request)
        .then((response) => this.complete(response))
        .catch((error) => this.workerFailed(error));
      return;
    }
    try {
      this.worker.postMessage(pending.request);
    } catch (error) {
      this.workerFailed(error);
    }
  }

  private complete(response: RenderResponse): void {
    if (!this.active || response.id !== this.active.request.id) return;
    const pending = this.active;
    this.active = null;
    if (!pending.superseded) pending.resolve(response);
    if (this.queued) {
      const queued = this.queued;
      this.queued = null;
      this.dispatch(queued);
    }
  }

  private workerFailed(error: unknown): void {
    logError('worker', error);
    const active = this.active;
    this.active = null;
    this.worker = null;
    active?.reject(error);
    if (this.queued) {
      const queued = this.queued;
      this.queued = null;
      this.dispatch(queued);
    }
  }
}

/**
 * Canalización de render (DEC-54): N workers independientes, cada uno con
 * una solicitud en vuelo como máximo. Mientras se dibuja la respuesta de uno
 * el otro ya calcula el fotograma siguiente, así los fps dejan de estar
 * acotados por 1/(render + transferencia + dibujo). Cada worker es un
 * `RenderClient` (con su caché de casos y su fallback síncrono).
 */
export class RenderPool implements RenderClientLike {
  private readonly slots: { client: RenderClientLike; pending: number }[];

  constructor(clients: readonly RenderClientLike[]) {
    if (clients.length === 0) throw new Error('RenderPool sin clientes');
    this.slots = clients.map((client) => ({ client, pending: 0 }));
  }

  get capacity(): number {
    return this.slots.length;
  }

  get idle(): number {
    return this.slots.filter((slot) => slot.pending === 0).length;
  }

  request(request: RenderRequest): Promise<RenderResponse> {
    // Sin hueco libre se recurre al primero (política latest-wins del cliente).
    const slot = this.slots.find((candidate) => candidate.pending === 0) ?? this.slots[0]!;
    slot.pending += 1;
    const done = (): void => {
      slot.pending -= 1;
    };
    const promise = slot.client.request(request);
    promise.then(done, done);
    return promise;
  }
}
