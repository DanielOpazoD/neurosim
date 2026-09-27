/**
 * Registro de parámetros con evidencia (plan §5.1, §12.2): valor, unidad,
 * rango, tipo de evidencia y claves de docs/REFERENCES.md. Un parámetro sin
 * evidencia válida rompe la carga del módulo.
 */
import { defineParameters, type Parameter } from '../core/evidence';

const p = (x: Parameter) => x;

export const NEURO_PARAMS = defineParameters('neuro', {
  onsdOffsetMm: p({
    value: 3,
    unit: 'mm',
    range: [2.9, 3.1],
    evidence: 'consenso',
    sources: ['qcc-consenso-onsd-2024', 'montorfano-onsd-2018'],
    note: 'Medición DVNO a 3 mm retroglobo, perpendicular al nervio.',
  }),
  sondaOcularMinMhz: p({
    value: 7.5,
    unit: 'MHz',
    range: [7.5, 20],
    evidence: 'consenso',
    sources: ['qcc-consenso-onsd-2024'],
    note: 'Sonda lineal de alta frecuencia para ONSD (≥7,5 MHz).',
  }),
  miOcularMax: p({
    value: 0.23,
    unit: 'adimensional',
    range: [0.1, 0.23],
    evidence: 'consenso',
    sources: ['aium-seguridad-ocular-2019'],
    note: 'Límite FDA de MI para exploración oftálmica; TI ≤ 1.',
  }),
  globoDiametroMm: p({
    value: 24,
    unit: 'mm',
    range: [22, 27],
    evidence: 'documentado',
    sources: ['qcc-consenso-onsd-2024'],
    note: 'Diámetro axial del globo adulto.',
  }),
  vainaExtMmDer: p({
    value: 4.95,
    unit: 'mm',
    range: [4.0, 6.0],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'DVNO externo = interno 4,6 + 2·dura 0,35. Calibrar con literatura.',
  }),
  m1ProfundidadMm: p({
    value: 55,
    unit: 'mm',
    range: [40, 65],
    evidence: 'consenso',
    sources: ['siemens-tcd-job-aid', 'aium-tcd-guia'],
    note: 'Rango de insonación M1 por ventana temporal.',
  }),
  acmPsvCms: p({
    value: 90,
    unit: 'cm/s',
    range: [60, 120],
    evidence: 'documentado',
    sources: ['siemens-tcd-job-aid'],
    note: 'MFV normal ACM ≈ 55 cm/s en el adulto (fixture N1).',
  }),
  acmEdvCms: p({
    value: 35,
    unit: 'cm/s',
    range: [20, 60],
    evidence: 'documentado',
    sources: ['siemens-tcd-job-aid'],
  }),
  tcdF0Mhz: p({
    value: 2,
    unit: 'MHz',
    range: [1.6, 2.5],
    evidence: 'consenso',
    sources: ['aium-tcd-guia'],
    note: 'Frecuencia del transductor transcraneal.',
  }),
  piNormal: p({
    value: 0.85,
    unit: 'adimensional',
    range: [0.5, 1.19],
    evidence: 'consenso',
    sources: ['gosling-pi-referencia'],
    note: 'Índice de pulsatilidad de Gosling en adulto sano.',
  }),
  lindegaardNormal: p({
    value: 2,
    unit: 'adimensional',
    range: [0, 3],
    evidence: 'consenso',
    sources: ['lindegaard-indice-1989'],
    note: 'MFV ACM / MFV ACI extracraneal ipsilateral; <3 normal. Post-N1.',
  }),
  ventanaEspesorMm: p({
    value: 1.6,
    unit: 'mm',
    range: [1.0, 2.5],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'Espesor óseo efectivo de la ventana temporal del adulto de referencia.',
  }),
  ruidoElectronico: p({
    value: 0.0004,
    unit: 'fracción',
    range: [1e-5, 4e-3],
    evidence: 'extrapolacion',
    sources: [],
    note: 'Ruido del receptor relativo a la sangre a transmisión 1 (vexus NOISE_STD).',
  }),
});
