import type { BasalPhysiology, Side, Station, TransducerKind, WillisVariant } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AppState } from './state';
import type { GateComposition } from '../doppler/sampleVolume';
import type { InsonationAngles } from '../doppler/insonation';
import { pwStatusText, type PwAssessment, type PwStatus } from '../doppler/measureMca';

/** Contexto de adquisición; la corrección angular y la inversión se aplican después al IQ. */
export interface PwAcquisitionContext {
  readonly seed: number;
  readonly caseId: string;
  readonly willisVariant: WillisVariant;
  readonly physiologyRevision: number;
  readonly physiology: Readonly<BasalPhysiology>;
  readonly station: Station;
  readonly side: Side;
  readonly modality: 'PW-con-imagen';
  readonly equipment: {
    readonly transducer: TransducerKind;
    readonly frequencyMhz: number;
    readonly prfHz: number;
    readonly wallFilterHz: number;
    readonly dopplerGainDb: number;
    readonly outputPowerDb: number;
    readonly gateMm: number;
  };
  readonly gate: { readonly uMm: number; readonly depthMm: number };
  readonly probe: {
    readonly tiltDeg: number;
    readonly tiltVDeg: number;
    readonly rotDeg: number;
    readonly offsetMm: number;
    readonly offsetVMm: number;
    readonly press: number;
  };
}

export type PwCaptureStatus = PwStatus | 'contexto-incompatible' | 'puerta-no-fiable' | 'angulo-invalido';

export interface PwCapture {
  readonly schemaVersion: 1;
  readonly context: PwAcquisitionContext;
  readonly configVersion: number;
  readonly fftSize: number;
  readonly quality: {
    readonly blocks: number;
    readonly bloodFractionMin: number | null;
    readonly dominantBloodFractionMin: number | null;
    readonly vesselIds: readonly (string | null)[];
  };
  readonly tStart: number;
  readonly tEnd: number;
  readonly correction: { readonly angleDeg: number; readonly inverted: boolean };
  readonly composition: Readonly<GateComposition> | null;
  readonly angle: Readonly<InsonationAngles> | null;
  readonly signal: PwAssessment;
  readonly status: PwCaptureStatus;
  readonly summary: PwAssessment['summary'];
}

export function pwAcquisitionContext(sim: ReferenceCase, s: AppState): PwAcquisitionContext {
  const e = s.settings;
  return {
    seed: sim.patient.seed,
    caseId: sim.clinicalCase.id,
    willisVariant: sim.willisVariant,
    physiologyRevision: sim.physiologyRevision,
    physiology: { ...sim.patient.physiology },
    station: s.station,
    side: s.side,
    modality: 'PW-con-imagen',
    equipment: {
      transducer: e.transducer,
      frequencyMhz: e.frequencyMhz,
      prfHz: e.prfHz,
      wallFilterHz: e.wallFilterHz,
      dopplerGainDb: e.dopplerGainDb,
      outputPowerDb: e.outputPowerDb,
      gateMm: e.gateMm,
    },
    gate: { uMm: s.gateUMm, depthMm: s.gateDepthMm },
    probe: {
      tiltDeg: s.tiltDeg,
      tiltVDeg: s.tiltVDeg,
      rotDeg: s.rotDeg,
      offsetMm: s.offsetMm,
      offsetVMm: s.offsetVMm,
      press: s.press,
    },
  };
}

export function samePwPatient(a: PwAcquisitionContext, b: PwAcquisitionContext): boolean {
  return (
    a.seed === b.seed &&
    a.caseId === b.caseId &&
    a.willisVariant === b.willisVariant &&
    a.physiologyRevision === b.physiologyRevision &&
    a.physiology.heartRateBpm === b.physiology.heartRateBpm &&
    a.physiology.mapMmHg === b.physiology.mapMmHg &&
    a.physiology.icpMmHg === b.physiology.icpMmHg &&
    a.physiology.paco2MmHg === b.physiology.paco2MmHg
  );
}

export type PwCaptureReport = Omit<PwCapture, 'context' | 'angle'> & {
  readonly context: Omit<PwAcquisitionContext, 'physiology'> & {
    readonly physiology?: Readonly<BasalPhysiology>;
  };
  readonly angle?: Readonly<InsonationAngles> | null;
};

/** La reproducción completa es docente; el informe del alumno no revela PIC ni ángulo real. */
export function pwCaptureReport(
  capture: PwCapture | undefined,
  teachingMode: boolean,
): PwCaptureReport | undefined {
  if (!capture) return undefined;
  return {
    ...capture,
    context: { ...capture.context, physiology: teachingMode ? capture.context.physiology : undefined },
    angle: teachingMode ? capture.angle : undefined,
  };
}

export function pwCaptureStatusText(status: PwCaptureStatus): string {
  switch (status) {
    case 'contexto-incompatible':
      return 'Cambió el contexto de adquisición: volver a adquirir PW; no reutilizar la captura anterior.';
    case 'puerta-no-fiable':
      return 'Identidad inestable o muestra insuficiente de sangre/vaso dominante: revisar puerta y ventana.';
    case 'angulo-invalido':
      return 'Ángulo no utilizable para los índices automáticos: revisar insonación y corrección.';
    default:
      return pwStatusText(status);
  }
}

export type IcaValidity =
  | 'sin-medida'
  | 'vigente'
  | 'identidad-incompatible'
  | 'contexto-incompatible'
  | 'tiempo-incompatible'
  | 'calidad-insuficiente';

export function icaValidityText(status: IcaValidity): string {
  switch (status) {
    case 'sin-medida':
      return 'Sin ACI medida; se muestra solo la referencia del caso.';
    case 'vigente':
      return 'ACI del mismo estado simulado; revisar tiempos y técnica. No implica vigencia clínica.';
    case 'identidad-incompatible':
      return 'ACI de otro lado o estación: volver a medir ACI ipsilateral.';
    case 'contexto-incompatible':
      return 'ACI de otro paciente, caso o estado fisiológico: volver a medir.';
    case 'tiempo-incompatible':
      return 'ACI posterior a la captura ACM: secuencia temporal incompatible.';
    case 'calidad-insuficiente':
      return 'ACI sin calidad válida o con un intento posterior fallido: volver a medir.';
  }
}
