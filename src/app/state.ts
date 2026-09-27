/**
 * Estado mutable de la aplicación: equipo, adquisición, mediciones y cine.
 * La capa no conoce el DOM ni ejecuta física.
 */
import type { BModeFrame } from '../ultrasound/bmode';
import type { AcquisitionSettings, AcquiredFrame, Measurement, Side, Station } from '../domain/contracts';
import type { ImagePoint } from '../domain/measure';
import type { ScanGeometry } from '../ultrasound/probe';
import { defaultEyeSettings } from '../domain/settings';

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
  caliperMode: 'none' | 'dist' | 'dvno';
  caliperPts: ImagePoint[];
  measurements: Measurement[];
  cine: CineItem[];
  cinePlaying: boolean;
  cineIdx: number;
  currentFrame: AcquiredFrame | null;
  gateDepthMm: number;
  gateUMm: number;
  audioOn: boolean;
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
    caliperMode: 'none',
    caliperPts: [],
    measurements: [],
    cine: [],
    cinePlaying: false,
    cineIdx: 0,
    currentFrame: null,
    gateDepthMm: 52,
    gateUMm: 0,
    audioOn: false,
  };
}

export class Store {
  private readonly listeners = new Set<(state: AppState) => void>();

  constructor(private state: AppState = createInitialState()) {}

  get(): AppState {
    return this.state;
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(fn: (state: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
