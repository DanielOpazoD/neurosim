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
import { hemodynamics, onsdForIcpMm } from '../physiology/hemodynamics';
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
  readonly setPhysiology: (p: BasalPhysiology) => void;
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
  let currentHemo = hemodynamics(physiology);
  const physStateAt = (t: number): PhysState => ({
    t,
    cardiacPhase: cardiac.phaseAt(t),
    heartRateBpm: physiology.heartRateBpm,
    respiratoryPhase: respiration.phaseAt(t),
    flowModulation: 1 + FISIOLOGIA.params.respFlowModulation.value * respiration.signalAt(t),
    hemo: currentHemo,
  });
  const setPhysiology = (next: BasalPhysiology): void => {
    physiology = { ...next };
    patient.physiology = physiology;
    currentHemo = hemodynamics(physiology);
    const dvno = {
      der: onsdForIcpMm(MANIFEST.case.dvnoIntMm.der, physiology.icpMmHg),
      izq: onsdForIcpMm(MANIFEST.case.dvnoIntMm.izq, physiology.icpMmHg),
    };
    const nextEyes = eyesFor(dvno);
    eyes.der = nextEyes.der;
    eyes.izq = nextEyes.izq;
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
    truths: {
      thirdVentricleWidthMm: head.thirdVentricleWidthMm,
      midlineShiftMm: head.midlineShiftMm,
    },
  };
}
