/**
 * Propiedades acústicas de los materiales del modelo.
 * Z = ρ·c; la atenuación es α₀·fⁿ en dB/cm en un sentido (ida), con α₀
 * expresado en dB/cm/MHzⁿ; la cadena acústica
 * suma ida y vuelta. Los dispersores dan amplitud volumétrica y densidad
 * relativa de speckle; `specular` marca interfaces que producen eco fuerte
 * cuando el haz es perpendicular.
 *
 * Evidencia: valores de tabla estándar de ultrasonido (clave `tablas-acusticas-estandar`
 * en docs/REFERENCES.md);
 * los marcados en el registro de `parameters.ts` llevan su tipo de evidencia.
 */
export interface Material {
  readonly id: MaterialId;
  /** Velocidad del sonido, m/s. */
  readonly cMs: number;
  /** Densidad, kg/m³. */
  readonly densityKgM3: number;
  /** Coeficiente α₀ de atenuación, dB/cm/MHzⁿ (un sentido). */
  readonly attenuationDbCmMhz: number;
  /** Exponente de la ley de potencia α(f) = α₀·fⁿ. */
  readonly attenuationExponent: number;
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
  | 'capsulaCristalino' // cápsula del cristalino: eco lineal
  | 'vitrio' // humor vítreo
  | 'paredGlobo' // retina (capa interna de la pared)
  | 'coroides' // coroides vascular
  | 'esclera' // esclera fibrosa: capa más ecogénica de la pared
  | 'cuerpoCiliar' // anillo uveal anterior tras la raíz del iris
  | 'laminaCribosa' // disco papilar posterior
  | 'nervioOptico' // fascículos del nervio
  | 'lcrVaina' // espacio subaracnoideo perineural
  | 'duraVaina' // envoltura dural de la vaina
  | 'musculoRecto'
  | 'septoOrbitario' // tabiques fibrosos de la grasa retrobulbar
  | 'hueso' // tabla ósea / pared orbitaria / cráneo
  | 'musculoTemporal' // temporalis sobre la ventana: banda hipoecoica
  | 'hoz' // hoz del cerebro (dura): lámina ecogénica en la línea media
  | 'sustanciaBlanca' // parénquima profundo, menos ecogénico que la corteza
  | 'mesencefalo' // mesencéfalo hipoecoico enmarcado por las cisternas
  | 'tejidoCerebral'
  | 'sustanciaNegra' // bandas hiperecoicas mesencefálicas
  | 'ependimo' // paredes ventriculares
  | 'talamo' // tálamo hipoecoico
  | 'pineal' // glándula pineal ecogénica
  | 'cisterna' // LCR basal
  | 'vaso' // sangre arterial dentro de un vaso
  | 'grasaSubcutanea' // tejido celular subcutáneo cervical (DEC-58)
  | 'glandulaSubmandibular' // parénquima glandular homogéneo, algo ecogénico
  | 'musculoCervical' // digástrico / milohioideo: bandas hipoecoicas
  | 'tejidoCervical' // tejido blando cervical profundo de fondo
  | 'aire'; // fuera del paciente

const m = (
  id: MaterialId,
  cMs: number,
  densityKgM3: number,
  attenuationDbCmMhz: number,
  attenuationExponent: number,
  scatterDensity: number,
  scatterAmp: number,
): Material => ({
  id,
  cMs,
  densityKgM3,
  attenuationDbCmMhz,
  attenuationExponent,
  scatterDensity,
  scatterAmp,
  zMrayl: (cMs * densityKgM3) / 1e6,
});

export const MATERIALS: Readonly<Record<MaterialId, Material>> = Object.freeze({
  // Duck 1990; Szabo 2014 cap. 4. Tejidos blandos: n≈1,1–1,5.
  gel: m('gel', 1520, 1000, 0.15, 1.1, 0.0, 0.0),
  piel: m('piel', 1620, 1090, 0.7, 1.1, 0.55, 0.35),
  // Duck 1990: grasa ~lineal en f (~0,6 dB/cm/MHz).
  // Grasa hiperecoica heterogénea (lobulillos con septos fibrosos).
  grasaOrbitaria: m('grasaOrbitaria', 1478, 950, 0.6, 1.0, 0.85, 0.55),
  // Líquidos oculares ajustados para conservar α(7,5 MHz) del modelo previo.
  // Anecoicos: >40 dB bajo la grasa orbitaria.
  humorAcuoso: m('humorAcuoso', 1532, 1005, 0.1 / 7.5, 2.0, 0.02, 0.01),
  cornea: m('cornea', 1550, 1076, 0.5, 1.1, 0.3, 0.4),
  iris: m('iris', 1542, 1050, 0.6, 1.1, 0.4, 0.55),
  // Núcleo del cristalino anecoico: solo la cápsula produce eco.
  cristalino: m('cristalino', 1641, 1136, 1.0, 1.1, 0.1, 0.03),
  capsulaCristalino: m('capsulaCristalino', 1641, 1136, 1.0, 1.1, 0.9, 0.8),
  vitrio: m('vitrio', 1532, 1000, 0.12 / 7.5, 2.0, 0.02, 0.01),
  // Retina: capa fina poco ecogénica; la pared brillante es la esclera.
  paredGlobo: m('paredGlobo', 1620, 1100, 0.7, 1.1, 0.9, 0.5),
  coroides: m('coroides', 1560, 1050, 0.6, 1.1, 0.7, 0.55),
  esclera: m('esclera', 1630, 1100, 0.9, 1.1, 0.9, 0.9),
  cuerpoCiliar: m('cuerpoCiliar', 1560, 1050, 0.6, 1.1, 0.6, 0.5),
  laminaCribosa: m('laminaCribosa', 1600, 1100, 0.7, 1.1, 0.9, 0.6),
  nervioOptico: m('nervioOptico', 1550, 1050, 0.6, 1.1, 0.45, 0.35),
  lcrVaina: m('lcrVaina', 1500, 1007, 0.2 / 7.5, 2.0, 0.03, 0.015),
  duraVaina: m('duraVaina', 1600, 1150, 0.8, 1.1, 0.8, 0.8),
  // Músculo extraocular hipoecoico frente a la grasa.
  musculoRecto: m('musculoRecto', 1590, 1070, 0.8, 1.1, 0.5, 0.3),
  septoOrbitario: m('septoOrbitario', 1600, 1100, 0.8, 1.1, 0.9, 0.85),
  // Hueso: α₀=4 conserva α(2 MHz)=16 dB/cm del modelo previo.
  hueso: m('hueso', 2800, 1850, 4.0, 2.0, 0.15, 0.9),
  // Temporalis: músculo hipoecoico que tapiza la ventana ósea.
  musculoTemporal: m('musculoTemporal', 1590, 1070, 0.8, 1.1, 0.5, 0.3),
  // Hoz: pliegue dural, muy ecogénico.
  hoz: m('hoz', 1600, 1150, 0.8, 1.1, 0.9, 0.85),
  // Sustancia blanca: algo más hipoecoica que la corteza.
  sustanciaBlanca: m('sustanciaBlanca', 1560, 1030, 0.6, 1.2, 0.5, 0.35),
  // Mesencéfalo: hipoecoico frente a las cisternas basales ecogénicas.
  mesencefalo: m('mesencefalo', 1560, 1035, 0.6, 1.2, 0.35, 0.1),
  tejidoCerebral: m('tejidoCerebral', 1560, 1030, 0.6, 1.2, 0.5, 0.45),
  // Berg et al. 2008: hiperecogenicidad de sustancia negra en TCS.
  sustanciaNegra: m('sustanciaNegra', 1560, 1040, 0.6, 1.2, 0.7, 0.3),
  ependimo: m('ependimo', 1560, 1040, 0.6, 1.2, 0.85, 0.3),
  talamo: m('talamo', 1560, 1035, 0.6, 1.2, 0.45, 0.3),
  pineal: m('pineal', 1600, 1100, 0.7, 1.2, 0.9, 0.4),
  // Las cisternas basales son ecogénicas (pliegues aracnoideos): el «corazón
  // en estrella» de la referencia TCCD. No es LCR anecogénico.
  // Líquidos craneales ajustados para conservar α(2 MHz) del modelo previo.
  cisterna: m('cisterna', 1500, 1007, 0.3 / 2, 2.0, 0.6, 0.55),
  vaso: m('vaso', 1570, 1060, 0.15 / 2, 2.0, 0.35, 0.25),
  // Escena submandibular (DEC-58): grasa subcutánea hipoecoica, glándula
  // homogénea algo más ecogénica que el músculo, músculo hipoecoico y un
  // fondo de tejido blando intermedio (Duck 1990: blandos α₀≈0,6–0,8, n≈1,1).
  grasaSubcutanea: m('grasaSubcutanea', 1478, 950, 0.6, 1.0, 0.6, 0.3),
  glandulaSubmandibular: m('glandulaSubmandibular', 1560, 1050, 0.8, 1.1, 0.9, 0.8),
  musculoCervical: m('musculoCervical', 1590, 1070, 0.8, 1.1, 0.45, 0.16),
  tejidoCervical: m('tejidoCervical', 1560, 1040, 0.7, 1.1, 0.6, 0.32),
  aire: m('aire', 343, 1.2, 10.0, 1.1, 0.0, 0.0),
});

/** Atenuación efectiva α(f)=α₀·fⁿ en dB/cm (un sentido). */
export function attenuationDbCm(material: Material, frequencyMhz: number): number {
  return material.attenuationDbCmMhz * Math.pow(frequencyMhz, material.attenuationExponent);
}

/** Coeficiente de reflexión de intensidad en una interfaz (amplitud ≈ sqrt). */
export function reflectionCoeff(a: Material, b: Material): number {
  const dz = a.zMrayl - b.zMrayl;
  const s = a.zMrayl + b.zMrayl;
  return s === 0 ? 0 : dz / s;
}
