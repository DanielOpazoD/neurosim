// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/core/clock.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/**
 * Reloj único de simulación (guía §4 y base de conocimiento 10.1).
 *
 * Todo lo que ocurre en el paciente virtual —ECG, respiración, presiones, flujos,
 * movimiento anatómico, adquisición IQ, color, espectro y audio— toma el tiempo
 * de este objeto. No existe ningún otro contador de tiempo en el motor.
 *
 * El reloj avanza en pasos fijos de integración (`dt`) para que la fisiología
 * sea determinista con independencia de la cadencia de render. El render lee el
 * estado interpolado o el último estado integrado, nunca al revés.
 */
export class SimulationClock {
  /** Tiempo absoluto de simulación en segundos. */
  private _t = 0;
  /** Paso de integración en segundos (hoja consolidada: 4 ms, 250 Hz). */
  readonly dt: number;
  /** Número de pasos integrados desde el inicio. */
  private _step = 0;
  /** Acumulador de tiempo real pendiente de integrar. */
  private _pending = 0;
  private _paused = false;

  constructor(dt = 0.004) {
    if (!(dt > 0 && dt < 0.05)) throw new Error(`dt fuera de rango: ${dt}`);
    this.dt = dt;
  }

  get t(): number {
    return this._t;
  }

  get step(): number {
    return this._step;
  }

  get paused(): boolean {
    return this._paused;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  /**
   * Detiene el reloj en un tiempo absoluto (`?clock=fixed&t=…`, pruebas e2e).
   * `requestSteps` devuelve 0 a partir de entonces, así que `t` queda fijo.
   */
  freezeAt(t: number): void {
    this._step = Math.round(t / this.dt);
    this._t = this._step * this.dt;
    this._pending = 0;
    this._paused = true;
  }

  /**
   * Convierte tiempo real transcurrido en número de pasos de integración a
   * ejecutar. Devuelve cuántos pasos debe ejecutar el motor. Se limita a un
   * máximo por llamada para no acumular una deuda infinita si la pestaña
   * estuvo en segundo plano.
   */
  requestSteps(elapsedSeconds: number, maxSteps = 125): number {
    if (this._paused) return 0;
    this._pending += Math.max(0, elapsedSeconds);
    let n = Math.floor(this._pending / this.dt);
    if (n > maxSteps) {
      n = maxSteps;
      this._pending = 0;
    } else {
      this._pending -= n * this.dt;
    }
    return n;
  }

  /** Avanza un paso. Solo debe llamarlo el motor de simulación. */
  advance(): void {
    this._step += 1;
    this._t = this._step * this.dt;
  }

  /** Reinicia el reloj (se usa al cargar un caso con una semilla). */
  reset(): void {
    this._t = 0;
    this._step = 0;
    this._pending = 0;
  }
}
