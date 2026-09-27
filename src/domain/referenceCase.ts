/**
 * Caso de referencia N1 (plan §2.4): paciente adulto, semilla fija, DVNO
 * interno 4,6/4,7 mm, fisiología basal, ventana temporal utilizable.
 * El caso se deriva de la semilla + el manifiesto; reproducible por
 * construcción.
 */
import { SeededRandom } from '../core/random';
import type { PatientState } from './contracts';
import { MANIFEST } from './manifest';
import { buildReferenceEyes, type EyeGeometry } from '../anatomy/eye';
import { buildReferenceHead, type HeadGeometry } from '../anatomy/head';
import { CardiacCycle, CerebralFlow } from '../physiology/flow';
import type { BasalPhysiology } from './contracts';
import type { Side } from './contracts';

export interface ReferenceCase {
  readonly patient: PatientState;
  readonly eyes: Record<Side, EyeGeometry>;
  readonly head: HeadGeometry;
  readonly cardiac: CardiacCycle;
  readonly flow: CerebralFlow;
}

/** Semilla fija del adulto de referencia N1. */
export const REFERENCE_SEED = 0x0c12ab;

export function buildReferenceCase(seed: number = REFERENCE_SEED): ReferenceCase {
  const rng = new SeededRandom(seed);
  const physiology: BasalPhysiology = MANIFEST.case.physiology;
  const patient: PatientState = {
    seed,
    manifestVersion: MANIFEST.version,
    label: MANIFEST.case.label,
    physiology,
  };
  const eyes = buildReferenceEyes(rng.fork('eyes'));
  const head = buildReferenceHead(rng.fork('head'));
  const cardiac = new CardiacCycle(physiology.heartRateBpm, rng.fork('cardiac'));
  const flow = new CerebralFlow(head, physiology);
  return { patient, eyes, head, cardiac, flow };
}
