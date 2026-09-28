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
  | 'hipocapnia';

export interface ClinicalCase {
  readonly id: CaseId;
  readonly label: string;
  /** Viñeta clínica de 1–2 líneas mostrada en el panel del instructor. */
  readonly summary: string;
  readonly physiology: { mapMmHg: number; paco2MmHg: number; icpMmHg: number };
  readonly willisVariant: WillisVariant;
  /** id de vaso → factor sobre el radio (1 = sin cambio; el flujo no varía). */
  readonly vesselRadiusScale: Readonly<Record<string, number>>;
  /** Sustituciones de la ventana temporal (espesor óseo y calidad). */
  readonly window: { thicknessMm?: number; quality?: number };
  /**
   * TAMax de la ACI extracraneal asumida para el índice de Lindegaard;
   * la ACI no se insona (LIM-02).
   */
  readonly icaExtracranialTamaxCms: number;
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
    vesselRadiusScale: { 'm1-der': 0.5 },
    icaExtracranialTamaxCms: 50,
    teaching: [
      'Aumento focal de velocidad con ensanchamiento espectral.',
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
];

export function caseById(id: string | null | undefined): ClinicalCase {
  return CASES.find((c) => c.id === id) ?? CASES[0]!;
}
