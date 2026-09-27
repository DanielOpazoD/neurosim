import { FISIOLOGIA } from '../physiology/params';
import { ANATOMIA_OJO } from '../anatomy/params';

const PHYS = FISIOLOGIA.params;
const EYE = ANATOMIA_OJO.params;

/**
 * Manifiesto ligero del caso de referencia N1 (plan §12.2): anatomía,
 * materiales, módulos portados con licencia y parámetros con evidencia.
 * Cambiar el manifiesto cambia `manifestVersion` y por tanto el paciente.
 */
export const MANIFEST = {
  version: '0.1.0',
  case: {
    id: 'adulto-referencia-n1',
    label: 'Adulto de referencia N1',
    physiology: {
      heartRateBpm: PHYS.heartRateBpm.value,
      mapMmHg: PHYS.mapMmHg.value,
      paco2MmHg: PHYS.paco2MmHg.value,
      icpMmHg: PHYS.icpMmHg.value,
    },
    dvnoIntMm: { der: EYE.dvnoIntDerMm.value, izq: EYE.dvnoIntIzqMm.value },
  },
  anatomy: ['src/anatomy/eye.ts', 'src/anatomy/head.ts', 'src/anatomy/materials.ts'],
  portedModules: [
    { file: 'src/core/clock.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/core/random.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/core/units.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/core/vec3.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/core/fft.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/core/evidence.ts', from: 'lus-sim@8ed8a6de918a', license: 'MIT' },
    { file: 'src/doppler/wallFilter.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    { file: 'src/doppler/spectral.ts', from: 'vexus-sim@59fb7b18e9c1', license: 'MIT' },
    {
      file: 'src/doppler/sampleVolume.ts',
      from: 'vexus-sim@59fb7b18e9c1',
      license: 'MIT',
      adapted: 'sin respiración; flujo por tubos del polígono de Willis',
    },
    {
      file: 'src/doppler/pwChain.ts',
      from: 'vexus-sim@59fb7b18e9c1',
      license: 'MIT',
      adapted: 'API PhysState / HeadGeometry / CerebralFlow',
    },
    {
      file: 'src/doppler/measureMca.ts',
      from: 'vexus-sim@59fb7b18e9c1 spectralMeasure.ts (traza/envolvente)',
      license: 'MIT',
      adapted: 'medidas cerebrales PSV/EDV/TAMax/PI/IR',
    },
  ],
  conventions: {
    units: 'mm, s, mmHg, cm/s en consola Doppler',
    frame: 'levógiro: +x = izquierda del paciente',
    onsd: 'interno (sin duramadre) por defecto; externo explícito si se usa',
    dopplerLabel: 'velocidades reales vs proyectadas vs corregidas se rotulan aparte',
  },
} as const;

export type Manifest = typeof MANIFEST;
