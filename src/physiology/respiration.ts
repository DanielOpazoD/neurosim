export class Respiration {
  constructor(readonly ratePerMin: number) {}

  get periodS(): number {
    return 60 / this.ratePerMin;
  }

  phaseAt(t: number): number {
    const phase = (t / this.periodS) % 1;
    return phase < 0 ? phase + 1 : phase;
  }

  /** Señal respiratoria en [-1,1]; positiva durante la inspiración. */
  signalAt(t: number): number {
    return Math.sin(2 * Math.PI * this.phaseAt(t));
  }
}
