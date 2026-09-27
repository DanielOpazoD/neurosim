/**
 * Mediciones y conversiones de coordenadas de imagen.
 * La capa no dibuja: devuelve puntos y registra medidas en el estado.
 */
import { fromEyeLocal, nerveCenterline } from '../anatomy/eye';
import { add, scale } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import { recordDistance, type ImagePoint } from '../domain/measure';
import { ANATOMIA_OJO } from '../anatomy/params';
import { beamDirAt, LINEAR_APERTURE_MM, patientToImage, type ScanGeometry } from '../ultrasound/probe';
import { currentPose } from './poses';
import type { AppState } from './state';
import { addProtocolMeasurement, nextSlot, planeForRotation } from '../domain/onsdProtocol';

export function canvasToImagePoint(
  x: number,
  y: number,
  s: AppState,
  width: number,
  height: number,
): ImagePoint {
  if (s.settings.transducer === 'linear') {
    return { u: (x / width - 0.5) * LINEAR_APERTURE_MM, z: (y / height) * s.settings.depthMm };
  }
  const scalePx = Math.min(height * 1.15, Math.hypot(width / 2, height)) / s.settings.depthMm;
  return { u: Math.atan2(x - width / 2, y), z: Math.hypot(x - width / 2, y) / scalePx };
}

export function imagePointToCanvas(
  p: ImagePoint,
  s: AppState,
  width: number,
  height: number,
): [number, number] {
  if (s.settings.transducer === 'linear') {
    return [(p.u / LINEAR_APERTURE_MM + 0.5) * width, (p.z / s.settings.depthMm) * height];
  }
  const scalePx = Math.min(height * 1.15, Math.hypot(width / 2, height)) / s.settings.depthMm;
  return [width / 2 + Math.sin(p.u) * p.z * scalePx, Math.cos(p.u) * p.z * scalePx];
}

export function addCaliperPoint(sim: ReferenceCase, s: AppState, point: ImagePoint): void {
  if (s.caliperMode === 'none' || !s.currentFrame) return;
  s.caliperPts.push(point);
  if (s.caliperPts.length !== 2) return;
  const mode = s.caliperMode;
  const m = recordDistance(s.currentFrame, s.side, s.caliperPts[0]!, s.caliperPts[1]!, {
    kind: mode === 'dvno' ? 'dvno' : mode === 'dte' ? 'dte' : 'distancia',
    convention: mode === 'dvno' ? 'interno' : undefined,
    referenceOffsetMm: mode === 'dvno' ? ANATOMIA_OJO.params.onsdOffsetMm.value : undefined,
  });
  s.measurements.push(m);
  if (mode === 'dvno' && s.onsdActive) {
    const slot = nextSlot(s.onsd);
    if (slot && slot.side === s.side && slot.plane === planeForRotation(s.rotDeg)) {
      s.onsd = addProtocolMeasurement(s.onsd, slot, m);
      const upcoming = nextSlot(s.onsd);
      if (upcoming) {
        s.side = upcoming.side;
        s.rotDeg = upcoming.plane === 'sagital' ? 90 : 0;
      } else {
        s.caliperMode = 'dte';
        s.side = s.onsd.dte.der ? 'izq' : 'der';
        s.rotDeg = 0;
      }
    } else {
      s.onsdWarning = true;
    }
  } else if (mode === 'dte' && s.onsdActive) {
    s.onsd = { ...s.onsd, dte: { ...s.onsd.dte, [s.side]: m } };
    const nextSide = s.onsd.dte.der ? (s.onsd.dte.izq ? null : 'izq') : 'der';
    if (nextSide) s.side = nextSide;
    else s.caliperMode = 'none';
  }
  s.caliperPts = [];
}

export function gatePoint(s: AppState, pose: ReturnType<typeof currentPose>, scan: ScanGeometry): ImagePoint {
  const beamDir = beamDirAt(pose, scan.kind, s.gateUMm);
  const center = add(pose.origin, scale(beamDir, s.gateDepthMm));
  return patientToImage(pose, scan.kind, center);
}

export function dvnoGuide(sim: ReferenceCase, s: AppState): ImagePoint {
  const eye = sim.eyes[s.side];
  return patientToImage(
    currentPose(sim, s),
    'linear',
    fromEyeLocal(eye, nerveCenterline(eye, ANATOMIA_OJO.params.onsdOffsetMm.value)),
  );
}

export function dteGuide(sim: ReferenceCase, s: AppState): [ImagePoint, ImagePoint] {
  const eye = sim.eyes[s.side];
  const pose = currentPose(sim, { ...s, rotDeg: 0 });
  const a = fromEyeLocal(eye, [-eye.globeRadiusMm, 0, 0]);
  const b = fromEyeLocal(eye, [eye.globeRadiusMm, 0, 0]);
  return [patientToImage(pose, 'linear', a), patientToImage(pose, 'linear', b)];
}
