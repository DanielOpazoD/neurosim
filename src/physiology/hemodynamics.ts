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

function co2Factor(paco2MmHg: number): number {
  const p = Math.max(20, Math.min(80, paco2MmHg));
  return Math.exp(CO2_K * (p - 40));
}

function autoregulationFactor(cppMmHg: number): number {
  const slope = FISIOLOGIA.params.autoregSlopePer10.value;
  if (cppMmHg < 50) return (0.95 * Math.max(0, cppMmHg)) / 50;
  if (cppMmHg <= 150) return 1 + ((cppMmHg - CPP0) / 10) * slope;
  return 1.15 * (cppMmHg / 150);
}

export function hemodynamics(inp: HemodynamicInput): HemodynamicState {
  const cppMmHg = inp.mapMmHg - inp.icpMmHg;
  const flowFactor = co2Factor(inp.paco2MmHg) * autoregulationFactor(cppMmHg);
  const cvrRatio = cppMmHg / CPP0 / Math.max(Number.EPSILON, flowFactor);
  const crcpMmHg = inp.icpMmHg + TONE * cvrRatio;
  const pulsePressureMmHg = FISIOLOGIA.params.pulsePressureMmHg.value;
  const mean = shapeMean();
  const dbpMmHg = inp.mapMmHg - pulsePressureMmHg * mean;
  const denominator = inp.mapMmHg <= crcpMmHg + 1 ? 1 : inp.mapMmHg - crcpMmHg;
  const waveform = (phase: number): number =>
    (dbpMmHg + pulsePressureMmHg * shapeAt(phase) - crcpMmHg) / denominator;
  const { min, max } = shapeExtrema();
  const expectedPi = (pulsePressureMmHg * (max - min)) / Math.max(1, inp.mapMmHg - crcpMmHg);
  const basal =
    Math.abs(inp.mapMmHg - MAP0) < 1e-9 &&
    Math.abs(inp.paco2MmHg - 40) < 1e-9 &&
    Math.abs(inp.icpMmHg - ICP0) < 1e-9;
  return { cppMmHg, crcpMmHg, flowFactor, pulsePressureMmHg, waveform, expectedPi, basal };
}

export function onsdForIcpMm(basalMm: number, icpMmHg: number): number {
  return Math.min(
    FISIOLOGIA.params.onsdMaxMm.value,
    basalMm + FISIOLOGIA.params.onsdSlopeMmPerMmHg.value * Math.max(0, icpMmHg - 10),
  );
}
