import { fromEyeLocal, nerveCenterline, sheathRadiiAt } from '../anatomy/eye';
import { vesselFlowDir } from '../anatomy/head';
import { add, scale, dot, cross, normalize, type Vec3 } from '../core/vec3';
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
  fill?: string;
  polygon?: readonly Vec3[];
}

export interface NavigatorFrame {
  readonly target: Vec3;
  readonly radiusMm: number;
  readonly scale: number;
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
    : { yawDeg: side === 'der' ? -70 : 70, pitchDeg: -4 };
}

function vesselCenter(sim: ReferenceCase): Vec3 {
  const points = sim.head.vessels.flatMap((vessel) => vessel.points);
  if (!points.length) return sim.head.midbrainCenter;
  const sum = points.reduce((acc, point) => add(acc, point), [0, 0, 0] as Vec3);
  return scale(sum, 1 / points.length);
}

export function navigatorFrame(
  sim: ReferenceCase,
  station: 'ojo' | 'temporal',
  side: 'der' | 'izq',
  canvasSide: number,
): NavigatorFrame {
  const target =
    station === 'ojo' ? add(sim.eyes[side].center, scale(sim.eyes[side].anterior, -8)) : vesselCenter(sim);
  const radiusMm = station === 'ojo' ? 28 : 55;
  return { target, radiusMm, scale: (0.46 * canvasSide) / radiusMm };
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

function polygonSegment(points: readonly Vec3[], color: string, width: number, fill: string): Segment {
  return {
    a: points[0]!,
    b: points[1] ?? points[0]!,
    color,
    width,
    fill,
    polygon: points,
  };
}

function circleSegments(
  center: Vec3,
  axisA: Vec3,
  axisB: Vec3,
  radiusA: number,
  radiusB: number,
  color: string,
  width = 1,
  steps = 24,
): Segment[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push(add(center, add(scale(axisA, Math.cos(t) * radiusA), scale(axisB, Math.sin(t) * radiusB))));
  }
  return lineSegments(points, color, width);
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
        1,
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
    segments.push(...lineSegments(points, 'rgba(220,235,245,0.45)', 1));
  }
  const nerve: Vec3[] = [];
  const sheathA: Vec3[] = [];
  const sheathB: Vec3[] = [];
  for (let i = 0; i <= 30; i++) {
    const local = nerveCenterline(eye, i);
    const r = sheathRadiiAt(eye, i).major;
    nerve.push(fromEyeLocal(eye, local));
    sheathA.push(fromEyeLocal(eye, [local[0] - r, local[1], local[2]]));
    sheathB.push(fromEyeLocal(eye, [local[0] + r, local[1], local[2]]));
  }
  segments.push(...lineSegments(nerve, '#e8b44a', 1.5));
  segments.push(...lineSegments(sheathA, 'rgba(232,180,74,0.8)', 1.5));
  segments.push(...lineSegments(sheathB, 'rgba(232,180,74,0.8)', 1.5));
  const mark = fromEyeLocal(eye, nerveCenterline(eye, 3));
  segments.push({
    a: add(mark, scale(eye.superior, -2)),
    b: add(mark, scale(eye.superior, 2)),
    color: '#e8b44a',
    width: 1.5,
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
    segments.push(
      ...lineSegments(vessel.points, toward ? '#e85d5d' : '#4da3ff', vessel.id.startsWith('m1-') ? 3 : 2),
    );
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
  gateMm: number,
  gateCenter: Vec3 | null,
): Segment[] {
  const segments: Segment[] = [];
  const first = scan.lines[0]!;
  const last = scan.lines[scan.lines.length - 1]!;
  const start = scan.kind === 'linear' ? first.origin : scan.apex;
  const elevation = normalize(cross(scan.axialDir, scan.lateralDir));
  const nearA =
    scan.kind === 'linear' ? add(first.origin, scale(elevation, -2)) : add(scan.apex, scale(first.dir, 1));
  const nearB =
    scan.kind === 'linear' ? add(last.origin, scale(elevation, 2)) : add(scan.apex, scale(last.dir, 1));
  const endA = add(first.origin, scale(first.dir, depthMm));
  const endB = add(last.origin, scale(last.dir, depthMm));
  segments.push(
    polygonSegment([nearA, nearB, endB, endA], 'rgba(90,160,255,0.85)', 1.5, 'rgba(90,160,255,0.18)'),
  );
  const footprint =
    scan.kind === 'linear'
      ? [
          add(first.origin, scale(elevation, -2)),
          add(last.origin, scale(elevation, -2)),
          add(last.origin, scale(elevation, 2)),
          add(first.origin, scale(elevation, 2)),
        ]
      : [
          add(scan.apex, scale(first.dir, 1)),
          add(scan.apex, scale(last.dir, 1)),
          add(scan.apex, scale(last.dir, 4)),
          add(scan.apex, scale(first.dir, 4)),
        ];
  segments.push(polygonSegment(footprint, '#dfe5ea', 1, 'rgba(220,225,230,0.72)'));
  segments.push({
    a: add(scan.apex, scale(scan.lateralDir, -0.8)),
    b: add(scan.apex, scale(scan.lateralDir, 0.8)),
    color: '#59636d',
    width: 2,
  });
  const focus = add(start, scale(scan.axialDir, focusMm));
  segments.push({
    a: add(focus, scale(scan.lateralDir, -3)),
    b: add(focus, scale(scan.lateralDir, 3)),
    color: '#e8b44a',
    width: 1.5,
    dash: [4, 3],
  });
  if (gateCenter) {
    const halfGate = gateMm / 2;
    const halfElevation = 1.5;
    segments.push(
      polygonSegment(
        [
          add(add(gateCenter, scale(scan.lateralDir, -halfGate)), scale(elevation, -halfElevation)),
          add(add(gateCenter, scale(scan.lateralDir, halfGate)), scale(elevation, -halfElevation)),
          add(add(gateCenter, scale(scan.lateralDir, halfGate)), scale(elevation, halfElevation)),
          add(add(gateCenter, scale(scan.lateralDir, -halfGate)), scale(elevation, halfElevation)),
        ],
        '#e6b65a',
        1.5,
        'rgba(230,182,90,0.72)',
      ),
    );
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
  const points = segment.polygon ?? [segment.a, segment.b];
  const projected = points.map((point) => project(point, { ...camera, scale: fit }));
  ctx.strokeStyle = segment.color;
  ctx.lineWidth = segment.width;
  ctx.setLineDash(segment.dash ? [...segment.dash] : []);
  ctx.beginPath();
  ctx.moveTo(centerX + projected[0]!.x, centerY + projected[0]!.y);
  for (const point of projected.slice(1)) ctx.lineTo(centerX + point.x, centerY + point.y);
  if (segment.polygon) {
    ctx.closePath();
    if (segment.fill) {
      ctx.fillStyle = segment.fill;
      ctx.fill();
    }
  }
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
  const frame = navigatorFrame(sim, s.station, s.side, Math.min(width, height));
  const baseCamera: ProjectionCamera = { ...cameraState, target: frame.target };
  const segments = [
    ...(s.station === 'ojo'
      ? eyeSegments(sim, s.side)
      : temporalSegments(sim, s.side, currentPose(sim, s).forward)),
    ...(scan
      ? probeSegments(scan, s.settings.depthMm, s.settings.focusMm, s.settings.gateMm, gateCenter)
      : []),
  ];
  const sorted = segments
    .map((segment) => ({
      segment,
      depth: (project(segment.a, baseCamera).depth + project(segment.b, baseCamera).depth) / 2,
    }))
    .sort((a, b) => b.depth - a.depth);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (const item of sorted) {
    drawSegment(ctx, item.segment, baseCamera, width / 2, height / 2, frame.scale);
  }
  if (scan) {
    const marker = project(scan.apex, { ...baseCamera, scale: frame.scale });
    ctx.fillStyle = '#59636d';
    ctx.beginPath();
    ctx.arc(width / 2 + marker.x, height / 2 + marker.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#8b939c';
  ctx.font = '11px system-ui';
  ctx.fillText(s.station === 'ojo' ? `Ojo ${s.side}` : `Temporal ${s.side}`, 8, 16);
  ctx.fillText(
    `yaw ${cameraState.yawDeg.toFixed(0)}° · pitch ${cameraState.pitchDeg.toFixed(0)}°`,
    8,
    height - 8,
  );
}
