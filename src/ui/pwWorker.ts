/**
 * Entry del Web Worker PW (DEC-55): la cadena Doppler pulsado completa
 * (volumen de muestra → filtro de pared → espectro) fuera del hilo UI.
 * Delega en app/pwProtocol y transfiere columnas e IQ al hilo principal.
 */
import {
  createPwHandlerState,
  handlePwMessage,
  replyTransferables,
  type PwMessage,
  type PwReply,
} from '../app/pwProtocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PwMessage>) => void) | null;
  postMessage(reply: PwReply, transfer: Transferable[]): void;
};

const state = createPwHandlerState();

workerScope.onmessage = (event) => {
  const reply = handlePwMessage(state, event.data);
  if (reply) workerScope.postMessage(reply, replyTransferables(reply));
};
