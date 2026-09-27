/**
 * Propiedades acústicas de los materiales del modelo.
 * Z = ρ·c; la atenuación es dB/cm/MHz en un sentido (ida); la cadena acústica
 * suma ida y vuelta. Los dispersores dan amplitud volumétrica y densidad
 * relativa de speckle; `specular` marca interfaces que producen eco fuerte
 * cuando el haz es perpendicular.
 *
 * Evidencia: valores de tabla estándar de ultrasonido (ver docs/REFERENCES.md);
 * los marcados en el registro de `parameters.ts` llevan su tipo de evidencia.
 */
export interface Material {
  readonly id: MaterialId;
  /** Velocidad del sonido, m/s. */
  readonly cMs: number;
  /** Densidad, kg/m³. */
  readonly densityKgM3: number;
  /** Atenuación, dB/cm/MHz (un sentido). */
  readonly attenuationDbCmMhz: number;
  /** Densidad relativa de dispersores volumétricos [0,1]. */
  readonly scatterDensity: number;
  /** Amplitud relativa del eco disperso [0,1]. */
  readonly scatterAmp: number;
  /** Impedancia acústica Z = ρ·c, MRayl. */
  readonly zMrayl: number;
}

export type MaterialId =
  | 'gel' // acoplamiento / párpado superficial
  | 'piel' // párpado / cuero cabelludo
  | 'grasaOrbitaria'
  | 'humorAcuoso' // cámara anterior
  | 'cornea'
  | 'iris'
  | 'cristalino'
  | 'vitrio' // humor vítreo
  | 'paredGlobo' // complejo retina–coroides–esclera
  | 'nervioOptico' // fascículos del nervio
  | 'lcrVaina' // espacio subaracnoideo perineural
  | 'duraVaina' // envoltura dural de la vaina
  | 'musculoRecto'
  | 'hueso' // tabla ósea / pared orbitaria / cráneo
  | 'tejidoCerebral'
  | 'cisterna' // LCR basal
  | 'vaso' // sangre arterial dentro de un vaso
  | 'aire'; // fuera del paciente

const m = (
  id: MaterialId,
  cMs: number,
  densityKgM3: number,
  attenuationDbCmMhz: number,
  scatterDensity: number,
  scatterAmp: number,
): Material => ({
  id,
  cMs,
  densityKgM3,
  attenuationDbCmMhz,
  scatterDensity,
  scatterAmp,
  zMrayl: (cMs * densityKgM3) / 1e6,
});

export const MATERIALS: Readonly<Record<MaterialId, Material>> = Object.freeze({
  gel: m('gel', 1520, 1000, 0.15, 0.0, 0.0),
  piel: m('piel', 1620, 1090, 0.7, 0.55, 0.55),
  grasaOrbitaria: m('grasaOrbitaria', 1478, 950, 0.6, 0.85, 0.5),
  humorAcuoso: m('humorAcuoso', 1532, 1005, 0.1, 0.05, 0.06),
  cornea: m('cornea', 1550, 1076, 0.5, 0.3, 0.4),
  iris: m('iris', 1542, 1050, 0.6, 0.4, 0.55),
  cristalino: m('cristalino', 1641, 1136, 1.0, 0.35, 0.3),
  vitrio: m('vitrio', 1532, 1000, 0.12, 0.1, 0.08),
  paredGlobo: m('paredGlobo', 1620, 1100, 0.7, 0.9, 0.85),
  nervioOptico: m('nervioOptico', 1550, 1050, 0.6, 0.45, 0.35),
  lcrVaina: m('lcrVaina', 1500, 1007, 0.2, 0.08, 0.05),
  duraVaina: m('duraVaina', 1600, 1150, 0.8, 0.8, 0.8),
  musculoRecto: m('musculoRecto', 1590, 1070, 0.8, 0.5, 0.45),
  hueso: m('hueso', 2800, 1850, 8.0, 0.15, 0.9),
  tejidoCerebral: m('tejidoCerebral', 1560, 1030, 0.6, 0.5, 0.4),
  // Las cisternas basales son ecogénicas (pliegues aracnoideos): el «corazón
  // en estrella» de la referencia TCCD. No es LCR anecogénico.
  cisterna: m('cisterna', 1500, 1007, 0.3, 0.6, 0.6),
  vaso: m('vaso', 1570, 1060, 0.15, 0.35, 0.25),
  aire: m('aire', 343, 1.2, 10.0, 0.0, 0.0),
});

/** Coeficiente de reflexión de intensidad en una interfaz (amplitud ≈ sqrt). */
export function reflectionCoeff(a: Material, b: Material): number {
  const dz = a.zMrayl - b.zMrayl;
  const s = a.zMrayl + b.zMrayl;
  return s === 0 ? 0 : dz / s;
}
