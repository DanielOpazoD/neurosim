/**
 * Ayudas de presentación para canvas, espectro y lecturas del panel.
 * No contiene adquisición ni estado físico propio.
 */
import { fromEyeLocal, nerveCenterline } from '../anatomy/eye';
import { add, scale } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import { NEURO_PARAMS } from '../domain/parameters';
import type { AcquiredFrame } from '../domain/contracts';
import { drawSpectrum } from './canvasDraw';
import type { ScanGeometry } from '../ultrasound/probe';
import { beamDirAt, LINEAR_APERTURE_MM, patientToImage } from '../ultrasound/probe';
import { currentPose } from '../app/poses';
import type { AppState } from '../app/state';
import { imagePointToCanvas, canvasToImagePoint } from '../app/measurements';
import type { PwController } from '../app/pwController';

export { canvasToImagePoint, imagePointToCanvas };

export function drawGateMarker(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  scan: ScanGeometry,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pose = currentPose(sim, s);
  const center = add(pose.origin, scale(beamDirAt(pose, scan.kind, s.gateUMm), s.gateDepthMm));
  const { u, z } = patientToImage(pose, scan.kind, center);
  if (scan.kind === 'linear') {
    const x = (u / scan.widthMmOrRad + 0.5) * W;
    const y = (z / s.settings.depthMm) * H;
    ctx.strokeStyle = 'rgba(80,190,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.strokeRect(x - 8, y - 6, 16, 12);
  } else {
    const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.settings.depthMm;
    const x = W / 2 + Math.sin(u) * z * scalePx;
    const y = Math.cos(u) * z * scalePx;
    ctx.strokeStyle = 'rgba(80,190,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeRect(x - 8, y - 6, 16, 12);
  }
}

export function drawCaliperMarks(ctx: CanvasRenderingContext2D, s: AppState): void {
  for (const p of s.caliperPts) {
    const [x, y] = imagePointToCanvas(p, s, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
  }
  if (s.caliperPts.length === 2) {
    const [x1, y1] = imagePointToCanvas(s.caliperPts[0]!, s, ctx.canvas.width, ctx.canvas.height);
    const [x2, y2] = imagePointToCanvas(s.caliperPts[1]!, s, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

export function drawScale(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  currentFrame: AcquiredFrame | null,
): void {
  const H = ctx.canvas.height;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px monospace';
  for (let mm = 10; mm < s.settings.depthMm; mm += 10) {
    const y = (mm / s.settings.depthMm) * H;
    ctx.fillRect(4, y, 6, 1);
    ctx.fillText(`${mm} mm`, 12, y + 3);
  }
  if (s.station !== 'ojo' || s.caliperMode !== 'dvno' || !currentFrame) return;
  const eye = sim.eyes[s.side];
  const patient = fromEyeLocal(eye, nerveCenterline(eye, NEURO_PARAMS.params.onsdOffsetMm.value));
  const { u, z } = patientToImage(currentPose(sim, s), 'linear', patient);
  const W = ctx.canvas.width;
  const y = (z / s.settings.depthMm) * H;
  const x = (u / LINEAR_APERTURE_MM + 0.5) * W;
  ctx.strokeStyle = 'rgba(77,163,255,0.8)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(77,163,255,0.9)';
  ctx.fillText('3 mm retroglobo', x + 8, y - 4);
}

export function drawSpectral(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  controller: PwController,
): void {
  const chain = controller.currentChain;
  if (!s.pwOn || s.station !== 'temporal' || !chain) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!s.pwOn) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Activa PW (ventana temporal) para el espectro', 16, 24);
    }
    return;
  }
  drawSpectrum(ctx, chain.spectral.columns, {
    fftSize: chain.spectral.fftSize,
    baseline: s.settings.baseline,
    f0Mhz: s.settings.frequencyMhz,
    angleCorrectionDeg: s.settings.angleCorrectionDeg,
    invert: s.settings.invertColor,
    gainDb: s.settings.dopplerGainDb,
    windowSeconds: 5,
  });
}

const row = (k: string, v: string) => `<div><span>${k}</span><span class="meas">${v}</span></div>`;

export function updateReadouts(el: HTMLElement, s: AppState, controller: PwController): void {
  const summary = controller.latestMcaMeasure();
  if (summary) {
    const comp = controller.composition();
    el.innerHTML = [
      row('PSV', `${Math.abs(summary.psvCms).toFixed(0)} cm/s`),
      row('EDV', `${Math.abs(summary.edvCms).toFixed(0)} cm/s`),
      row('TAMax', `${Math.abs(summary.taMaxCms).toFixed(0)} cm/s`),
      row('PI (Gosling)', summary.pi.toFixed(2)),
      row('IR', summary.ri.toFixed(2)),
      row('Latidos', `${summary.beats}`),
      row('Sangre en puerta', `${((comp?.bloodFraction ?? 0) * 100).toFixed(0)}%`),
      row('Vaso dominante', comp?.dominantVesselId ?? '—'),
    ].join('');
    return;
  }
  if (s.measurements.length) {
    const last = s.measurements[s.measurements.length - 1]!;
    el.innerHTML = [
      row(
        last.kind === 'dvno' ? `DVNO ${last.convention ?? ''}` : 'Distancia',
        `${last.value.toFixed(2)} mm`,
      ),
      row('Cuadro', `t=${last.frameTSeconds.toFixed(2)} s`),
      row('Ref. retroglobo', `${last.referenceOffsetMm ?? '—'} mm`),
      row('Medidas', `${s.measurements.length}`),
    ].join('');
  } else {
    el.innerHTML = '<div><span>Sin medidas</span><span>—</span></div>';
  }
}
