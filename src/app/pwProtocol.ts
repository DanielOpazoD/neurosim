/**
 * Protocolo del worker PW (DEC-55): tipos de mensaje y manejador puro.
 * El manejador es dueño de la `PwDopplerChain`; lo invocan el entry del
 * worker (`src/ui/pwWorker.ts`) y el fallback síncrono de `PwController`,
 * así las pruebas ejercitan la misma ruta sin Worker. No accede al DOM.
 */
import type { BasalPhysiology, Side, Station, WillisVariant } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import type { VesselScene } from '../anatomy/head';
import { PwDopplerChain, type AudioSink } from '../doppler/pwChain';
import type { GateComposition, GateGeometry } from '../doppler/sampleVolume';
import type { SpectralColumn } from '../doppler/spectral';
import { dopplerSceneFor, renderCase, samePhysiology } from './renderRequest';
import type { Vec3 } from '../core/vec3';

/** Velocidad de la sonda: siempre quieta (sin micro-movimiento de mano, DEC-59). */
const STILL_PROBE = (): Vec3 => [0, 0, 0];

/** Equipo PW que reconfigura la cadena (`PwDopplerChain.begin`). */
export interface PwEquipment {
  readonly prfHz: number;
  readonly f0Hz: number;
  readonly gainDb: number;
  readonly wallFilterHz: number;
  /** Amplitud de emisión lineal (10^(dB/20)). */
  readonly outputAmplitude: number;
}

/** Caso y escena: crea la cadena si cambia estación/lado (o el caso). */
export interface PwConfigureMessage {
  readonly type: 'configure';
  readonly configVersion: number;
  readonly seed: number;
  readonly willisVariant?: WillisVariant;
  readonly caseId?: string;
  readonly station: Station;
  readonly side: Side;
  readonly physiology?: BasalPhysiology;
}

/**
 * Geometría de la puerta y equipo. Si el equipo difiere del último aplicado
 * se llama a `begin(…, tSync)`; `tSync` es el `tStart` del próximo `step`.
 */
export interface PwSetGateMessage {
  readonly type: 'setGate';
  readonly configVersion: number;
  readonly gate: GateGeometry;
  readonly equipment: PwEquipment;
  readonly tSync: number;
  /**
   * Re-sincroniza el tiempo del espectro aunque el equipo no cambie: el
   * controlador descartó atraso (worker saturado) y el próximo `step` no
   * continúa al anterior.
   */
  readonly resync?: boolean;
}

/** Genera `dt` s de IQ desde `tStart` (subpasos ≤5 ms dentro de la cadena). */
export interface PwStepMessage {
  readonly type: 'step';
  readonly configVersion: number;
  readonly tStart: number;
  readonly dt: number;
  /** ¿Devolver el IQ filtrado para audio? */
  readonly wantAudio: boolean;
}

export interface PwResetMessage {
  readonly type: 'reset';
  readonly configVersion: number;
}

export type PwMessage = PwConfigureMessage | PwSetGateMessage | PwStepMessage | PwResetMessage;

/**
 * Respuesta a un `step`: columnas nuevas empaquetadas (transferibles), IQ
 * filtrado para el audio del hilo principal y composición de la puerta.
 */
export interface PwReply {
  readonly type: 'block';
  /** `configVersion` del último mensaje procesado antes de este bloque. */
  readonly configVersion: number;
  /** Clave estación-lado de la cadena que produjo el bloque. */
  readonly sceneKey: string;
  readonly fftSize: number;
  readonly count: number;
  /** t de cada columna (s). */
  readonly times: Float64Array;
  /** PRF de cada columna (Hz). */
  readonly prfHz: Float64Array;
  /** Potencia en dB, `count × fftSize` (columna i en [i·N, (i+1)·N)). */
  readonly power: Float32Array;
  readonly iqRe: Float32Array;
  readonly iqIm: Float32Array;
  readonly iqPrfHz: number;
  readonly composition: GateComposition | null;
}

export interface PwHandlerState {
  sim: ReferenceCase | null;
  chain: PwDopplerChain | null;
  sceneKey: string;
  caseKey: string;
  equipment: PwEquipment | null;
  configVersion: number;
  audioRe: Float32Array[];
  audioIm: Float32Array[];
  audioPrfHz: number;
  collectAudio: boolean;
}

export function createPwHandlerState(): PwHandlerState {
  return {
    sim: null,
    chain: null,
    sceneKey: '',
    caseKey: '',
    equipment: null,
    configVersion: 0,
    audioRe: [],
    audioIm: [],
    audioPrfHz: 0,
    collectAudio: false,
  };
}

function sameEquipment(a: PwEquipment | null, b: PwEquipment): boolean {
  return (
    a !== null &&
    a.prfHz === b.prfHz &&
    a.f0Hz === b.f0Hz &&
    a.gainDb === b.gainDb &&
    a.wallFilterHz === b.wallFilterHz &&
    Object.is(a.outputAmplitude, b.outputAmplitude)
  );
}

/** Escena vascular del Doppler para una estación (igual que la app). */
export function pwDopplerScene(sim: ReferenceCase, station: Station, side: Side): VesselScene {
  return dopplerSceneFor(sim, station, side);
}

/** Empaqueta columnas en buffers planos (se transfieren sin copia). */
export function packColumns(
  columns: readonly SpectralColumn[],
  fftSize: number,
): Pick<PwReply, 'count' | 'times' | 'prfHz' | 'power'> {
  const count = columns.length;
  const times = new Float64Array(count);
  const prfHz = new Float64Array(count);
  const power = new Float32Array(count * fftSize);
  for (let i = 0; i < count; i += 1) {
    const col = columns[i]!;
    times[i] = col.t;
    prfHz[i] = col.prfHz;
    power.set(col.powerDb.subarray(0, fftSize), i * fftSize);
  }
  return { count, times, prfHz, power };
}

/** Desempaqueta un bloque en `SpectralColumn`s (vistas sobre `power`, sin copia). */
export function unpackColumns(reply: Pick<PwReply, 'count' | 'times' | 'prfHz' | 'power' | 'fftSize'>) {
  const out: SpectralColumn[] = [];
  const N = reply.fftSize;
  for (let i = 0; i < reply.count; i += 1) {
    out.push({
      t: reply.times[i]!,
      prfHz: reply.prfHz[i]!,
      powerDb: reply.power.subarray(i * N, (i + 1) * N),
    });
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]!;
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Buffers transferibles de una respuesta. */
export function replyTransferables(reply: PwReply): Transferable[] {
  return [reply.times.buffer, reply.prfHz.buffer, reply.power.buffer, reply.iqRe.buffer, reply.iqIm.buffer];
}

/**
 * Procesa un mensaje del protocolo. Solo `step` devuelve respuesta; los
 * demás mutan el estado. Mismo orden de llamadas a la cadena que el antiguo
 * `PwController.step` (begin → setGate → step → flush), así que la salida
 * para una secuencia dada de (tStart, dt) es idéntica bit a bit.
 */
export function handlePwMessage(
  state: PwHandlerState,
  msg: PwMessage,
  resolveCase: (seed: number, variant?: WillisVariant, caseId?: string) => ReferenceCase = renderCase,
): PwReply | null {
  state.configVersion = Math.max(state.configVersion, msg.configVersion);
  switch (msg.type) {
    case 'configure': {
      const caseKey = `${msg.seed}:${msg.willisVariant ?? 'normal'}:${msg.caseId ?? ''}`;
      if (!state.sim || state.caseKey !== caseKey) {
        state.sim = resolveCase(msg.seed, msg.willisVariant, msg.caseId);
        state.caseKey = caseKey;
        state.chain = null;
      }
      const sim = state.sim;
      if (msg.physiology && !samePhysiology(msg.physiology, sim.patient.physiology)) {
        sim.setPhysiology(msg.physiology);
      }
      const sceneKey = `${msg.station}-${msg.side}`;
      if (!state.chain || state.sceneKey !== sceneKey) {
        const sink: AudioSink = {
          pushIQ: (re, im, n, prfHz) => {
            if (!state.collectAudio) return;
            state.audioRe.push(re.slice(0, n));
            state.audioIm.push(im.slice(0, n));
            state.audioPrfHz = prfHz;
          },
          reset: () => {
            state.audioRe.length = 0;
            state.audioIm.length = 0;
          },
        };
        state.chain = new PwDopplerChain(pwDopplerScene(sim, msg.station, msg.side), sim.patient.seed, sink);
        state.sceneKey = sceneKey;
        state.equipment = null;
      }
      return null;
    }
    case 'setGate': {
      const chain = state.chain;
      if (!chain) return null;
      const e = msg.equipment;
      if (msg.resync || !sameEquipment(state.equipment, e)) {
        chain.begin(e.prfHz, e.f0Hz, e.gainDb, e.wallFilterHz, msg.tSync, e.outputAmplitude);
        state.equipment = e;
      }
      chain.setGate(msg.gate);
      return null;
    }
    case 'reset': {
      state.chain?.reset();
      state.equipment = null;
      state.audioRe.length = 0;
      state.audioIm.length = 0;
      return null;
    }
    case 'step': {
      const chain = state.chain;
      const sim = state.sim;
      if (!chain || !sim || !state.equipment) return null;
      state.collectAudio = msg.wantAudio;
      // Sonda quieta: sin micro-movimiento de mano (DEC-59).
      chain.step((tt) => sim.physStateAt(tt), msg.tStart, STILL_PROBE, msg.dt);
      chain.flush();
      // Las columnas viajan al hilo principal: la cadena del worker no las guarda.
      const columns = chain.spectral.columns.splice(0);
      const packed = packColumns(columns, chain.spectral.fftSize);
      const iqRe = state.audioRe.length ? concat(state.audioRe) : new Float32Array(0);
      const iqIm = state.audioIm.length ? concat(state.audioIm) : new Float32Array(0);
      state.audioRe.length = 0;
      state.audioIm.length = 0;
      return {
        type: 'block',
        configVersion: state.configVersion,
        sceneKey: state.sceneKey,
        fftSize: chain.spectral.fftSize,
        ...packed,
        iqRe,
        iqIm,
        iqPrfHz: state.audioPrfHz || state.equipment.prfHz,
        composition: { ...chain.sampleVolume.lastComposition },
      };
    }
    default:
      return null;
  }
}
