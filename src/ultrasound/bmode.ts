/**
 * Formación de imagen B-mode (CPU, determinista).
 *
 * Cadena por línea de haz:
 *   raymarch axial → material en cada muestra → eco de interfaz (ΔZ con
 *   peso especular según la normal local) + speckle coherente intratejido →
 *   atenuación acumulada ida y vuelta (dB·cm⁻¹·MHz⁻¹ × f0) → convolución
 *   por una PSF gaussiana separable cuyo ancho lateral crece lejos del foco.
 *
 * Artefactos emergentes (no dibujados): ensanchamiento/sombra en el borde
 * del cristalino, realce posterior al vítreo, atenuación ósea y de ventana,
 * saturación en aire.
 */
import { MATERIALS, type Material, type MaterialId, reflectionCoeff } from '../anatomy/materials';
import type { Vec3 } from '../core/vec3';
import type { AcquisitionSettings, ProbePose } from '../domain/contracts';
import type { ScanGeometry } from './probe';
import { scatterComplex } from './speckle';

export interface BModeFrame {
  readonly width: number;
  readonly height: number;
  /** Envoltura en dB (0 = máximo de referencia). */
  readonly db: Float32Array;
  readonly depthMm: number;
  readonly scan: ScanGeometry;
}

interface SceneQuery {
  classify(p: Vec3): MaterialId;
}

const EPS = 0.3;

/** Aproxima la normal de la interfaz contando cambios de material por eje. */
export function interfaceNormal(scene: SceneQuery, p: Vec3, mat: MaterialId): Vec3 | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    const a = scene.classify(addScaled(p, axes[i]!, EPS));
    const b = scene.classify(addScaled(p, axes[i]!, -EPS));
    const d = a === b ? 0 : a === mat || b === mat ? 1 : 0;
    if (i === 0) nx = d;
    else if (i === 1) ny = d;
    else nz = d;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return null;
  return [nx / len, ny / len, nz / len];
}

function addScaled(p: Vec3, d: Vec3, s: number): Vec3 {
  return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
}

/**
 * Renderiza un fotograma B-mode.
 * `scene.classify` decide el material por punto del paciente (mm, levógiro).
 */
export function renderBMode(
  scene: SceneQuery,
  scan: ScanGeometry,
  _pose: ProbePose,
  settings: AcquisitionSettings,
  seedLabel: string,
  opts: { axialStepMm?: number; extraAttenuationDb?: number } = {},
): BModeFrame {
  const f0 = settings.frequencyMhz;
  const dz = opts.axialStepMm ?? Math.max(0.08, 1.5 * (1.54 / f0)); // ~1,5·λ
  const height = Math.max(2, Math.round(settings.depthMm / dz));
  const width = scan.lineCount;
  const iQ = new Float32Array(width * height * 2); // re, im intercalado
  const seed = `speckle-${seedLabel}`;

  const specularPow = (m: Material): number => (m.id === 'hueso' || m.id === 'duraVaina' ? 2.2 : 1.2);

  for (let li = 0; li < width; li++) {
    const line = scan.lines[li]!;
    let attDb = 0; // ida y vuelta acumulada
    let prevMat = scene.classify(line.origin);
    let prevM = MATERIALS[prevMat];
    let lensShadowDb = 0;

    for (let zi = 0; zi < height; zi++) {
      const zMm = zi * dz;
      const p = addScaled(line.origin, line.dir, zMm);
      const matId = scene.classify(p);
      const m = MATERIALS[matId];

      // Atenuación del tramo recorrido (ida y vuelta).
      attDb += prevM.attenuationDbCmMhz * f0 * (dz / 10) * 2;

      let re = 0;
      let im = 0;

      if (matId !== prevMat) {
        // Eco de interfaz: |ΔZ| con peso especular según normal local.
        const rc = Math.abs(reflectionCoeff(prevM, m));
        const n = interfaceNormal(scene, p, prevMat);
        const cosA = n ? Math.abs(n[0] * line.dir[0] + n[1] * line.dir[1] + n[2] * line.dir[2]) : 0.5;
        const gain = Math.pow(Math.max(0, 1 - cosA), specularPow(m)); // ⊥ a la interfaz = 0 deg → máx
        const amp = rc * (0.4 + 0.6 * gain) * 8;
        re += amp;
        if (matId === 'cristalino' || prevMat === 'cristalino') {
          // Borde del cristalino: sombra posterior dependiente de oblicuidad.
          const edge = Math.min(1, rc * 6) * (1 - cosA);
          lensShadowDb += edge * 3.5;
        }
      }

      // Speckle intratejido (el hueso/aire apenas dispersan → eco dominante).
      const [sr, si] = scatterComplex(seed, p, m.scatterAmp);
      re += sr;
      im += si;

      // Ensanchamiento del haz → se aproxima después por la PSF lateral.
      const attLin = Math.pow(10, -(attDb + lensShadowDb) / 20);
      const k = (zi * width + li) * 2;
      iQ[k] = re * attLin;
      iQ[k + 1] = im * attLin;

      prevMat = matId;
      prevM = m;
    }
  }

  // PSF separable: σ axial ≈ pulso; σ lateral crece con |z − foco|.
  const sigmaAxial = Math.max(1, 2.2 / f0) / dz; // en muestras
  const out = new Float32Array(width * height);
  const tmp = new Float32Array(width * height);

  // convolución axial de la magnitud compleja
  const env = (idx: number) => Math.hypot(iQ[2 * idx], iQ[2 * idx + 1]);
  const kernA = gaussKernel(sigmaAxial);
  for (let li = 0; li < width; li++) {
    for (let zi = 0; zi < height; zi++) {
      let acc = 0;
      for (let t = -kernA.r; t <= kernA.r; t++) {
        const zz = Math.min(height - 1, Math.max(0, zi + t));
        acc += env(zz * width + li) * kernA.w[t + kernA.r];
      }
      tmp[zi * width + li] = acc;
    }
  }

  const focusSample = settings.focusMm / dz;
  const beamSigma0 = Math.max(0.8, 6 / f0); // líneas
  const outBuf = out;
  for (let zi = 0; zi < height; zi++) {
    const defocus = Math.abs(zi - focusSample) * dz;
    const sigmaL = Math.max(0.6, beamSigma0 * (0.6 + defocus / (settings.depthMm * 0.6)));
    const kern = gaussKernel(sigmaL);
    for (let li = 0; li < width; li++) {
      let acc = 0;
      for (let t = -kern.r; t <= kern.r; t++) {
        const ll = Math.min(width - 1, Math.max(0, li + t));
        acc += tmp[zi * width + ll] * kern.w[t + kern.r];
      }
      outBuf[zi * width + li] = acc;
    }
  }

  // TGC + compresión logarítmica dentro del rango dinámico.
  // tgcDb: 8 potenciómetros repartidos a lo largo de la profundidad.
  const maxRef = 4.0;
  const tgcAt = (zMm: number): number => {
    const n = settings.tgcDb.length;
    const f = Math.min(1, Math.max(0, zMm / Math.max(1, settings.depthMm))) * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    return settings.tgcDb[i0]! * (i1 - f) + settings.tgcDb[i1]! * (f - i0);
  };
  for (let zi = 0; zi < height; zi++) {
    const tgcDb = tgcAt(zi * dz);
    for (let li = 0; li < width; li++) {
      const v = outBuf[zi * width + li]! / maxRef;
      const db = 20 * Math.log10(v + 1e-6) + settings.gainDb + tgcDb;
      outBuf[zi * width + li] = db;
    }
  }

  return { width, height, db: outBuf, depthMm: settings.depthMm, scan };
}

function gaussKernel(sigma: number): { w: Float32Array; r: number } {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return { w, r };
}
