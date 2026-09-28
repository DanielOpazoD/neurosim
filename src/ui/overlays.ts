/**
 * Ayudas de presentación para canvas, espectro y lecturas del panel.
 * No contiene adquisición ni estado físico propio.
 */
import { fromEyeLocal, nerveCenterline, trueOnsdMm } from '../anatomy/eye';
import { add, scale } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import { ANATOMIA_OJO } from '../anatomy/params';
import type { AcquiredFrame } from '../domain/contracts';
import { drawSpectrum } from './canvasDraw';
import type { ScanGeometry } from '../ultrasound/probe';
import { beamDirAt, LINEAR_APERTURE_MM, patientToImage } from '../ultrasound/probe';
import { currentPose } from '../app/poses';
import type { AppState } from '../app/state';
import { imagePointToCanvas, canvasToImagePoint, dteGuide } from '../app/measurements';
import { buildReport } from '../domain/onsdProtocol';
import type { PwController } from '../app/pwController';
import { angleCorrectionErrorFactor } from '../doppler/insonation';
import { acousticOutput } from '../ultrasound/acousticOutput';
import { lindegaardRatio, observedTrace } from '../doppler/measureMca';
import { DOPPLER } from '../doppler/params';

export { canvasToImagePoint, imagePointToCanvas };

/** Contorno de la caja de Doppler color (sector: arcos+radiales; lineal: rectángulo). */
export function drawColorBox(
  ctx: CanvasRenderingContext2D,
  s: AppState,
  box: { uCenter: number; uHalf: number; zMinMm: number; zMaxMm: number },
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const uMin = box.uCenter - box.uHalf;
  const uMax = box.uCenter + box.uHalf;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (s.settings.transducer === 'linear') {
    const x0 = (uMin / LINEAR_APERTURE_MM + 0.5) * W;
    const x1 = (uMax / LINEAR_APERTURE_MM + 0.5) * W;
    const y0 = (box.zMinMm / s.settings.depthMm) * H;
    const y1 = (box.zMaxMm / s.settings.depthMm) * H;
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else {
    const cx = W / 2;
    const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.settings.depthMm;
    const px = (u: number, z: number): [number, number] => [
      cx + Math.sin(u) * z * scalePx,
      Math.cos(u) * z * scalePx,
    ];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = uMin + (i / steps) * (uMax - uMin);
      const [x, y] = px(u, box.zMinMm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    {
      const [x1, y1] = px(uMax, box.zMaxMm);
      ctx.lineTo(x1, y1);
    }
    for (let i = steps; i >= 0; i--) {
      const u = uMin + (i / steps) * (uMax - uMin);
      const [x, y] = px(u, box.zMaxMm);
      ctx.lineTo(x, y);
    }
    const [x0, y0] = px(uMin, box.zMinMm);
    ctx.lineTo(x0, y0);
  }
  ctx.stroke();
}

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
  if (s.station !== 'ojo' || !currentFrame) return;
  if (s.caliperMode === 'dte') {
    const [a, b] = dteGuide(sim, s);
    const [x1, y1] = imagePointToCanvas(a, s, ctx.canvas.width, ctx.canvas.height);
    const [x2, y2] = imagePointToCanvas(b, s, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = 'rgba(77,163,255,0.8)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(77,163,255,0.9)';
    ctx.fillText(`DTE ${s.side}`, x1 + 8, y1 - 4);
    return;
  }
  if (s.caliperMode !== 'dvno') return;
  const eye = sim.eyes[s.side];
  const patient = fromEyeLocal(eye, nerveCenterline(eye, ANATOMIA_OJO.params.onsdOffsetMm.value));
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
  if (!s.pwOn || !chain || controller.chainSceneKey !== `${s.station}-${s.side}`) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!s.pwOn) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Activa PW para el espectro', 16, 24);
    }
    return;
  }
  drawSpectrum(ctx, chain.spectral.columns, {
    fftSize: chain.spectral.fftSize,
    baseline: s.settings.baseline,
    f0Mhz: s.settings.frequencyMhz,
    angleCorrectionDeg: s.settings.angleCorrectionDeg,
    invert: s.settings.invertColor,
    gainDb: s.settings.spectralGainDb,
    drDb: s.settings.dynamicRangeDb,
    floorOffsetDb: DOPPLER.params.spectralFloorOffsetDb.value,
    sweepSeconds: s.sweepSeconds,
    gamma: DOPPLER.params.spectralGammaDisplay.value,
    floorPercentile: DOPPLER.params.spectralFloorPercentile.value,
    colormap: s.spectralColormap,
    teachingTrace: s.teachingMode
      ? observedTrace(chain.spectral.columns.slice(-400), {
          f0Hz: s.settings.frequencyMhz * 1e6,
          angleCorrectionRad: (s.settings.angleCorrectionDeg * Math.PI) / 180,
          invert: s.settings.invertColor,
          fftSize: chain.spectral.fftSize,
          wallFilterHz: s.settings.wallFilterHz,
        })
      : undefined,
  });
}

const row = (k: string, v: string) => `<div><span>${k}</span><span class="meas">${v}</span></div>`;

export function updateReadouts(
  el: HTMLElement,
  sim: ReferenceCase,
  s: AppState,
  controller: PwController,
): void {
  const summary = controller.latestMcaMeasure();
  const angle = s.teachingMode ? controller.insonation() : null;
  const angleRows =
    angle && angle.vesselId && Number.isFinite(angle.realDeg)
      ? [
          row(
            'Insonación',
            `θ real ${angle.realDeg.toFixed(0)}° · proyectado ${angle.projectedDeg.toFixed(0)}° · corrección ${s.settings.angleCorrectionDeg.toFixed(0)}° → factor ×${angleCorrectionErrorFactor(angle.realDeg, s.settings.angleCorrectionDeg).toFixed(2)}`,
          ),
        ]
      : [];
  const hemo = s.teachingMode ? controller.hemodynamics() : null;
  const hemoRows = hemo
    ? [
        row(
          'Hemodinámica',
          `PPC ${hemo.cppMmHg.toFixed(0)} · CrCP ${hemo.crcpMmHg.toFixed(0)} · flujo ×${hemo.flowFactor.toFixed(2)} · PI esp. ${hemo.expectedPi.toFixed(2)}`,
        ),
      ]
    : [];
  const alara = acousticOutput({
    transducer: s.settings.transducer,
    station: s.station,
    mode: s.pwOn ? 'pw' : 'color',
    frequencyMhz: s.settings.frequencyMhz,
    focusMm: s.settings.focusMm,
    prfHz: s.settings.prfHz,
    gateMm: s.settings.gateMm,
    outputPowerDb: s.settings.outputPowerDb,
  });
  const alaraRows =
    s.teachingMode && alara.ocularLimitExceeded
      ? [row('ALARA', 'supera límite oftálmico (MI ≤ 0,23 · TI ≤ 1,0)')]
      : [];
  const report = buildReport(s.onsd);
  const reportRows =
    s.station === 'ojo' && (s.onsdActive || report.complete)
      ? [
          row(
            'Protocolo DVNO',
            s.onsdActive
              ? s.caliperMode === 'dte'
                ? `DTE ${s.side}`
                : `${s.side} · ${planeForLabel(s.rotDeg)}`
              : 'completo',
          ),
          row(
            'Informe',
            report.complete
              ? `ratio ${((report.perSide.der.ratio! + report.perSide.izq.ratio!) / 2).toFixed(2)}`
              : `faltan ${report.flags.includes('plano-incompleto') ? 'DVNO' : 'DTE'}`,
          ),
          ...(s.teachingMode
            ? [
                row(
                  'DVNO real (modelo)',
                  `der ${trueOnsdMm(sim.eyes.der, 3, 'interno').toFixed(2)} · izq ${trueOnsdMm(sim.eyes.izq, 3, 'interno').toFixed(2)}`,
                ),
              ]
            : []),
          ...(s.onsdWarning ? [row('Aviso', 'Plano/lado no coincide con el paso del protocolo')] : []),
        ]
      : [];
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
      ...(comp?.dominantVesselId?.startsWith('m1-')
        ? [
            row(
              'Lindegaard',
              `TAMax ${Math.abs(summary.taMaxCms).toFixed(0)} / ACI ${sim.clinicalCase.icaExtracranialTamaxCms.toFixed(0)} = ${lindegaardRatio(summary.taMaxCms, sim.clinicalCase.icaExtracranialTamaxCms).toFixed(1)}`,
            ),
          ]
        : []),
      ...angleRows,
      ...hemoRows,
      ...alaraRows,
      ...reportRows,
    ].join('');
    return;
  }
  if (s.measurements.length) {
    const last = s.measurements[s.measurements.length - 1]!;
    el.innerHTML = [
      row(
        last.kind === 'dvno' ? `DVNO ${last.convention ?? ''}` : last.kind === 'dte' ? 'DTE' : 'Distancia',
        `${last.value.toFixed(2)} mm`,
      ),
      row('Cuadro', `t=${last.frameTSeconds.toFixed(2)} s`),
      row('Ref. retroglobo', `${last.referenceOffsetMm ?? '—'} mm`),
      row('Medidas', `${s.measurements.length}`),
    ].join('');
  } else {
    el.innerHTML = [...angleRows, ...hemoRows, ...alaraRows, ...reportRows, row('Sin medidas', '—')].join('');
  }
}

function planeForLabel(rotDeg: number): string {
  const mod = ((rotDeg % 180) + 180) % 180;
  return mod < 45 || mod >= 135 ? 'transversal' : 'sagital';
}
