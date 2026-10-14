import { FISIOLOGIA, arterialShapeTable } from './params';

export interface HemodynamicInput {
  mapMmHg: number;
  paco2MmHg: number;
  icpMmHg: number;
}

export interface HemodynamicState {
  cppMmHg: number;
  crcpMmHg: number;
  flowFactor: number;
  pulsePressureMmHg: number;
  waveform: (phase: number) => number;
  expectedPi: number;
  basal: boolean;
  /** `normal`: P(φ) − CrCP normalizado por PAM − CrCP. `starling`: PAM ≤ CrCP + 1 mmHg (DEC-80). */
  regime: 'normal' | 'starling';
  /** Fracción del lóbulo retrógrado que devuelve la compliance (1 = todo, 0 = nada); 1 en régimen normal. */
  retrogradeFraction: number;
}

const MAP0 = FISIOLOGIA.params.mapMmHg.value;
const ICP0 = FISIOLOGIA.params.icpMmHg.value;
const CPP0 = MAP0 - ICP0;
const CO2_K = FISIOLOGIA.params.co2SlopeLn.value;
const TONE = FISIOLOGIA.params.vasomotorToneMmHg.value;

function shapeAt(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const position = p * arterialShapeTable.length;
  const left = Math.floor(position) % arterialShapeTable.length;
  const right = (left + 1) % arterialShapeTable.length;
  const fraction = position - Math.floor(position);
  return arterialShapeTable[left]! * (1 - fraction) + arterialShapeTable[right]! * fraction;
}

function shapeMean(): number {
  let sum = 0;
  for (const value of arterialShapeTable) sum += value;
  return sum / arterialShapeTable.length;
}

function shapeExtrema(): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of arterialShapeTable) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

export function co2Factor(paco2MmHg: number): number {
  const p = Math.max(20, Math.min(80, paco2MmHg));
  return Math.exp(CO2_K * (p - 40));
}

export function autoregulationFactor(cppMmHg: number): number {
  const slope = FISIOLOGIA.params.autoregSlopePer10.value;
  if (cppMmHg < 50) return (0.95 * Math.max(0, cppMmHg)) / 50;
  if (cppMmHg <= 150) return 1 + ((cppMmHg - CPP0) / 10) * slope;
  return 1.15 * (cppMmHg / 150);
}

/**
 * Tono vasomotor efectivo (CrCP − PIC), proporcional a la razón de
 * resistencia (calibrado al fixture N1). Que no se anule en la dilatación
 * máxima es una limitación conocida (LIM-38): con PPC ≈ 0 deja ~24 mmHg de
 * tono y sitúa la CrCP por encima de la PAM, de ahí el régimen de Starling.
 */
function vasomotorToneMmHg(cvrRatio: number): number {
  return TONE * cvrRatio;
}

const STARLING_DELTA_MMHG = 1;
const CYCLE_SAMPLES = 512;

/** Razón de resistencia en la dilatación máxima del modelo (PPC < 50). */
export const CVR_MIN_RATIO = 50 / CPP0 / 0.95;

/**
 * Estado de regulación: razón de resistencia autorreguladora (R/R₀ sin el
 * efecto del CO₂) y factor de reactividad al CO₂. En estado estacionario
 * `flowFactor = autoregulationFactor(PPC)·co2Factor(PaCO₂)`; la dinámica
 * (`RegulationDynamics`) los hace relajar con constantes de tiempo.
 */
export interface Regulation {
  readonly cvrAutoRatio: number;
  readonly co2Factor: number;
}

export function steadyRegulation(inp: HemodynamicInput): Regulation {
  const cpp = inp.mapMmHg - inp.icpMmHg;
  const cvrAutoRatio =
    cpp <= 0 ? CVR_MIN_RATIO : cpp / CPP0 / Math.max(Number.EPSILON, autoregulationFactor(cpp));
  return { cvrAutoRatio, co2Factor: co2Factor(inp.paco2MmHg) };
}

export function hemodynamics(
  inp: HemodynamicInput,
  regulation: Regulation = steadyRegulation(inp),
): HemodynamicState {
  const cppMmHg = inp.mapMmHg - inp.icpMmHg;
  const cvrRatio = regulation.cvrAutoRatio / Math.max(Number.EPSILON, regulation.co2Factor);
  const flowFactor = Math.max(0, cppMmHg) / CPP0 / Math.max(Number.EPSILON, cvrRatio);
  const crcpMmHg = inp.icpMmHg + vasomotorToneMmHg(cvrRatio);
  const pulsePressureMmHg = FISIOLOGIA.params.pulsePressureMmHg.value;
  const mean = shapeMean();
  const dbpMmHg = inp.mapMmHg - pulsePressureMmHg * mean;
  const pressureAt = (phase: number): number => dbpMmHg + pulsePressureMmHg * shapeAt(phase);
  const headroom = inp.mapMmHg - crcpMmHg;
  const { min, max } = shapeExtrema();
  const basal =
    Math.abs(inp.mapMmHg - MAP0) < 1e-9 &&
    Math.abs(inp.paco2MmHg - 40) < 1e-9 &&
    Math.abs(inp.icpMmHg - ICP0) < 1e-9;

  if (headroom > STARLING_DELTA_MMHG) {
    const waveform = (phase: number): number => (pressureAt(phase) - crcpMmHg) / headroom;
    const expectedPi = (pulsePressureMmHg * (max - min)) / headroom;
    return {
      cppMmHg,
      crcpMmHg,
      flowFactor,
      pulsePressureMmHg,
      waveform,
      expectedPi,
      basal,
      regime: 'normal',
      retrogradeFraction: 1,
    };
  }

  // DEC-80 — régimen de Starling: el lecho solo conduce cuando P(φ) > CrCP;
  // el lóbulo retrógrado es la descarga de la compliance arterial, acotada
  // para que el caudal neto por ciclo sea ≥ 0 y continuo con el régimen
  // normal (media 1 en la frontera, → A⁺/δ cuando nada supera la CrCP).
  let forwardArea = 0;
  let backwardArea = 0;
  for (let i = 0; i < CYCLE_SAMPLES; i++) {
    const d = pressureAt(i / CYCLE_SAMPLES) - crcpMmHg;
    if (d > 0) forwardArea += d;
    else backwardArea -= d;
  }
  forwardArea /= CYCLE_SAMPLES;
  backwardArea /= CYCLE_SAMPLES;
  // Caudal neto objetivo: continuo con la frontera (δ) y proporcional al
  // factor de flujo cuando la PPC se agota; el resto del volumen sistólico lo
  // devuelve la compliance como lóbulo retrógrado (área, no amplitud).
  const netAreaMmHg = Math.min(STARLING_DELTA_MMHG, forwardArea * flowFactor);
  const retrogradeFraction =
    backwardArea <= 0 ? 0 : Math.min(1, Math.max(0, (forwardArea - netAreaMmHg) / backwardArea));
  const waveform = (phase: number): number => {
    const d = pressureAt(phase) - crcpMmHg;
    return (d > 0 ? d : retrogradeFraction * d) / STARLING_DELTA_MMHG;
  };
  const expectedPi = (pulsePressureMmHg * (max - min)) / STARLING_DELTA_MMHG;
  return {
    cppMmHg,
    crcpMmHg,
    flowFactor,
    pulsePressureMmHg,
    waveform,
    expectedPi,
    basal,
    regime: 'starling',
    retrogradeFraction,
  };
}

export function onsdForIcpMm(basalMm: number, icpMmHg: number): number {
  return Math.min(
    FISIOLOGIA.params.onsdMaxMm.value,
    basalMm + FISIOLOGIA.params.onsdSlopeMmPerMmHg.value * Math.max(0, icpMmHg - 10),
  );
}
