/**
 * Formación de imagen B-mode (CPU, determinista).
 *
 * Cadena por línea de haz:
 *   raymarch axial → material en cada muestra → eco de interfaz (ΔZ con
 *   peso especular según la normal local) + speckle coherente intratejido →
 *   atenuación acumulada ida y vuelta (α₀·fⁿ en dB/cm) → convolución
 *   por una PSF gaussiana separable cuyo ancho lateral deriva de la apertura,
 *   el foco y el pitch real por profundidad.
 *
 * Artefactos emergentes (no dibujados): ensanchamiento/sombra en el borde
 * del cristalino, realce posterior al vítreo, atenuación ósea y de ventana,
 * saturación en aire.
 */
import {
  attenuationDbCm,
  MATERIALS,
  type Material,
  type MaterialId,
  reflectionCoeff,
} from '../anatomy/materials';
import { dot, normalize, type Vec3 } from '../core/vec3';
import type { AcquisitionSettings } from '../domain/contracts';
import { lateralFwhmMm, probeBeamSpec, sigmaFromFwhm, sidelobeLevelDb } from './beam';
import type { ScanGeometry } from './probe';
import { scatterComplex } from './speckle';
import { FISICA_US } from './params';

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

interface InterfaceEvent {
  readonly zi: number;
  readonly rc: number;
  readonly attDb: number;
}

interface ThinStrongEntry {
  readonly zi: number;
  readonly rc: number;
}

const EPS = FISICA_US.params.interfaceEpsMm.value;
const INTERFACE_ECHO_GAIN = 8;

/** LIM-05: aproxima la normal contando cambios de material por eje. */
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
 * Refracción vectorial según Snell. La normal se orienta contra el rayo
 * incidente; una razón que produzca reflexión total conserva la dirección.
 */
export function refractDirection(dir: Vec3, normal: Vec3, indexRatio: number): Vec3 {
  const n: Vec3 = dot(normal, dir) > 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
  const cosIncident = -dot(n, dir);
  const sinTransmittedSquared = indexRatio * indexRatio * (1 - cosIncident * cosIncident);
  if (sinTransmittedSquared >= 1) return dir;
  const cosTransmitted = Math.sqrt(1 - sinTransmittedSquared);
  return normalize([
    indexRatio * dir[0] + (indexRatio * cosIncident - cosTransmitted) * n[0],
    indexRatio * dir[1] + (indexRatio * cosIncident - cosTransmitted) * n[1],
    indexRatio * dir[2] + (indexRatio * cosIncident - cosTransmitted) * n[2],
  ]);
}

/**
 * Renderiza un fotograma B-mode.
 * `scene.classify` decide el material por punto del paciente (mm, levógiro).
 */
export function renderBMode(
  scene: SceneQuery,
  scan: ScanGeometry,
  settings: AcquisitionSettings,
  seedLabel: string,
  opts: { axialStepMm?: number; extraAttenuationDb?: number; speckle?: boolean } = {},
): BModeFrame {
  const f0 = settings.frequencyMhz;
  const minAxialStepMm = 0.08; // resolución mínima del muestreo axial
  const axialSamplingFactor = 1.5; // separación axial relativa a λ
  const dz =
    opts.axialStepMm ??
    Math.max(minAxialStepMm, axialSamplingFactor * (FISICA_US.params.soundSpeedMs.value / 1000 / f0));
  const height = Math.max(2, Math.round(settings.depthMm / dz));
  const width = scan.lineCount;
  const iQ = new Float32Array(width * height * 2); // re, im intercalado
  const seed = `speckle-${seedLabel}`;
  const beam = probeBeamSpec(settings.transducer, settings);
  const cRef = FISICA_US.params.soundSpeedMs.value;

  const specularPow = (m: Material): number => (m.id === 'hueso' || m.id === 'duraVaina' ? 2.2 : 1.2);

  for (let li = 0; li < width; li++) {
    const line = scan.lines[li]!;
    let attDb = 0; // ida y vuelta acumulada
    let prevMat = scene.classify(line.origin);
    let prevM = MATERIALS[prevMat];
    let lensShadowDb = 0;
    let p = line.origin;
    let dir = line.dir;
    const interfaceEvents: InterfaceEvent[] = [];
    const cometEvents: ThinStrongEntry[] = [];
    let mirror: { zi: number; rc: number } | null = null;
    let thinStrong: ThinStrongEntry | null = null;

    for (let zi = 0; zi < height; zi++) {
      const matId = scene.classify(p);
      const m = MATERIALS[matId];

      // Atenuación del tramo recorrido (ida y vuelta).
      attDb += attenuationDbCm(prevM, f0) * (dz / 10) * 2;

      let re = 0;
      let im = 0;

      if (matId !== prevMat) {
        // Eco de interfaz: |ΔZ| con peso especular según normal local.
        const rc = Math.abs(reflectionCoeff(prevM, m));
        const n = interfaceNormal(scene, p, prevMat);
        const cosA = n ? Math.abs(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) : 0.5;
        const gain = Math.pow(Math.max(0, 1 - cosA), specularPow(m)); // ⊥ a la interfaz = 0 deg → máx
        const amp = rc * (0.4 + 0.6 * gain) * INTERFACE_ECHO_GAIN;
        re += amp;
        const involvesLens = matId === 'cristalino' || prevMat === 'cristalino';
        if (rc > FISICA_US.params.reverbRcThreshold.value && zi * dz >= 2 && !involvesLens) {
          interfaceEvents.push({ zi, rc, attDb });
        }
        if (rc > 0.5 && cosA > 0.8 && (!mirror || rc > mirror.rc)) {
          mirror = { zi, rc };
        }
        if (isThinStrongMaterial(matId) && rc > 0.5) {
          thinStrong = { zi, rc };
        } else if (thinStrong && isThinStrongMaterial(prevMat)) {
          const thicknessMm = (zi - thinStrong.zi) * dz;
          if (thicknessMm < 1.5) {
            cometEvents.push({ zi, rc: thinStrong.rc });
          }
          thinStrong = null;
        }
        if (involvesLens) {
          // Borde del cristalino: sombra posterior dependiente de oblicuidad.
          const edge = Math.min(1, rc * 6) * (1 - cosA);
          lensShadowDb += edge * 3.5;
        }
        if ((matId === 'cristalino' || prevMat === 'cristalino') && n) {
          dir = refractDirection(dir, n, prevM.cMs / m.cMs);
        }
      }

      // Speckle intratejido (el hueso/aire apenas dispersan → eco dominante).
      if (opts.speckle !== false) {
        const [sr, si] = scatterComplex(seed, p, m.scatterAmp);
        re += sr;
        im += si;
      }

      // DEC-19: ensanchamiento lateral por apertura, foco y lóbulos laterales.
      const attLin = Math.pow(10, -(attDb + lensShadowDb) / 20);
      const k = (zi * width + li) * 2;
      iQ[k] = re * attLin;
      iQ[k + 1] = im * attLin;

      prevMat = matId;
      prevM = m;
      p = addScaled(p, dir, dz * (m.cMs / cRef));
    }

    if (mirror && mirror.zi > 0) {
      const mirrorLength = Math.min(mirror.zi, Math.round(15 / dz));
      const mirrorScale = mirror.rc * FISICA_US.params.mirrorGain.value;
      for (let offset = 1; offset <= mirrorLength; offset++) {
        const sourceZi = mirror.zi - offset;
        const targetZi = mirror.zi + offset;
        if (targetZi >= height) break;
        const source = (sourceZi * width + li) * 2;
        const target = (targetZi * width + li) * 2;
        iQ[target]! += iQ[source]! * mirrorScale;
        iQ[target + 1]! += iQ[source + 1]! * mirrorScale;
      }
    }

    for (const event of interfaceEvents) {
      const eventDepthMm = Math.max(dz, (event.zi + 1) * dz);
      const attenuationRate = event.attDb / eventDepthMm;
      const secondZi = event.zi * 2;
      const thirdZi = event.zi * 3;
      addArtifactEcho(
        iQ,
        width,
        height,
        li,
        secondZi,
        event.rc * event.rc * FISICA_US.params.reverbGain.value * 0.5 * INTERFACE_ECHO_GAIN,
        attenuationRate * Math.max(0, secondZi - event.zi) * dz,
      );
      addArtifactEcho(
        iQ,
        width,
        height,
        li,
        thirdZi,
        event.rc *
          event.rc *
          event.rc *
          Math.pow(FISICA_US.params.reverbGain.value, 2) *
          0.25 *
          INTERFACE_ECHO_GAIN,
        attenuationRate * Math.max(0, thirdZi - event.zi) * dz,
      );
    }
    for (const event of cometEvents) {
      addCometEchoes(iQ, width, height, li, event.zi, event.rc, dz);
    }
  }

  // PSF separable: σ axial ≈ pulso; σ lateral crece con |z − foco|.
  const sigmaAxial = Math.max(1, FISICA_US.params.axialPulseMmMhz.value / f0 / dz); // en muestras
  const out = new Float32Array(width * height);
  const tmp = new Float32Array(width * height);

  // convolución axial de la magnitud compleja
  const env = (idx: number) => Math.hypot(iQ[2 * idx]!, iQ[2 * idx + 1]!);
  const kernA = gaussKernel(sigmaAxial);
  for (let li = 0; li < width; li++) {
    for (let zi = 0; zi < height; zi++) {
      let acc = 0;
      for (let t = -kernA.r; t <= kernA.r; t++) {
        const zz = Math.min(height - 1, Math.max(0, zi + t));
        acc += env(zz * width + li) * kernA.w[t + kernA.r]!;
      }
      tmp[zi * width + li] = acc;
    }
  }

  const sidelobeEpsilon = Math.pow(10, sidelobeLevelDb(beam) / 20);
  const outBuf = out;
  for (let zi = 0; zi < height; zi++) {
    const zMm = zi * dz;
    const pitchMm =
      scan.kind === 'linear'
        ? scan.widthMmOrRad / Math.max(1, scan.lineCount - 1)
        : Math.max(1e-6, (zMm * scan.widthMmOrRad) / Math.max(1, scan.lineCount - 1));
    const sigmaL = Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, zMm)) / pitchMm);
    const kern = beamKernel(sigmaL, sidelobeEpsilon);
    for (let li = 0; li < width; li++) {
      let acc = 0;
      for (let t = -kern.r; t <= kern.r; t++) {
        const ll = Math.min(width - 1, Math.max(0, li + t));
        acc += tmp[zi * width + ll]! * kern.w[t + kern.r]!;
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

function isThinStrongMaterial(id: MaterialId): boolean {
  return id === 'hueso' || id === 'laminaCribosa';
}

function addArtifactEcho(
  iQ: Float32Array,
  width: number,
  height: number,
  lineIndex: number,
  zi: number,
  amplitude: number,
  extraAttenuationDb: number,
): void {
  if (zi < 0 || zi >= height) return;
  const k = (zi * width + lineIndex) * 2;
  const attenuation = Math.pow(10, -extraAttenuationDb / 20);
  iQ[k]! += amplitude * attenuation;
}

function addCometEchoes(
  iQ: Float32Array,
  width: number,
  height: number,
  lineIndex: number,
  startZi: number,
  rc: number,
  dz: number,
): void {
  const stepSamples = Math.max(1, Math.round(FISICA_US.params.cometStepMm.value / dz));
  for (let n = 1; n <= 6; n++) {
    const zi = startZi + n * stepSamples;
    if (zi >= height) break;
    addArtifactEcho(iQ, width, height, lineIndex, zi, rc * Math.pow(0.6, n) * INTERFACE_ECHO_GAIN, 0);
  }
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

function beamKernel(sigma: number, sidelobeEpsilon: number): { w: Float32Array; r: number } {
  const main = gaussKernel(sigma);
  const broad = gaussKernel(3 * sigma);
  const r = Math.max(main.r, broad.r);
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const mainWeight = Math.abs(i) <= main.r ? main.w[i + main.r]! : 0;
    const broadWeight = Math.abs(i) <= broad.r ? broad.w[i + broad.r]! : 0;
    const value = (1 - sidelobeEpsilon) * mainWeight + sidelobeEpsilon * broadWeight;
    w[i + r] = value;
    sum += value;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return { w, r };
}
