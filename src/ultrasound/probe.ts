/**
 * Geometría de sondas y líneas de haz.
 *
 * - `linear`: orígenes distribuidos sobre la abertura, direcciones paralelas a
 *   `pose.forward`. El plano de imagen contiene `lateral` y `forward`.
 * - `sector`: orígenes comunes en la cara de la sonda, direcciones en abanico
 *   dentro del plano (lateral × forward) — para la ventana transtemporal.
 *
 * Una definición común sirve a imagen, escala, calipers, color y PW: la misma
 * geometría resuelve qué intersecta cada línea.
 */
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/vec3';
import type { LineDensity, ProbePose, TransducerKind } from '../domain/contracts';

export interface BeamLine {
  readonly origin: Vec3;
  readonly dir: Vec3;
  /** Coordenada lateral: mm desde el centro (lineal) o rad desde el centro (sector). */
  readonly lateralCoord: number;
}

export interface ScanGeometry {
  readonly kind: TransducerKind;
  readonly lines: readonly BeamLine[];
  readonly lateralDir: Vec3;
  readonly axialDir: Vec3;
  /** Ancho lateral total (mm lineal / rad sector). */
  readonly widthMmOrRad: number;
  readonly lineCount: number;
  readonly apex: Vec3;
}

/** Apertura lateral de la sonda lineal ocular, mm. */
export const LINEAR_APERTURE_MM = 38;
/** Semiapertura angular de la sonda sectorial transcraneal, rad. */
export const SECTOR_HALF_ANGLE_RAD = (40 * Math.PI) / 180;

export function linesFor(density: LineDensity): number {
  switch (density) {
    case 'baja':
      return 128;
    case 'alta':
      return 256;
    case 'media':
      return 176;
  }
}

/** Eje elevacional (normal del plano imagen) de la pose. */
export function elevAxis(pose: ProbePose): Vec3 {
  return normalize(cross(normalize(pose.forward), pose.lateral));
}

/** Rotación de Rodrigues: gira `v` alrededor del eje unitario `k` por `a` rad. */
export function rotateAround(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kk = dot(k, v);
  const kxv = cross(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kk * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kk * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kk * (1 - c),
  ];
}

/** Dirección del haz para coordenada lateral u (mm o rad). */
export function beamDirAt(pose: ProbePose, kind: TransducerKind, u: number): Vec3 {
  const fwd = normalize(pose.forward);
  if (kind === 'linear') return fwd;
  return normalize(rotateAround(fwd, elevAxis(pose), u));
}

export function buildScan(pose: ProbePose, kind: TransducerKind, lineCount: number): ScanGeometry {
  const lat = pose.lateral;
  const fwd = normalize(pose.forward);
  const lines: BeamLine[] = [];
  if (kind === 'linear') {
    const width = LINEAR_APERTURE_MM;
    for (let i = 0; i < lineCount; i++) {
      const u = lineCount === 1 ? 0 : i / (lineCount - 1) - 0.5;
      const latC = u * width;
      lines.push({
        origin: add(pose.origin, scale(lat, latC)),
        dir: fwd,
        lateralCoord: latC,
      });
    }
    return {
      kind,
      lines,
      lateralDir: lat,
      axialDir: fwd,
      widthMmOrRad: width,
      lineCount,
      apex: pose.origin,
    };
  }
  const half = SECTOR_HALF_ANGLE_RAD;
  for (let i = 0; i < lineCount; i++) {
    const u = lineCount === 1 ? 0 : i / (lineCount - 1) - 0.5;
    const a = u * 2 * half;
    lines.push({
      origin: pose.origin,
      dir: beamDirAt(pose, 'sector', a),
      lateralCoord: a,
    });
  }
  return {
    kind,
    lines,
    lateralDir: lat,
    axialDir: fwd,
    widthMmOrRad: 2 * half,
    lineCount,
    apex: pose.origin,
  };
}

/** Punto 3D de una muestra de imagen: línea i, profundidad zMm. */
export function samplePoint(scan: ScanGeometry, lineIndex: number, zMm: number): Vec3 {
  const l = scan.lines[lineIndex]!;
  return add(l.origin, scale(l.dir, zMm));
}

/** Convierte coordenadas de imagen (u lateral mm/rad, z mm) a punto del paciente. */
export function imageToPatient(pose: ProbePose, kind: TransducerKind, u: number, zMm: number): Vec3 {
  if (kind === 'linear') {
    return add(add(pose.origin, scale(pose.lateral, u)), scale(normalize(pose.forward), zMm));
  }
  return add(pose.origin, scale(beamDirAt(pose, 'sector', u), zMm));
}

/** Coordenada lateral u de un punto del paciente respecto a la sonda. */
export function patientToImage(pose: ProbePose, kind: TransducerKind, p: Vec3): { u: number; z: number } {
  const rel = sub(p, pose.origin);
  const fwd = normalize(pose.forward);
  const z = dot(rel, fwd);
  if (kind === 'linear') return { u: dot(rel, pose.lateral), z };
  const a = Math.atan2(dot(rel, pose.lateral), Math.max(1e-9, z));
  return { u: a, z: Math.hypot(z, dot(rel, pose.lateral)) };
}
