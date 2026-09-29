/**
 * Instantánea del estado para el modo guiado (DEC-56). La construye la UI
 * cada 250 ms; las comprobaciones de `domain/guides.ts` solo leen esto.
 */
import {
  fromEyeLocal,
  nerveCenterline,
  nerveSection,
  toEyeLocal,
  trueOnsdMinorMm,
  trueOnsdMm,
} from '../anatomy/eye';
import type { Measurement } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import type { GuideContext, GuideMeasurement, GuideTruth } from '../domain/guides';
import { GUIDE_ONSD_OFFSET_MM } from '../domain/guides';
import type { OnsdKey } from '../domain/onsdProtocol';
import { patientToImage } from '../ultrasound/probe';
import { currentPose } from './poses';
import type { AppState } from './state';
import type { PwController } from './pwController';

/** Metadatos de una medición tomados al registrarla (rotación del marcador). */
export interface MeasurementMeta {
  readonly rotDeg: number;
  readonly offsetMm: number;
}

/**
 * Posición lateral u (mm) en la imagen del centro del nervio a 3 mm
 * retroglobo del ojo explorado, con la pose nominal (sin temblor de mano).
 */
export function eyeNerveImageU(
  sim: ReferenceCase,
  s: Pick<
    AppState,
    'station' | 'side' | 'tiltDeg' | 'offsetMm' | 'offsetVMm' | 'tiltVDeg' | 'rotDeg' | 'press'
  >,
): number | null {
  if (s.station !== 'ojo') return null;
  const eye = sim.eyes[s.side];
  const pose = currentPose(sim, { ...s, handMotion: false });
  const center = fromEyeLocal(eye, nerveCenterline(eye, GUIDE_ONSD_OFFSET_MM));
  return patientToImage(pose, 'linear', center).u;
}

/** Distancia retroglobo media (modelo) de los puntos de una DVNO, mm. */
export function measurementRetroOffsetMm(sim: ReferenceCase, m: Measurement): number {
  if (m.kind !== 'dvno' || m.pointsMm.length === 0) return Number.NaN;
  const eye = sim.eyes[m.side];
  const values = m.pointsMm.map((p) => nerveSection(eye, toEyeLocal(eye, p)).sMm);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Verdad del modelo para el resumen: DVNO interna a 3 mm por plano. */
export function guideTruth(sim: ReferenceCase): GuideTruth {
  const perSide = (side: 'der' | 'izq') => {
    const eye = sim.eyes[side];
    const transversal = trueOnsdMm(eye, GUIDE_ONSD_OFFSET_MM, 'interno');
    // Sagital: eje menor de la sección perpendicular (DEC-57), misma
    // frontera interna que `classifyEyeLocal`.
    const sagital = trueOnsdMinorMm(eye, GUIDE_ONSD_OFFSET_MM, 'interno');
    return { transversal, sagital };
  };
  return {
    onsdMm: { der: perSide('der'), izq: perSide('izq') },
    icaTamaxCms: sim.clinicalCase.icaExtracranialTamaxCms,
    caseLabel: sim.clinicalCase.label,
  };
}

export function buildGuideContext(
  sim: ReferenceCase,
  s: AppState,
  pw: PwController,
  meta: WeakMap<Measurement, MeasurementMeta>,
): GuideContext {
  const composition = s.pwOn ? pw.composition() : null;
  const summary = pw.latestMcaMeasure();
  let insonationRealDeg: number | null = null;
  if (s.pwOn) {
    const angle = pw.insonation();
    if (angle?.vesselId && Number.isFinite(angle.realDeg)) insonationRealDeg = angle.realDeg;
  }
  const measurements: GuideMeasurement[] = s.measurements.map((m) => {
    const info = meta.get(m);
    return {
      kind: m.kind,
      value: m.value,
      side: m.side,
      referenceOffsetMm: m.referenceOffsetMm,
      offsetMm: info?.offsetMm,
      rotDeg: info?.rotDeg,
    };
  });
  const onsdSlots = Object.keys(s.onsd.dvno) as OnsdKey[];
  return {
    station: s.station,
    side: s.side,
    tiltDeg: s.tiltDeg,
    rotDeg: s.rotDeg,
    offsetMm: s.offsetMm,
    offsetVMm: s.offsetVMm,
    depthMm: s.settings.depthMm,
    gainDb: s.settings.gainDb,
    colorOn: s.colorOn,
    pwOn: s.pwOn,
    frozen: s.frozen,
    gate: {
      depthMm: s.gateDepthMm,
      uMm: s.gateUMm,
      dominantVesselId: composition?.dominantVesselId ?? null,
      bloodFraction: composition?.bloodFraction ?? 0,
    },
    insonationRealDeg,
    mca: summary
      ? {
          psvCms: summary.psvCms,
          edvCms: summary.edvCms,
          pi: summary.pi,
          taMaxCms: summary.taMaxCms,
          beats: summary.beats,
        }
      : null,
    measurements,
    onsdSlots,
    nerveImageUMm: eyeNerveImageU(sim, s),
  };
}
