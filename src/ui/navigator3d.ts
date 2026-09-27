import { fromEyeLocal, nerveCenterline, sheathRadiiAt } from '../anatomy/eye';
import { vesselFlowDir } from '../anatomy/head';
import { add, scale, dot, type Vec3 } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AppState } from '../app/state';
import type { ScanGeometry } from '../ultrasound/probe';
import { currentPose } from '../app/poses';
import { project, type ProjectionCamera } from './projection';

interface Segment {
  a: Vec3;
  b: Vec3;
  color: string;
  width: number;
  dash?: readonly number[];
}

const eyePreset: ProjectionCamera = { yawDeg: -25, pitchDeg: -18, scale: 1 };

export function navigatorCameraPreset(
  station: 'ojo' | 'temporal',
  side: 'der' | 'izq',
): {
  yawDeg: number;
  pitchDeg: number;
} {
  return station === 'ojo'
    ? { yawDeg: eyePreset.yawDeg, pitchDeg: eyePreset.pitchDeg }
    : { yawDeg: side === 'der' ? -90 : 90, pitchDeg: -4 };
}

function lineSegments(
  points: readonly Vec3[],
  color: string,
  width = 1.2,
  dash?: readonly number[],
): Segment[] {
  const result: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    result.push({ a: points[i]!, b: points[i + 1]!, color, width, dash });
  }
  return result;
}

function circleSegments(
  center: Vec3,
  axisA: Vec3,
  axisB: Vec3,
  radiusA: number,
  radiusB: number,
  color: string,
  steps = 24,
): Segment[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push(add(center, add(scale(axisA, Math.cos(t) * radiusA), scale(axisB, Math.sin(t) * radiusB))));
  }
  return lineSegments(points, color);
}

function eyeSegments(sim: ReferenceCase, side: 'der' | 'izq'): Segment[] {
  const eye = sim.eyes[side];
  const segments: Segment[] = [];
  for (const lat of [-0.7, 0, 0.7]) {
    segments.push(
      ...circleSegments(
        eye.center,
        eye.temporal,
        eye.superior,
        eye.globeRadiusMm * Math.cos(lat),
        eye.globeRadiusMm,
        'rgba(220,235,245,0.55)',
      ),
    );
  }
  for (const lon of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
    const points: Vec3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = -Math.PI / 2 + (i / 24) * Math.PI;
      points.push(
        add(
          eye.center,
          add(
            scale(eye.temporal, eye.globeRadiusMm * Math.cos(t) * Math.cos(lon)),
            add(
              scale(eye.superior, eye.globeRadiusMm * Math.sin(t)),
              scale(eye.anterior, eye.globeRadiusMm * Math.cos(t) * Math.sin(lon)),
            ),
          ),
        ),
      );
    }
    segments.push(...lineSegments(points, 'rgba(220,235,245,0.45)'));
  }
  const nerve: Vec3[] = [];
  const sheathA: Vec3[] = [];
  const sheathB: Vec3[] = [];
  for (let i = 0; i <= 30; i++) {
    const s = i;
    const local = nerveCenterline(eye, s);
    const r = sheathRadiiAt(eye, s).major;
    nerve.push(fromEyeLocal(eye, local));
    sheathA.push(fromEyeLocal(eye, [local[0] - r, local[1], local[2]]));
    sheathB.push(fromEyeLocal(eye, [local[0] + r, local[1], local[2]]));
  }
  segments.push(...lineSegments(nerve, '#e8b44a', 2));
  segments.push(...lineSegments(sheathA, 'rgba(232,180,74,0.8)'));
  segments.push(...lineSegments(sheathB, 'rgba(232,180,74,0.8)'));
  const mark = fromEyeLocal(eye, nerveCenterline(eye, 3));
  segments.push({
    a: add(mark, scale(eye.superior, -2)),
    b: add(mark, scale(eye.superior, 2)),
    color: '#e8b44a',
    width: 2,
    dash: [3, 3],
  });
  return segments;
}

function temporalSegments(sim: ReferenceCase, side: 'der' | 'izq', poseForward: Vec3): Segment[] {
  const h = sim.head;
  const segments: Segment[] = [];
  const [rx, ry, rz] = h.skullRadii;
  segments.push(...circleSegments(h.skullCenter, [1, 0, 0], [0, 1, 0], rx, ry, 'rgba(190,205,220,0.45)'));
  segments.push(...circleSegments(h.skullCenter, [0, 1, 0], [0, 0, 1], ry, rz, 'rgba(190,205,220,0.45)'));
  const window = h.windowCenter[side];
  segments.push(
    ...circleSegments(window, [1, 0, 0], [0, 1, 0], h.windowRadiusMm, h.windowRadiusMm, '#4da3ff'),
  );
  for (const vessel of h.vessels) {
    const flow = vesselFlowDir(vessel, vessel.points[0]!);
    const toward = dot(flow, poseForward) < 0;
    segments.push(...lineSegments(vessel.points, toward ? '#e85d5d' : '#4da3ff', 1.5));
  }
  segments.push(
    ...circleSegments(
      h.midbrainCenter,
      [1, 0, 0],
      [0, 1, 0],
      h.midbrainRadii[0],
      h.midbrainRadii[1],
      '#d79cff',
    ),
  );
  return segments;
}

function probeSegments(
  scan: ScanGeometry,
  depthMm: number,
  focusMm: number,
  gateCenter: Vec3 | null,
): Segment[] {
  const segments: Segment[] = [];
  const start = scan.kind === 'linear' ? scan.lines[0]!.origin : scan.apex;
  const endA = add(scan.lines[0]!.origin, scale(scan.lines[0]!.dir, depthMm));
  const endB = add(
    scan.lines[scan.lines.length - 1]!.origin,
    scale(scan.lines[scan.lines.length - 1]!.dir, depthMm),
  );
  const nearA = scan.kind === 'linear' ? scan.lines[0]!.origin : scan.apex;
  const nearB = scan.kind === 'linear' ? scan.lines[scan.lines.length - 1]!.origin : scan.apex;
  segments.push({ a: nearA, b: nearB, color: 'rgba(77,163,255,0.9)', width: 2 });
  segments.push({ a: nearA, b: endA, color: 'rgba(77,163,255,0.35)', width: 1 });
  segments.push({ a: endA, b: endB, color: 'rgba(77,163,255,0.45)', width: 1 });
  segments.push({ a: endB, b: nearB, color: 'rgba(77,163,255,0.35)', width: 1 });
  const focus = add(start, scale(scan.axialDir, focusMm));
  segments.push({ a: start, b: focus, color: '#e8b44a', width: 2, dash: [4, 3] });
  if (gateCenter) {
    segments.push({
      a: add(gateCenter, scale(scan.lateralDir, -2)),
      b: add(gateCenter, scale(scan.lateralDir, 2)),
      color: '#fff',
      width: 3,
    });
  }
  return segments;
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  camera: ProjectionCamera,
  centerX: number,
  centerY: number,
  fit: number,
): void {
  const a = project(segment.a, { ...camera, scale: fit });
  const b = project(segment.b, { ...camera, scale: fit });
  ctx.strokeStyle = segment.color;
  ctx.lineWidth = segment.width;
  ctx.setLineDash(segment.dash ? [...segment.dash] : []);
  ctx.beginPath();
  ctx.moveTo(centerX + a.x, centerY + a.y);
  ctx.lineTo(centerX + b.x, centerY + b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawNavigator(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  scan: ScanGeometry | null,
  cameraState: { yawDeg: number; pitchDeg: number },
  gateCenter: Vec3 | null,
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b0d0f';
  ctx.fillRect(0, 0, width, height);
  const target = s.station === 'ojo' ? sim.eyes[s.side].center : sim.head.skullCenter;
  const baseCamera: ProjectionCamera = { ...cameraState, target };
  const segments = [
    ...(s.station === 'ojo'
      ? eyeSegments(sim, s.side)
      : temporalSegments(sim, s.side, currentPose(sim, s).forward)),
    ...(scan ? probeSegments(scan, s.settings.depthMm, s.settings.focusMm, gateCenter) : []),
  ];
  const all = segments.flatMap((segment) => [segment.a, segment.b]);
  const projected = all.map((point) => project(point, baseCamera));
  const extent = Math.max(
    1,
    ...projected.map((point) => Math.abs(point.x)),
    ...projected.map((point) => Math.abs(point.y)),
  );
  const fit = (Math.min(width, height) * 0.42) / extent;
  const sorted = segments
    .map((segment) => ({
      segment,
      depth: (project(segment.a, baseCamera).depth + project(segment.b, baseCamera).depth) / 2,
    }))
    .sort((a, b) => b.depth - a.depth);
  for (const item of sorted) drawSegment(ctx, item.segment, baseCamera, width / 2, height / 2, fit);
  ctx.fillStyle = '#8b939c';
  ctx.font = '11px system-ui';
  ctx.fillText(s.station === 'ojo' ? `Ojo ${s.side}` : `Temporal ${s.side}`, 8, 16);
  ctx.fillText(
    `yaw ${cameraState.yawDeg.toFixed(0)}° · pitch ${cameraState.pitchDeg.toFixed(0)}°`,
    8,
    height - 8,
  );
}
