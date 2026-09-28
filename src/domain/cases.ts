/**
 * Biblioteca de casos clínicos N2: conjuntos estáticos de parámetros
 * (fisiología basal, variante de Willis, escalado de radios vasculares y
 * calidad de ventana) seleccionables por URL (`?caso=<id>`) o desde el panel
 * del instructor. No modelan evolución temporal (ver docs/LIMITATIONS.md,
 * LIM-25).
 */
import type { WillisVariant } from './contracts';
import { FISIOLOGIA } from '../physiology/params';

export type CaseId =
  | 'normal'
  | 'hic'
  | 'vasoespasmo'
  | 'estenosisM1'
  | 'ventanaPobre'
  | 'paradaCirculatoria'
  | 'hipercapnia'
  | 'hipocapnia'
  | 'parkinson';

export interface ClinicalCase {
  readonly id: CaseId;
  readonly label: string;
  /** Viñeta clínica de 1–2 líneas mostrada en el panel del instructor. */
  readonly summary: string;
  readonly physiology: { mapMmHg: number; paco2MmHg: number; icpMmHg: number };
  readonly willisVariant: WillisVariant;
  /** id de vaso → factor sobre el radio (1 = sin cambio; el flujo no varía). */
  readonly vesselRadiusScale: Readonly<Record<string, number>>;
  /** Estenosis focales por vaso (arco en mm sobre la línea central del vaso). */
  readonly vesselStenosis?: Readonly<Record<string, { sMm: number; lengthMm: number; radiusScale: number }>>;
  /** Sustituciones de la ventana temporal (espesor óseo y calidad). */
  readonly window: { thicknessMm?: number; quality?: number };
  /**
   * TAMax de la ACI extracraneal asumida para el índice de Lindegaard;
   * la ACI no se insona (LIM-02).
   */
  readonly icaExtracranialTamaxCms: number;
  /** Multiplicador de ecogenicidad de la sustancia nigra (TCS; 1 = normal). */
  readonly snEchogenicity?: number;
  /** Escala del área en planta de la sustancia nigra (1 = normal). */
  readonly snAreaCm2Scale?: number;
  /** Puntos docentes (2–4 viñetas) mostrados bajo el selector de caso. */
  readonly teaching: readonly string[];
}

const PHYS = FISIOLOGIA.params;

const BASE = {
  willisVariant: 'normal' as WillisVariant,
  vesselRadiusScale: {},
  window: {},
};

export const CASES: readonly ClinicalCase[] = [
  {
    ...BASE,
    id: 'normal',
    label: 'Adulto de referencia',
    summary: 'Paciente adulto sano, hemodinámica y ventana de referencia.',
    physiology: {
      mapMmHg: PHYS.mapMmHg.value,
      paco2MmHg: PHYS.paco2MmHg.value,
      icpMmHg: PHYS.icpMmHg.value,
    },
    icaExtracranialTamaxCms: 45,
    teaching: [
      'Pesquisa de referencia: DVNO bilateral y polígono de Willis completos.',
      'Sirve de base para comparar los casos patológicos.',
    ],
  },
  {
    ...BASE,
    id: 'hic',
    label: 'Hipertensión intracraneal',
    summary: 'TCE grave con PIC elevada: la DVNO se dilata y el PI sube.',
    physiology: { mapMmHg: 95, paco2MmHg: 38, icpMmHg: 32 },
    icaExtracranialTamaxCms: 40,
    teaching: [
      'DVNO > 5,8 mm bilateral.',
      'PI > 1,4 con EDV baja.',
      'La PIC es latente: no se lee de la imagen.',
    ],
  },
  {
    ...BASE,
    id: 'vasoespasmo',
    label: 'Vasoespasmo post-HSA (día 7)',
    summary: 'Espasmo difuso de la ACM izquierda tras hemorragia subaracnoidea.',
    physiology: { mapMmHg: 100, paco2MmHg: 38, icpMmHg: 14 },
    vesselRadiusScale: { 'm1-izq': 0.6 },
    icaExtracranialTamaxCms: 45,
    teaching: [
      'PSV > 200 cm/s en el segmento espástico.',
      'Lindegaard ≥ 3 distingue espasmo de hiperemia.',
      'Comparar siempre con el lado contralateral.',
    ],
  },
  {
    ...BASE,
    id: 'estenosisM1',
    label: 'Estenosis de M1 derecha',
    summary: 'Estenosis focal del segmento M1 derecho con aumento de velocidad.',
    physiology: { mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 },
    vesselStenosis: { 'm1-der': { sMm: 12, lengthMm: 6, radiusScale: 0.5 } },
    icaExtracranialTamaxCms: 50,
    teaching: [
      'Jet focal en la garganta: velocidad ≥ 2× la prestenótica.',
      'Ensanchamiento espectral post-estenótico por turbulencia.',
      'Comparar con el M1 contralateral.',
    ],
  },
  {
    ...BASE,
    id: 'ventanaPobre',
    label: 'Ventana temporal pobre',
    summary: 'Mujer de 78 años: hueso temporal grueso y ventana hipogénica.',
    physiology: { mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 },
    window: { thicknessMm: 3.8, quality: 0.35 },
    icaExtracranialTamaxCms: 45,
    teaching: [
      'Señal color/PW débil no equivale a ausencia de flujo.',
      'Buscar otra ventana (transformando, transorbitaria).',
      'Considerar contraste ecográfico.',
    ],
  },
  {
    ...BASE,
    id: 'paradaCirculatoria',
    label: 'Parada circulatoria cerebral',
    summary: 'PPC ≈ 0: flujo reverberante o espigas sistólicas sin diástole.',
    physiology: { mapMmHg: 90, paco2MmHg: 40, icpMmHg: 88 },
    icaExtracranialTamaxCms: 30,
    teaching: [
      'Patrón reverberante u oscilante con espigas sistólicas.',
      'El simulador no acredita cese circulatorio.',
      'Requiere protocolo completo y confirmación clínica.',
    ],
  },
  {
    ...BASE,
    id: 'hipercapnia',
    label: 'Hipercapnia',
    summary: 'PaCO₂ elevada: vasodilatación, velocidades altas y PI bajo.',
    physiology: { mapMmHg: 90, paco2MmHg: 60, icpMmHg: 10 },
    icaExtracranialTamaxCms: 55,
    teaching: ['Velocidades ↑ y PI ↓ por vasodilatación.', 'Base de la prueba de reactividad al CO₂.'],
  },
  {
    ...BASE,
    id: 'hipocapnia',
    label: 'Hipocapnia',
    summary: 'PaCO₂ baja (hiperventilación): vasoconstricción y PI alto.',
    physiology: { mapMmHg: 90, paco2MmHg: 25, icpMmHg: 10 },
    icaExtracranialTamaxCms: 40,
    teaching: ['Velocidades ↓ y PI ↑ por vasoconstricción.'],
  },
  {
    ...BASE,
    id: 'parkinson',
    label: 'Enfermedad de Parkinson',
    summary: 'Sustancia nigra hiperecogénica y agrandada en el plano mesencefálico.',
    physiology: {
      mapMmHg: PHYS.mapMmHg.value,
      paco2MmHg: PHYS.paco2MmHg.value,
      icpMmHg: PHYS.icpMmHg.value,
    },
    snEchogenicity: 2.4,
    snAreaCm2Scale: 1.8,
    icaExtracranialTamaxCms: 45,
    teaching: [
      'SN hiperecogénica ≥ 0,20–0,25 cm² (percentil 90) en TCS; hallazgo de apoyo, no diagnóstico.',
      'Hemodinámica y DVNO sin cambios respecto al caso normal.',
    ],
  },
];

export function caseById(id: string | null | undefined): ClinicalCase {
  return CASES.find((c) => c.id === id) ?? CASES[0]!;
}
