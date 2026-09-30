/**
 * Estado mutable de la aplicación: equipo, adquisición, mediciones y cine.
 * La capa no conoce el DOM ni ejecuta física.
 */
import type { BModeFrame } from '../ultrasound/bmode';
import type {
  GrayMap,
  AcquisitionSettings,
  AcquiredFrame,
  Measurement,
  Side,
  Station,
} from '../domain/contracts';
import type { ImagePoint } from '../domain/measure';
import type { ScanGeometry } from '../ultrasound/probe';
import { defaultEyeSettings } from '../domain/settings';
import { createOnsdProtocolState, type OnsdKey, type OnsdProtocolState } from '../domain/onsdProtocol';
import { DebriefLog } from './debrief';

/**
 * Medición confirmada sobre la imagen (DEC-61): puntos en coordenadas de
 * imagen del cuadro en que se trazó, etiqueta numerada y referencias al
 * hueco del protocolo DVNO para que una edición los mantenga coherentes.
 */
export interface CaliperEntry {
  /** Número visible («1», «2»…), creciente en la sesión. */
  readonly id: number;
  measurement: Measurement;
  a: ImagePoint;
  b: ImagePoint;
  /** Cuadro en el que se trazó (la edición recalcula sobre él). */
  readonly frame: AcquiredFrame;
  /** Pose y equipo al medir: en vivo solo se dibuja si no cambiaron. */
  readonly poseKey: string;
  /** Rótulo: «DVNO D transversal», «DTE I», «Distancia». */
  readonly tag: string;
  /** Hueco del protocolo DVNO / DTE que ocupa (si lo ocupa). */
  readonly onsdKey?: OnsdKey;
  readonly dteSide?: Side;
}

/**
 * Marca de caliper sobre la traza espectral (DEC-62): un punto (t, v).
 * `tSeconds` es el tiempo absoluto de la columna PW — la marca barre con la
 * traza — y `velocityCms` la velocidad física con signo (+ hacia la sonda),
 * independiente de `invert`/`baseline` de la presentación.
 */
export interface SpectralMark {
  /** Número visible compartido con los calibres de imagen (caliperSeq). */
  readonly id: number;
  tSeconds: number;
  velocityCms: number;
  /** Medición registrada en `s.measurements` (la edición la sustituye). */
  measurement: Measurement;
}

export interface CineItem {
  frame: AcquiredFrame;
  bmode: BModeFrame;
  scan: ScanGeometry;
}

/**
 * Métricas de trayectoria de la sonda (DEC-63): acumuladas por
 * `sampleProbeTrack` (en `src/app/debrief.ts`) y volcadas al debriefing y al
 * export. `last` guarda la pose de la última muestra — uso interno.
 */
export interface ProbeTrack {
  /** Camino angular acumulado |Δtilt|+|ΔtiltV|+|Δrot|, grados. */
  angularDeg: number;
  /** Camino lateral acumulado |Δoffset|+|ΔoffsetV|, mm. */
  lateralMm: number;
  /** Tiempo con la sonda moviéndose (muestras consecutivas distintas), s. */
  movingS: number;
  samples: number;
  last?: {
    t: number;
    tiltDeg: number;
    tiltVDeg: number;
    rotDeg: number;
    offsetMm: number;
    offsetVMm: number;
    press: number;
  };
}

/**
 * Última TAMax de ACI extracraneal medida por lado (ventana submandibular,
 * DEC-58): denominador del Lindegaard. `tSec` es el tiempo de simulación de
 * la última columna usada en la medida.
 */
export interface IcaMeasure {
  readonly taMaxCms: number;
  readonly psvCms: number;
  readonly edvCms: number;
  readonly ri: number;
  readonly beats: number;
  readonly vesselId: string;
  readonly tSec: number;
}

export interface AppState {
  station: Station;
  side: Side;
  settings: AcquisitionSettings;
  offsetMm: number;
  /** Deslizamiento de sonda sobre el eje de elevación (mm). */
  offsetVMm: number;
  tiltDeg: number;
  /** Angulación en el plano de elevación (izda/dcha) en grados. */
  tiltVDeg: number;
  rotDeg: number;
  press: number;
  frozen: boolean;
  pwOn: boolean;
  /** Doppler color como modo explícito (DEC-54): apagado por defecto. */
  colorOn: boolean;
  /** Reloj de simulación del frame actual. */
  tSec?: number;
  caliperMode: 'none' | 'dist' | 'dvno' | 'dte';
  onsdActive: boolean;
  onsdWarning: boolean;
  onsd: OnsdProtocolState;
  caliperPts: ImagePoint[];
  measurements: Measurement[];
  /** Mediciones dibujables/editables sobre la imagen (DEC-61). */
  caliperEntries: CaliperEntry[];
  /** Marcas de velocidad sobre la traza espectral PW (DEC-62). */
  spectralMarks: SpectralMark[];
  /** Siguiente número de etiqueta. */
  caliperSeq: number;
  cine: CineItem[];
  cinePlaying: boolean;
  cineIdx: number;
  currentFrame: AcquiredFrame | null;
  gateDepthMm: number;
  gateUMm: number;
  audioOn: boolean;
  volume: number;
  sweepSeconds: 2 | 3 | 4 | 6;
  spectralColormap: 'gris' | 'ambar';
  renderer: 'cpu' | 'gpu';
  /** Persistencia B-mode (0–4): promedio temporal de fotogramas en dB. */
  persistence: 0 | 1 | 2 | 3 | 4;
  /** Mapa de grises del B-mode (post-compresión, presentación). */
  grayMap: GrayMap;
  teachingMode: boolean;
  debrief: DebriefLog;
  /** Métricas de ergonomía de la sonda (DEC-63); `sampleProbeTrack` las acumula. */
  probeTrack: ProbeTrack;
  /** ACI medida por lado (Lindegaard medido, DEC-58); null sin medida. */
  icaMeasured: Record<Side, IcaMeasure | null>;
}

export function createInitialState(): AppState {
  return {
    station: 'ojo',
    side: 'der',
    settings: defaultEyeSettings(),
    offsetMm: 0,
    offsetVMm: 0,
    tiltDeg: 0,
    tiltVDeg: 0,
    rotDeg: 0,
    press: 0.3,
    frozen: false,
    pwOn: false,
    colorOn: false,
    caliperMode: 'none',
    onsdActive: false,
    onsdWarning: false,
    onsd: createOnsdProtocolState(),
    caliperPts: [],
    measurements: [],
    caliperEntries: [],
    spectralMarks: [],
    caliperSeq: 1,
    cine: [],
    cinePlaying: false,
    cineIdx: 0,
    currentFrame: null,
    gateDepthMm: 52,
    gateUMm: 0,
    audioOn: false,
    volume: 40,
    sweepSeconds: 4,
    spectralColormap: 'gris',
    renderer: 'cpu',
    persistence: 2,
    grayMap: 'sigmoide',
    teachingMode: false,
    debrief: new DebriefLog(0),
    probeTrack: { angularDeg: 0, lateralMm: 0, movingS: 0, samples: 0 },
    icaMeasured: { der: null, izq: null },
  };
}

/** Modo de imagen activo para la salida acústica: PW manda sobre color. */
export function imagingMode(s: Pick<AppState, 'pwOn' | 'colorOn'>): 'bmode' | 'color' | 'pw' {
  return s.pwOn ? 'pw' : s.colorOn ? 'color' : 'bmode';
}
