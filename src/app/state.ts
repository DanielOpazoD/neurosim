/**
 * Estado mutable de la aplicación: equipo, adquisición, mediciones y cine.
 * La capa no conoce el DOM ni ejecuta física.
 */
import type { BModeFrame } from '../ultrasound/bmode';
import type { AcquisitionSettings, AcquiredFrame, Measurement, Side, Station } from '../domain/contracts';
import type { ImagePoint } from '../domain/measure';
import type { ScanGeometry } from '../ultrasound/probe';
import { defaultEyeSettings } from '../domain/settings';
import { createOnsdProtocolState, type OnsdProtocolState } from '../domain/onsdProtocol';
import { DebriefLog } from './debrief';

export interface CineItem {
  frame: AcquiredFrame;
  bmode: BModeFrame;
  scan: ScanGeometry;
}

export interface AppState {
  station: Station;
  side: Side;
  settings: AcquisitionSettings;
  offsetMm: number;
  tiltDeg: number;
  rotDeg: number;
  press: number;
  frozen: boolean;
  pwOn: boolean;
  handMotion: boolean;
  /** Reloj de simulación del frame actual (para micro-movimiento de mano). */
  tSec?: number;
  caliperMode: 'none' | 'dist' | 'dvno' | 'dte';
  onsdActive: boolean;
  onsdWarning: boolean;
  onsd: OnsdProtocolState;
  caliperPts: ImagePoint[];
  measurements: Measurement[];
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
  teachingMode: boolean;
  debrief: DebriefLog;
}

export function createInitialState(): AppState {
  return {
    station: 'ojo',
    side: 'der',
    settings: defaultEyeSettings(),
    offsetMm: 0,
    tiltDeg: 0,
    rotDeg: 0,
    press: 0.3,
    frozen: false,
    pwOn: false,
    handMotion: true,
    caliperMode: 'none',
    onsdActive: false,
    onsdWarning: false,
    onsd: createOnsdProtocolState(),
    caliperPts: [],
    measurements: [],
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
    teachingMode: false,
    debrief: new DebriefLog(0),
  };
}
