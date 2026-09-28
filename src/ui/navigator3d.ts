/**
 * Navegador 3D (Three.js): cráneo/globos translúcidos, polígono de Willis
 * como tubos con color por sentido de flujo, sonda con marcador físico,
 * plano de imagen, foco, caja de color y puerta PW. La geometría estática
 * se describe con funciones puras (`describeStaticScene`) para que los
 * tests no necesiten WebGL.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fromEyeLocal, nerveCenterline, rectusPaths, sheathRadiiAt } from '../anatomy/eye';
import { diencephalonShapes, midbrainShapes, vesselFlowDir, type Vessel } from '../anatomy/head';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { imageToPatient } from '../ultrasound/probe';
import type { ScanGeometry } from '../ultrasound/probe';
import type { ColorBox, ProbePose, Side, Station } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AppState } from '../app/state';

export interface NavigatorFrame {
  readonly target: Vec3;
  readonly radiusMm: number;
  readonly scale: number;
}

const eyePreset = { yawDeg: -25, pitchDeg: -18 };

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

/** Dirección cámara→objetivo derivada de los presets yaw/pitch (convención de projection.ts). */
export function cameraViewDir(yawDeg: number, pitchDeg: number): Vec3 {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

// ── Descriptores puros de la escena estática ─────────────────────────────

export interface EllipsoidDesc {
  readonly center: Vec3;
  readonly radii: Vec3;
  readonly color: string;
  readonly opacity: number;
}
export interface TubeDesc {
  readonly points: readonly Vec3[];
  readonly radiusMm: number;
  readonly color: string;
  readonly opacity: number;
  readonly emissive: number;
  readonly vesselId?: string;
}
export interface DiscDesc {
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly radiusMm: number;
  readonly color: string;
  readonly opacity: number;
}
export interface BoxDesc {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly color: string;
  readonly opacity: number;
}
export interface RingDesc {
  readonly center: Vec3;
  readonly tangent: Vec3;
  readonly innerMm: number;
  readonly outerMm: number;
  readonly color: string;
}
export interface BandDesc {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radiusMm: number;
  readonly color: string;
  readonly opacity: number;
}
export interface LensDesc {
  readonly center: Vec3;
  readonly axis: Vec3;
  readonly equatorMm: number;
  readonly halfThicknessMm: number;
  readonly color: string;
  readonly opacity: number;
}
export interface ConeDesc {
  readonly apex: Vec3;
  readonly baseCenter: Vec3;
  readonly baseRadiusMm: number;
  readonly color: string;
  readonly opacity: number;
}
export interface LabelDesc {
  readonly position: Vec3;
  readonly text: string;
}

export interface SceneDescriptor {
  readonly ellipsoids: EllipsoidDesc[];
  readonly tubes: TubeDesc[];
  readonly discs: DiscDesc[];
  readonly boxes: BoxDesc[];
  readonly rings: RingDesc[];
  readonly bands: BandDesc[];
  readonly lenses: LensDesc[];
  readonly cones: ConeDesc[];
  readonly labels: LabelDesc[];
}

const EMPTY: SceneDescriptor = {
  ellipsoids: [],
  tubes: [],
  discs: [],
  boxes: [],
  rings: [],
  bands: [],
  lenses: [],
  cones: [],
  labels: [],
};

function describeHead(sim: ReferenceCase): SceneDescriptor {
  const h = sim.head;
  const [rx, ry, rz] = h.skullRadii;
  const c = h.skullCenter;
  const ellipsoids: EllipsoidDesc[] = [
    { center: c, radii: h.skullRadii, color: '#b9c0c8', opacity: 0.18 },
    {
      center: c,
      radii: [rx + 7, ry + 7, rz + 7] as Vec3,
      color: '#c9a58a',
      opacity: 0.12,
    },
    ...midbrainShapes(h).map((s) => ({ ...s, color: '#c58cff', opacity: 0.55 })),
    ...diencephalonShapes(h).thalami.map((s) => ({ ...s, color: '#8f7bd6', opacity: 0.35 })),
  ];
  const ventricle = diencephalonShapes(h).ventricle;
  const boxes: BoxDesc[] = [
    {
      center: ventricle.center,
      size: [ventricle.half[0] * 2, ventricle.half[1] * 2, ventricle.half[2] * 2] as Vec3,
      color: '#8f7bd6',
      opacity: 0.35,
    },
    // Hoz: lámina dural sagital sobre el nivel del cuerpo calloso.
    {
      center: [c[0], h.midbrainCenter[1] + 8 + ry * 0.28, c[2]] as Vec3,
      size: [0.4, ry * 0.56, rz * 0.8] as Vec3,
      color: '#e0e0e0',
      opacity: 0.2,
    },
  ];
  const discs: DiscDesc[] = (['der', 'izq'] as const).map((side) => {
    const wc = h.windowCenter[side];
    const n = normalize([(wc[0] - c[0]) / (rx * rx), (wc[1] - c[1]) / (ry * ry), (wc[2] - c[2]) / (rz * rz)]);
    return { center: wc, normal: n, radiusMm: h.windowRadiusMm, color: '#4da3ff', opacity: 0.35 };
  });
  const tubes: TubeDesc[] = h.vessels.map((v) => ({
    points: v.points,
    radiusMm: v.radiusMm,
    color: '#e85d5d',
    opacity: 1,
    emissive: 0.25,
    vesselId: v.id,
  }));
  const labels: LabelDesc[] = [
    { position: [c[0], c[1], c[2] + rz + 4], text: 'ANT' },
    { position: [c[0], c[1] + ry + 4, c[2]], text: 'SUP' },
    { position: [c[0] + rx + 4, c[1], c[2]], text: 'IZQ' },
  ];
  return { ...EMPTY, ellipsoids, tubes, discs, boxes, labels };
}

function describeEye(sim: ReferenceCase, side: Side): SceneDescriptor {
  const eye = sim.eyes[side];
  const r = eye.globeRadiusMm;
  const nervePts: Vec3[] = [];
  const sheathPts: Vec3[] = [];
  for (let s = 0; s <= 35; s += 1) {
    nervePts.push(fromEyeLocal(eye, nerveCenterline(eye, s)));
    sheathPts.push(fromEyeLocal(eye, nerveCenterline(eye, s)));
  }
  const ringLocal = nerveCenterline(eye, 3);
  const ringAhead = nerveCenterline(eye, 3.5);
  const rings: RingDesc[] = [
    {
      center: fromEyeLocal(eye, ringLocal),
      tangent: normalize(sub(ringAhead, ringLocal)),
      innerMm: 0.8,
      outerMm: 1.6,
      color: '#ffd77a',
    },
  ];
  const bands: BandDesc[] = rectusPaths(eye).map((p) => ({
    from: p.insertion,
    to: p.apex,
    radiusMm: 1.4,
    color: '#b5556b',
    opacity: 0.45,
  }));
  const cones: ConeDesc[] = [
    {
      apex: fromEyeLocal(eye, [-1.5, -0.5, -(r + 42)]),
      baseCenter: fromEyeLocal(eye, [0, 0, 2]),
      baseRadiusMm: 17,
      color: '#5a636d',
      opacity: 0.25,
    },
  ];
  return {
    ...EMPTY,
    ellipsoids: [
      { center: eye.center, radii: [r, r, r], color: '#e8eef4', opacity: 0.35 },
      {
        center: fromEyeLocal(eye, [0, 0, r - 7.8 + 2.6]),
        radii: [7.8, 7.8, 7.8],
        color: '#e8eef4',
        opacity: 0.25,
      },
    ],
    tubes: [
      {
        points: nervePts,
        radiusMm: eye.nerveRadiusMm,
        color: '#e8b44a',
        opacity: 0.8,
        emissive: 0.15,
      },
      {
        points: sheathPts,
        radiusMm: sheathRadiiAt(eye, 3).major,
        color: '#e8b44a',
        opacity: 0.25,
        emissive: 0,
      },
    ],
    lenses: [
      {
        center: fromEyeLocal(eye, [0, 0, r - 6]),
        axis: eye.anterior,
        equatorMm: 4.5,
        halfThicknessMm: eye.lensAxialMm,
        color: '#b7d8ff',
        opacity: 0.5,
      },
    ],
    rings,
    bands,
    cones,
  };
}

/** Escena estática de la estación (ojo = ambos ojos; temporal = cráneo). */
export function describeStaticScene(sim: ReferenceCase, station: Station): SceneDescriptor {
  if (station === 'temporal') return describeHead(sim);
  const der = describeEye(sim, 'der');
  const izq = describeEye(sim, 'izq');
  const merge = <T>(a: readonly T[], b: readonly T[]): T[] => [...a, ...b];
  return {
    ellipsoids: merge(der.ellipsoids, izq.ellipsoids),
    tubes: merge(der.tubes, izq.tubes),
    discs: merge(der.discs, izq.discs),
    boxes: merge(der.boxes, izq.boxes),
    rings: merge(der.rings, izq.rings),
    bands: merge(der.bands, izq.bands),
    lenses: merge(der.lenses, izq.lenses),
    cones: merge(der.cones, izq.cones),
    labels: merge(der.labels, izq.labels),
  };
}

/** Base ortonormal de la sonda: lateral, elevación y forward. */
export function probeBasis(pose: ProbePose): {
  origin: Vec3;
  lateral: Vec3;
  elevation: Vec3;
  forward: Vec3;
} {
  const forward = normalize(pose.forward);
  const lateral = normalize(pose.lateral);
  const elevation = normalize(cross(forward, lateral));
  return { origin: pose.origin, lateral, elevation, forward };
}

/** Color del tubo según el flujo respecto a la sonda: rojo hacia, azul alejándose. */
export function flowColor(vessel: Vessel, poseForward: Vec3): string {
  const mid = vessel.points[Math.floor(vessel.points.length / 2)]!;
  const flow = vesselFlowDir(vessel, mid);
  return dot(flow, poseForward) < 0 ? '#e85d5d' : '#4da3ff';
}

// ── Implementación Three.js ──────────────────────────────────────────────

const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

function stdMaterial(color: string, opacity: number, emissive = 0): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: opacity >= 1,
  });
  if (emissive > 0) {
    mat.emissive = new THREE.Color(color);
    mat.emissiveIntensity = emissive;
  }
  return mat;
}

function ellipsoidMesh(d: EllipsoidDesc): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), stdMaterial(d.color, d.opacity));
  mesh.position.copy(v3(d.center));
  mesh.scale.set(d.radii[0], d.radii[1], d.radii[2]);
  return mesh;
}

function tubeMesh(d: TubeDesc): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(d.points.map(v3));
  const geo = new THREE.TubeGeometry(curve, Math.max(8, d.points.length * 2), d.radiusMm, 10, false);
  return new THREE.Mesh(geo, stdMaterial(d.color, d.opacity, d.emissive));
}

function discMesh(d: DiscDesc): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(d.radiusMm, 32), stdMaterial(d.color, d.opacity));
  mesh.position.copy(v3(d.center));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(d.normal));
  return mesh;
}

function ringMesh(d: RingDesc): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry((d.innerMm + d.outerMm) / 2, (d.outerMm - d.innerMm) / 2, 10, 32),
    stdMaterial(d.color, 1),
  );
  mesh.position.copy(v3(d.center));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(normalize(d.tangent)));
  return mesh;
}

function bandMesh(d: BandDesc): THREE.Mesh {
  const dir = sub(d.to, d.from);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(d.radiusMm * 0.6, d.radiusMm, len, 8),
    stdMaterial(d.color, d.opacity),
  );
  mesh.position.copy(v3(scale(add(d.from, d.to), 0.5)));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(normalize(dir)));
  return mesh;
}

function lensMesh(d: LensDesc): THREE.Mesh {
  const e = d.equatorMm;
  const t = d.halfThicknessMm;
  const profile = [
    new THREE.Vector2(0.01, t),
    new THREE.Vector2(e * 0.55, t * 0.8),
    new THREE.Vector2(e * 0.9, t * 0.35),
    new THREE.Vector2(e, 0),
    new THREE.Vector2(e * 0.9, -t * 0.35),
    new THREE.Vector2(e * 0.55, -t * 0.8),
    new THREE.Vector2(0.01, -t),
  ];
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), stdMaterial(d.color, d.opacity));
  mesh.position.copy(v3(d.center));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(normalize(d.axis)));
  return mesh;
}

function coneMesh(d: ConeDesc): THREE.Mesh {
  const dir = sub(d.apex, d.baseCenter);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(d.baseRadiusMm, len, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: d.color,
      transparent: true,
      opacity: d.opacity,
      wireframe: true,
    }),
  );
  // El cono crece hacia +y desde el vértice; orienta de baseCenter→apex.
  mesh.position.copy(v3(scale(add(d.apex, d.baseCenter), 0.5)));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), v3(normalize(dir)));
  return mesh;
}

function textSprite(label: LabelDesc): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 34px system-ui';
  ctx.fillStyle = '#8b939c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.text, 64, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }),
  );
  sprite.position.copy(v3(label.position));
  sprite.scale.set(10, 5, 1);
  return sprite;
}

export class Navigator3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly staticGroup = new THREE.Group();
  private readonly probeGroup = new THREE.Group();
  private readonly planeGroup = new THREE.Group();
  private readonly vesselMeshes = new Map<string, THREE.MeshStandardMaterial>();
  private readonly sim: ReferenceCase;
  private station: Station = 'ojo';
  private side: Side = 'der';
  private readonly onDblClick = (): void => this.resetCamera(this.station, this.side);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sim: ReferenceCase,
  ) {
    this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor('#0b0d0f');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);
    this.scene.add(new THREE.HemisphereLight('#dfe9f5', '#1a1d21', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(120, 160, 200);
    this.scene.add(sun);
    this.scene.add(this.staticGroup, this.probeGroup, this.planeGroup);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    canvas.addEventListener('dblclick', this.onDblClick);
    this.buildProbe();
    this.buildStatic();
  }

  dispose(): void {
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  resetCamera(station: Station, side: Side): void {
    const preset = navigatorCameraPreset(station, side);
    const frame = navigatorFrame(this.sim, station, side, 320);
    const dir = cameraViewDir(preset.yawDeg, preset.pitchDeg);
    const dist = frame.radiusMm * 2.2;
    this.camera.position.copy(v3(add(frame.target, scale(dir, dist))));
    this.controls.target.copy(v3(frame.target));
    this.controls.update();
  }

  update(
    s: AppState,
    scan: ScanGeometry | null,
    pose: ProbePose,
    gateCenter: Vec3 | null,
    colorBox: ColorBox | null,
  ): void {
    if (s.station !== this.station || s.side !== this.side) {
      this.station = s.station;
      this.side = s.side;
      this.buildStatic();
    }
    // Color de los tubos por sentido de flujo (sin reconstruir geometría).
    if (this.station === 'temporal') {
      for (const v of this.sim.head.vessels) {
        const mat = this.vesselMeshes.get(v.id);
        if (mat) mat.color.set(flowColor(v, pose.forward));
      }
    }
    this.updateProbe(pose);
    this.updatePlane(s, scan, pose, gateCenter, colorBox);
  }

  render(): void {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setSize(w, h, false);
      this.renderer.setPixelRatio(dpr);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ── interno ──

  private buildStatic(): void {
    this.staticGroup.clear();
    this.vesselMeshes.clear();
    const desc = describeStaticScene(this.sim, this.station);
    for (const d of desc.ellipsoids) this.staticGroup.add(ellipsoidMesh(d));
    for (const d of desc.discs) this.staticGroup.add(discMesh(d));
    for (const d of desc.boxes) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(d.size[0], d.size[1], d.size[2]),
        stdMaterial(d.color, d.opacity),
      );
      mesh.position.copy(v3(d.center));
      this.staticGroup.add(mesh);
    }
    for (const d of desc.tubes) {
      const mesh = tubeMesh(d);
      if (d.vesselId) this.vesselMeshes.set(d.vesselId, mesh.material as THREE.MeshStandardMaterial);
      this.staticGroup.add(mesh);
    }
    for (const d of desc.rings) this.staticGroup.add(ringMesh(d));
    for (const d of desc.bands) this.staticGroup.add(bandMesh(d));
    for (const d of desc.lenses) this.staticGroup.add(lensMesh(d));
    for (const d of desc.cones) this.staticGroup.add(coneMesh(d));
    for (const d of desc.labels) this.staticGroup.add(textSprite(d));
    this.resetCamera(this.station, this.side);
  }

  private buildProbe(): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#2f353c', metalness: 0.2, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(46, 14, 22), mat);
    body.position.set(0, 0, -11);
    const top = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 16), mat);
    top.position.set(0, 0, -26);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(2, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#e8b44a', emissive: '#e8b44a', emissiveIntensity: 0.4 }),
    );
    marker.position.set(21, 0, 0);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 30, 10), mat);
    cable.rotation.x = Math.PI / 2;
    cable.position.set(0, 0, -49);
    this.probeGroup.add(body, top, marker, cable);
    // Guarda el tipo para reescalar si cambia el transductor.
    this.probeGroup.userData.body = body;
    this.probeGroup.userData.top = top;
  }

  private updateProbe(pose: ProbePose): void {
    const basis = probeBasis(pose);
    const m = new THREE.Matrix4().makeBasis(v3(basis.lateral), v3(basis.elevation), v3(basis.forward));
    this.probeGroup.setRotationFromMatrix(m);
    this.probeGroup.position.copy(v3(basis.origin));
    const linear = this.station === 'ojo';
    if (this.probeGroup.userData.linear !== linear) {
      this.probeGroup.userData.linear = linear;
      const body = this.probeGroup.userData.body as THREE.Mesh;
      const top = this.probeGroup.userData.top as THREE.Mesh;
      body.geometry.dispose();
      body.geometry = new THREE.BoxGeometry(linear ? 46 : 28, linear ? 14 : 18, linear ? 22 : 26);
      top.visible = linear;
    }
  }

  private updatePlane(
    s: AppState,
    scan: ScanGeometry | null,
    pose: ProbePose,
    gateCenter: Vec3 | null,
    colorBox: ColorBox | null,
  ): void {
    this.planeGroup.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.planeGroup.clear();
    if (!scan) return;
    const depth = s.settings.depthMm;
    const first = scan.lines[0]!;
    const last = scan.lines[scan.lines.length - 1]!;
    const planeMat = new THREE.MeshStandardMaterial({
      color: '#5aa0ff',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outline: THREE.Vector3[] = [];
    if (scan.kind === 'linear') {
      const endA = add(first.origin, scale(first.dir, depth));
      const endB = add(last.origin, scale(last.dir, depth));
      const geo = new THREE.BufferGeometry().setFromPoints([first.origin, last.origin, endB, endA].map(v3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();
      this.planeGroup.add(new THREE.Mesh(geo, planeMat));
      outline.push(v3(first.origin), v3(last.origin), v3(endB), v3(endA), v3(first.origin));
    } else {
      // Abanico: ápice + arco a depthMm muestreando las direcciones de línea.
      const n = 24;
      const arc: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const line = scan.lines[Math.round((i / n) * (scan.lines.length - 1))]!;
        arc.push(v3(add(line.origin, scale(line.dir, depth))));
      }
      const verts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) verts.push(v3(scan.apex), arc[i]!, arc[i + 1]!);
      const geo = new THREE.BufferGeometry().setFromPoints(verts);
      geo.computeVertexNormals();
      this.planeGroup.add(new THREE.Mesh(geo, planeMat));
      outline.push(v3(scan.apex), arc[0]!);
      for (const a of arc) outline.push(a.clone());
      outline.push(v3(scan.apex), arc[arc.length - 1]!);
    }
    this.planeGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(outline),
        new THREE.LineBasicMaterial({ color: '#8fbfff' }),
      ),
    );
    // Foco: trazo corto a focusMm sobre la línea central.
    const midLine = scan.lines[Math.floor(scan.lines.length / 2)]!;
    const focus = add(midLine.origin, scale(midLine.dir, s.settings.focusMm));
    this.planeGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          v3(add(focus, scale(scan.lateralDir, -3))),
          v3(add(focus, scale(scan.lateralDir, 3))),
        ]),
        new THREE.LineDashedMaterial({ color: '#e8b44a', dashSize: 1.2, gapSize: 0.8 }),
      ),
    );
    // Caja de color (temporal): arcos a zMin/zMax + radiales laterales.
    if (colorBox && this.station === 'temporal') {
      const kind = scan.kind;
      const pts: THREE.Vector3[] = [];
      const uMin = colorBox.uCenter - colorBox.uHalf;
      const uMax = colorBox.uCenter + colorBox.uHalf;
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const uA = uMin + ((uMax - uMin) * i) / steps;
        const uB = uMin + ((uMax - uMin) * (i + 1)) / steps;
        pts.push(
          v3(imageToPatient(pose, kind, uA, colorBox.zMinMm)),
          v3(imageToPatient(pose, kind, uB, colorBox.zMinMm)),
          v3(imageToPatient(pose, kind, uA, colorBox.zMaxMm)),
          v3(imageToPatient(pose, kind, uB, colorBox.zMaxMm)),
        );
      }
      pts.push(
        v3(imageToPatient(pose, kind, uMin, colorBox.zMinMm)),
        v3(imageToPatient(pose, kind, uMin, colorBox.zMaxMm)),
        v3(imageToPatient(pose, kind, uMax, colorBox.zMinMm)),
        v3(imageToPatient(pose, kind, uMax, colorBox.zMaxMm)),
      );
      this.planeGroup.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }),
        ),
      );
    }
    if (gateCenter) {
      const gate = new THREE.Mesh(
        new THREE.BoxGeometry(s.settings.gateMm, 3, s.settings.gateMm),
        new THREE.MeshStandardMaterial({
          color: '#ffd77a',
          emissive: '#ffd77a',
          emissiveIntensity: 0.5,
        }),
      );
      gate.position.copy(v3(gateCenter));
      this.planeGroup.add(gate);
    }
  }
}
