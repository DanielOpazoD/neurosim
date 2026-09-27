export interface WindkesselParams {
  periodS: number;
  ejectionFraction: number;
  tauS: number;
  backflowFraction: number;
  backflowDurationFraction: number;
}

function inflow(phase: number, p: WindkesselParams): number {
  const ejectionEnd = Math.max(0, Math.min(1, p.ejectionFraction));
  const backflowDuration = Math.max(0, Math.min(1 - ejectionEnd, p.backflowDurationFraction));
  const backflowEnd = ejectionEnd + backflowDuration;
  const reboundEnd = backflowEnd + backflowDuration;
  if (phase < ejectionEnd) {
    const ejectionPhase = phase / Math.max(1e-6, ejectionEnd);
    return Math.sin(Math.PI * ejectionPhase) * Math.exp(-3 * ejectionPhase);
  }
  if (phase < backflowEnd) return -p.backflowFraction;
  if (phase < reboundEnd) return p.backflowFraction * 3;
  return 0;
}

/** Genera una tabla periódica normalizada de presión Windkessel en estado estable. */
export function windkesselShapeTable(p: WindkesselParams, samples = 512): Float32Array {
  const table = new Float32Array(samples);
  const integrationSteps = Math.max(samples * 4, 1024);
  const dt = p.periodS / integrationSteps;
  const cycles = 8;
  let pressure = 0;

  for (let step = 0; step < cycles * integrationSteps; step += 1) {
    const phase = (step % integrationSteps) / integrationSteps;
    const nextPhase = ((step + 0.5) % integrationSteps) / integrationSteps;
    const slope = (value: number, at: number) => inflow(at, p) - value / Math.max(1e-6, p.tauS);
    const midpoint = pressure + 0.5 * dt * slope(pressure, phase);
    pressure += dt * slope(midpoint, nextPhase);
    if (step >= (cycles - 1) * integrationSteps) {
      const sample = Math.floor(((step - (cycles - 1) * integrationSteps) * samples) / integrationSteps);
      if (sample < samples) table[sample] = pressure;
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of table) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = Math.max(1e-9, max - min);
  for (let i = 0; i < samples; i += 1) table[i] = (table[i]! - min) / span;
  return table;
}

/** Interpolación lineal periódica de la tabla de forma de onda. */
export function sampleShape(table: Float32Array, phase: number): number {
  if (table.length === 0) return 0;
  const p = ((phase % 1) + 1) % 1;
  const position = p * table.length;
  const left = Math.floor(position) % table.length;
  const right = (left + 1) % table.length;
  const fraction = position - Math.floor(position);
  return table[left]! * (1 - fraction) + table[right]! * fraction;
}
