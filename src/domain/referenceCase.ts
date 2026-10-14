/**
 * Caso de referencia N1 (plan §2.4): paciente adulto, semilla fija, DVNO
 * interno 4,6/4,7 mm, fisiología basal, ventana temporal utilizable.
 * El caso se deriva de la semilla + el manifiesto; reproducible por
 * construcción.
 */
import { SeededRandom } from '../core/random';
import type { PatientState, WillisVariant } from './contracts';
import { MANIFEST } from './manifest';
import { buildReferenceEyes, type EyeGeometry } from '../anatomy/eye';
import { buildReferenceHead, type HeadGeometry } from '../anatomy/head';
import { buildReferenceNecks, type NeckGeometry } from '../anatomy/neck';
import { CardiacCycle, CerebralFlow } from '../physiology/flow';
import type { PhysState } from '../physiology/flow';
import { Respiration } from '../physiology/respiration';
import { FISIOLOGIA } from '../physiology/params';
import type { BasalPhysiology } from './contracts';
import type { Side } from './contracts';
import { onsdForIcpMm } from '../physiology/hemodynamics';
import { RegulationDynamics } from '../physiology/dynamics';
import { IntracranialCompartment } from '../physiology/compartment';
import type { ClinicalCase } from './cases';
import { caseById } from './cases';

export interface ReferenceCase {
  readonly patient: PatientState;
  readonly eyes: Record<Side, EyeGeometry>;
  readonly head: HeadGeometry;
  /**
   * Escena submandibular por lado (DEC-58): ACI cervical distal con el caudal
   * de Willis ipsilateral, ACE, yugular interna, glándula y mandíbula.
   */
  readonly neck: Record<Side, NeckGeometry>;
  readonly cardiac: CardiacCycle;
  readonly respiration: Respiration;
  readonly flow: CerebralFlow;
  readonly willisVariant: WillisVariant;
  /** Caso clínico activo (parámetros estáticos; ver src/domain/cases.ts). */
  readonly clinicalCase: ClinicalCase;
  readonly physStateAt: (t: number) => PhysState;
  /** Sin `atS` el cambio es instantáneo; con `atS` la regulación relaja desde ese instante (DEC-81). */
  readonly setPhysiology: (p: BasalPhysiology, atS?: number) => void;
  readonly regulation: RegulationDynamics;
  /** Compartimento intracraneal (DEC-82): la PIC emerge del volumen añadido. */
  readonly compartment: IntracranialCompartment;
  /** Escalón del volumen de lesión/drenaje (mL) en `atS`; la PIC se deriva y se sincroniza con `syncIcp`. */
  readonly setLesionVolume: (lesionVolumeMl: number, atS: number) => void;
  /**
   * Lleva `physiology.icpMmHg` a la PIC emergente en `t` (cuantizada a
   * `stepMmHg`) y devuelve true si cambió. Llamar desde el bucle de la UI.
   */
  readonly syncIcp: (t: number, stepMmHg?: number) => boolean;
  /** Revisión local del estado fisiológico, también al cambiar y volver al valor previo. */
  readonly physiologyRevision: number;
  /** Verdades del modelo medibles en pantalla (docencia). */
  readonly truths: {
    readonly thirdVentricleWidthMm: number;
    readonly midlineShiftMm: number;
  };
}

/** Semilla fija del adulto de referencia N1. */
export const REFERENCE_SEED = 0x0c12ab;

export function buildReferenceCase(
  seed: number = REFERENCE_SEED,
  willisVariant: WillisVariant = 'normal',
  clinicalCase?: ClinicalCase,
): ReferenceCase {
  const cc = clinicalCase ?? caseById('normal');
  const rng = new SeededRandom(seed);
  let physiology: BasalPhysiology = { ...MANIFEST.case.physiology, ...cc.physiology };
  const patient: PatientState = {
    seed,
    manifestVersion: MANIFEST.version,
    label: MANIFEST.case.label,
    physiology,
  };
  const eyesFor = (dvno: Readonly<Record<Side, number>>) =>
    buildReferenceEyes(new SeededRandom(seed).fork('eyes'), dvno);
  const eyes = eyesFor(MANIFEST.case.dvnoIntMm);
  rng.fork('eyes');
  const head = buildReferenceHead(
    rng.fork('head'),
    willisVariant,
    cc.vesselRadiusScale,
    cc.window,
    cc.snAreaCm2Scale ?? 1,
    cc.vesselStenosis ?? {},
    {
      midlineShiftMm: cc.midlineShiftMm,
      thirdVentricleWidthMm: cc.thirdVentricleWidthMm,
      frontalHornScale: cc.frontalHornScale,
    },
  );
  const neck = buildReferenceNecks(head.vessels);
  const respiration = new Respiration(FISIOLOGIA.params.respiratoryRatePerMin.value);
  const cardiac = new CardiacCycle(physiology.heartRateBpm, seed, respiration);
  const flow = new CerebralFlow(head, physiology);
  const regulation = new RegulationDynamics(physiology, cc.autoregulation ?? 'conservada');
  let compartment = IntracranialCompartment.steadyForIcp(physiology.icpMmHg);
  let physiologyRevision = 0;
  let syncingIcp = false;
  const physStateAt = (t: number): PhysState => ({
    t,
    cardiacPhase: cardiac.phaseAt(t),
    heartRateBpm: physiology.heartRateBpm,
    respiratoryPhase: respiration.phaseAt(t),
    flowModulation: 1 + FISIOLOGIA.params.respFlowModulation.value * respiration.signalAt(t),
    hemo: regulation.hemodynamicsAt(t),
  });
  const setPhysiology = (next: BasalPhysiology, atS?: number): void => {
    if (
      Object.keys(physiology).some(
        (key) => physiology[key as keyof BasalPhysiology] !== next[key as keyof BasalPhysiology],
      )
    )
      physiologyRevision += 1;
    // Una PIC impuesta desde fuera (caso, URL, worker, pruebas) recoloca el
    // compartimento en su estado estacionario; `syncIcp` no lo toca.
    if (!syncingIcp && next.icpMmHg !== physiology.icpMmHg) {
      compartment = IntracranialCompartment.steadyForIcp(next.icpMmHg);
      if (atS !== undefined) compartment.advanceTo(atS);
    }
    physiology = { ...next };
    patient.physiology = physiology;
    regulation.setTarget(physiology, atS);
    const dvno = {
      der: onsdForIcpMm(MANIFEST.case.dvnoIntMm.der, physiology.icpMmHg),
      izq: onsdForIcpMm(MANIFEST.case.dvnoIntMm.izq, physiology.icpMmHg),
    };
    const nextEyes = eyesFor(dvno);
    eyes.der = nextEyes.der;
    eyes.izq = nextEyes.izq;
  };
  const setLesionVolume = (lesionVolumeMl: number, atS: number): void => {
    compartment.setLesionVolume(lesionVolumeMl, atS);
    syncIcp(atS);
  };
  const syncIcp = (t: number, stepMmHg = 0.5): boolean => {
    compartment.advanceTo(t);
    const icp = Math.round(compartment.icpAt(t) / stepMmHg) * stepMmHg;
    if (Math.abs(icp - physiology.icpMmHg) < stepMmHg / 2) return false;
    syncingIcp = true;
    try {
      setPhysiology({ ...physiology, icpMmHg: icp }, t);
    } finally {
      syncingIcp = false;
    }
    return true;
  };
  setPhysiology(physiology);
  return {
    patient,
    eyes,
    head,
    neck,
    cardiac,
    respiration,
    flow,
    willisVariant,
    clinicalCase: cc,
    physStateAt,
    setPhysiology,
    regulation,
    get compartment() {
      return compartment;
    },
    setLesionVolume,
    syncIcp,
    get physiologyRevision() {
      return physiologyRevision;
    },
    truths: {
      thirdVentricleWidthMm: head.thirdVentricleWidthMm,
      midlineShiftMm: head.midlineShiftMm,
    },
  };
}
