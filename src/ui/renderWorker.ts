/**
 * Entry del Web Worker de render.
 * Delega la física a app/renderRequest y transfiere los buffers al hilo UI.
 */
import { renderCase, renderRequest, type RenderRequest, type RenderResponse } from '../app/renderRequest';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(response: RenderResponse, transfer: Transferable[]): void;
};

workerScope.onmessage = (event) => {
  const response = renderRequest(event.data, renderCase(event.data.seed));
  const transfer: Transferable[] = [response.bmode.db.buffer];
  if (response.color) {
    transfer.push(response.color.vel.buffer, response.color.pow.buffer);
  }
  workerScope.postMessage(response, transfer);
};
