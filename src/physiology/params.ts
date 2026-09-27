/**
 * Parámetros fisiológicos y de la onda arterial del caso N1.
 * Los valores clínicos del manifiesto se referencian desde este registro.
 */
import { defineParameters } from '../core/evidence';

export const FISIOLOGIA = defineParameters('fisiologia', {
  psvCms: {
    value: 90,
    unit: 'cm/s',
    range: [60, 120],
    evidence: 'documentado',
    sources: ['siemens-tcd-job-aid'],
    note: 'PSV de referencia para M1.',
  },
  edvCms: {
    value: 35,
    unit: 'cm/s',
    range: [20, 60],
    evidence: 'documentado',
    sources: ['siemens-tcd-job-aid'],
    note: 'EDV de referencia para M1.',
  },
  taMaxCms: {
    value: 55,
    unit: 'cm/s',
    range: [35, 75],
    evidence: 'derivado',
    sources: ['plan-simulador-2026'],
    note: 'Valor objetivo aproximado de la integral de la onda N1.',
  },
  piNormal: {
    value: 0.85,
    unit: 'adimensional',
    range: [0.5, 1.19],
    evidence: 'consenso',
    sources: ['gosling-pi-referencia'],
    note: 'Índice de pulsatilidad de referencia.',
  },
  lindegaardNormal: {
    value: 2,
    unit: 'adimensional',
    range: [0, 3],
    evidence: 'consenso',
    sources: ['lindegaard-indice-1989'],
    note: 'Razón ACM/ACI extracraneal normal.',
  },
  heartRateBpm: {
    value: 70,
    unit: 'lpm',
    range: [50, 100],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'Frecuencia cardíaca basal del fixture N1.',
  },
  mapMmHg: {
    value: 85,
    unit: 'mmHg',
    range: [65, 110],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'PAM basal del fixture N1.',
  },
  paco2MmHg: {
    value: 40,
    unit: 'mmHg',
    range: [30, 50],
    evidence: 'consenso',
    sources: ['plan-simulador-2026'],
    note: 'PaCO₂ basal normocápnica.',
  },
  icpMmHg: {
    value: 10,
    unit: 'mmHg',
    range: [0, 15],
    evidence: 'consenso',
    sources: ['plan-simulador-2026'],
    note: 'PIC basal del fixture N1.',
  },
  upstrokePhase: {
    value: 0.09,
    unit: 'fracción de ciclo',
    range: [0.05, 0.15],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'Duración relativa del ascenso sistólico.',
  },
  decayTau: {
    value: 0.35,
    unit: 'fracción de ciclo',
    range: [0.2, 0.6],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'Constante de decaimiento diastólico normalizada.',
  },
  laminarProfile: {
    value: 0.85,
    unit: 'fracción',
    range: [0, 1],
    evidence: 'estimado',
    sources: ['plan-simulador-2026'],
    note: 'Peso del perfil laminar parabólico del vaso.',
  },
  a1PsvCms: {
    value: 80,
    unit: 'cm/s',
    range: [50, 110],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'PSV del A1 usado por el fixture.',
  },
  a1EdvCms: {
    value: 30,
    unit: 'cm/s',
    range: [15, 55],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'EDV del A1 usado por el fixture.',
  },
  p1PsvCms: {
    value: 60,
    unit: 'cm/s',
    range: [35, 90],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'PSV del P1/P2 usado por el fixture.',
  },
  p1EdvCms: {
    value: 25,
    unit: 'cm/s',
    range: [10, 45],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'EDV del P1/P2 usado por el fixture.',
  },
  qM1MlMin: {
    value: 234.5153846181403,
    unit: 'ml/min',
    range: [180, 300],
    evidence: 'derivado',
    sources: ['plan-simulador-2026'],
    note: 'Q = vMedia·πr²·0,6, con vMedia M1 = 35 + (90−35)·media(arterialShape) y rM1=1,5 mm.',
  },
  qA2MlMin: {
    value: 91.32649876906984,
    unit: 'ml/min',
    range: [60, 130],
    evidence: 'derivado',
    sources: ['aium-tcd-guia', 'plan-simulador-2026'],
    note: 'Q terminal A2 derivado de la forma de onda A1 de referencia y rA2=1,0 mm.',
  },
  qP2MlMin: {
    value: 86.47672952342693,
    unit: 'ml/min',
    range: [55, 125],
    evidence: 'derivado',
    sources: ['aium-tcd-guia', 'plan-simulador-2026'],
    note: 'Q terminal P2 derivado de la forma de onda P1 de referencia y rP2=1,1 mm.',
  },
  basilarPsvCms: {
    value: 55,
    unit: 'cm/s',
    range: [30, 80],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'PSV de la basilar usado por el fixture.',
  },
  basilarEdvCms: {
    value: 22,
    unit: 'cm/s',
    range: [10, 40],
    evidence: 'estimado',
    sources: ['plan-simulador-2026', 'aium-tcd-guia'],
    note: 'EDV de la basilar usado por el fixture.',
  },
});

/** Media numérica de la onda normalizada usada para derivar los caudales. */
export function arterialShapeMean(samples = 1_000_000): number {
  const upstroke = FISIOLOGIA.params.upstrokePhase.value;
  const decay = FISIOLOGIA.params.decayTau.value;
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const phase = (i + 0.5) / samples;
    sum += phase < upstroke ? phase / upstroke : Math.exp(-(phase - upstroke) / decay);
  }
  return sum / samples;
}
