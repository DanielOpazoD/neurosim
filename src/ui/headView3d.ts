/**
 * Vista interactiva "cabeza + transductor": una cabeza estilizada construida
 * desde la geometría del caso (elipsoide de cuero cabelludo, ojos, orejas,
 * hotspots de ventana temporal y globos) con la sonda encima. Permite
 * arrastrar la sonda sobre la piel (escribe offsetMm/offsetVMm), rueda sobre
 * la sonda para el marcador, Mayús+arrastrar para inclinación/angulación y
 * clic en hotspots para cambiar de estación. Las matemáticas testables son
 * funciones puras (`hitToOffsets`, `clampOffsets`, `hotspotAt`).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AppState } from '../app/state';
import type { Side, Station } from '../domain/contracts';
import { surfacePoint } from '../anatomy/head';
import { eyePose, temporalPose } from '../app/poses';
import { buildProbeGroup, probeBasis, updateProbePose } from './probeMesh';
import type { ProbePose } from '../domain/contracts';
import type { ScanGeometry } from '../ultrasound/probe';

const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

/** Base de pose sin desplazamientos: origen, lateral y elevación del haz. */
export interface PoseBase {
  readonly origin: Vec3;
  readonly lateral: Vec3;
  readonly elevation: Vec3;
}

/** Proyección de un punto de contacto sobre los ejes tangentes de la sonda. */
export function hitToOffsets(hit: Vec3, base: PoseBase): { offsetMm: number; offsetVMm: number } {
  const d = sub(hit, base.origin);
  return { offsetMm: dot(d, base.lateral), offsetVMm: dot(d, base.elevation) };
}

const OFF_RANGES = { offsetMm: [-18, 18], offsetVMm: [-20, 20] } as const;

export function clampOffsets(o: { offsetMm: number; offsetVMm: number }): {
  offsetMm: number;
  offsetVMm: number;
} {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
  return {
    offsetMm: clamp(o.offsetMm, OFF_RANGES.offsetMm),
    offsetVMm: clamp(o.offsetVMm, OFF_RANGES.offsetVMm),
  };
}

export interface HotspotHit {
  readonly station: Station;
  readonly side: Side;
}

/** ¿El punto cae cerca de una ventana temporal o de un globo ocular? */
export function hotspotAt(point: Vec3, sim: ReferenceCase): HotspotHit | null {
  for (const side of ['der', 'izq'] as const) {
    if (Math.hypot(...sub(point, sim.head.windowCenter[side])) <= sim.head.windowRadiusMm + 6) {
      return { station: 'temporal', side };
    }
  }
  for (const side of ['der', 'izq'] as const) {
    if (Math.hypot(...sub(point, sim.eyes[side].center)) <= sim.eyes[side].globeRadiusMm + 6) {
      return { station: 'ojo', side };
    }
  }
  return null;
}

/** Base tangente (origen/lateral/elevación) con todos los desplazamientos a 0. */
export function stationBase(sim: ReferenceCase, s: AppState): PoseBase {
  const input = {
    side: s.side,
    station: s.station,
    tiltDeg: s.tiltDeg,
    offsetMm: 0,
    offsetVMm: 0,
    tiltVDeg: 0,
    rotDeg: 0,
    press: s.press,
  };
  const pose = s.station === 'ojo' ? eyePose(sim, input) : temporalPose(sim, input);
  const fwd = normalize(pose.forward);
  return {
    origin: pose.origin,
    lateral: pose.lateral,
    elevation: normalize(cross(pose.lateral, fwd)),
  };
}

interface Hotspot {
  mesh: THREE.Mesh;
  station: Station;
  side: Side;
}

/**
 * Vista de cabeza con sonda arrastrable. `onStationChange` reutiliza el
 * camino de las pestañas (`setStation`); `apply` muta AppState.
 */
export class HeadView3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;

  /** true mientras el usuario arrastra la sonda o orbita la cámara. */
  private orbiting = false;
  get interacting(): boolean {
    return this.dragging !== null || this.orbiting;
  }
  private readonly controls: OrbitControls;
  private readonly probe = buildProbeGroup();
  private readonly planeGroup = new THREE.Group();
  private readonly scalp: THREE.Mesh;
  private readonly hotspots: Hotspot[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private dragging: 'slide' | 'tilt' | null = null;
  private lastXY: [number, number] = [0, 0];
  private hoverProbe = false;
  private station: Station = 'ojo';
  private side: Side = 'der';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: ReferenceCase,
    private readonly state: AppState,
    private readonly onStationChange: (station: Station, side: Side) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.renderer.setClearColor('#17191d');
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    this.scene.add(new THREE.HemisphereLight('#e8f0fa', '#1a1d21', 1.0));
    const key = new THREE.DirectionalLight('#ffffff', 1.5);
    key.position.set(90, 130, 160);
    this.scene.add(key);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.enablePan = false;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 500;
    this.buildHead();
    this.scalp = this.scene.getObjectByName('scalp') as THREE.Mesh;
    this.scene.add(this.probe, this.planeGroup);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', () => this.onPointerUp());
    canvas.addEventListener('pointerleave', () => this.onPointerUp());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.resetCamera(this.station, this.side));
    this.resetCamera('ojo', 'der');
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }

  resetCamera(station: Station, side: Side): void {
    this.station = station;
    this.side = side;
    const c = this.sim.head.skullCenter;
    // Vista 3/4 sobre el lado examinado, ligeramente desde arriba; encuadre de
    // cabeza completa (la cabeza ocupa ~75 % de la altura del canvas).
    const sign = side === 'der' ? -1 : 1;
    const az = ((station === 'ojo' ? 30 : 55) * Math.PI) / 180;
    const el = ((station === 'ojo' ? 8 : 12) * Math.PI) / 180;
    const dist = Math.min(500, 4.8 * Math.max(...this.sim.head.skullRadii));
    this.controls.target.set(c[0], c[1], c[2] + 12);
    this.camera.position.set(
      c[0] + sign * dist * Math.sin(az) * Math.cos(el),
      c[1] + dist * Math.sin(el),
      c[2] + dist * Math.cos(az) * Math.cos(el),
    );
    this.controls.update();
  }

  private lastKey = '';
  update(s: AppState, pose: ProbePose, scan: ScanGeometry | null): boolean {
    if (s.station !== this.station || s.side !== this.side) this.resetCamera(s.station, s.side);
    const key = `${s.station}|${s.side}|${pose.origin.join(',')}|${pose.forward.join(',')}|${pose.lateral.join(',')}|${s.rotDeg}|${s.press}|${s.pwOn}|${s.settings.depthMm}`;
    const changed = key !== this.lastKey;
    this.lastKey = key;
    if (changed) {
      updateProbePose(this.probe, pose, s.station === 'ojo');
      this.updateScanPlane(s, pose, scan);
    }
    return changed;
  }

  render(): void {
    const w = this.canvas.clientWidth || 280;
    const h = this.canvas.clientHeight || 280;
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

  // ── cabeza estilizada ──

  /** Profundidad z de la cara (cuero cabelludo) en el punto (x, y). */
  private faceZ(x: number, y: number): number {
    const h = this.sim.head;
    const c = h.skullCenter;
    const rx = h.skullRadii[0] + 7;
    const ry = h.skullRadii[1] + 7;
    const rz = h.skullRadii[2] + 7;
    const k = 1 - ((x - c[0]) / rx) ** 2 - ((y - c[1]) / ry) ** 2;
    return c[2] + rz * Math.sqrt(Math.max(0.02, k));
  }

  private buildHead(): void {
    const h = this.sim.head;
    const skin = new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: 0.8, metalness: 0 });
    const hairMat = new THREE.MeshStandardMaterial({ color: '#3a2d26', roughness: 0.95, metalness: 0 });
    const c = h.skullCenter;
    const r = h.skullRadii;
    // Cuero cabelludo: elipsoide del cráneo + 7 mm de piel/tejido blando.
    const scalp = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), skin);
    scalp.name = 'scalp';
    scalp.position.copy(v3(c));
    scalp.scale.set(r[0] + 7, r[1] + 7, r[2] + 7);
    this.scene.add(scalp);
    // Cabello: casquete del elipsoide +9 mm recortado a y > centro + 20 mm.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.acos(20 / (r[1] + 9))),
      hairMat,
    );
    hairCap.position.copy(v3(c));
    hairCap.scale.set(r[0] + 9, r[1] + 9, r[2] + 9);
    this.scene.add(hairCap);
    // Cuello.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(34, 38, 70, 24), skin);
    neck.position.set(c[0], c[1] - r[1] - 24, c[2] - 8);
    this.scene.add(neck);
    // Ojos: globo blanco que abomba de la cara + iris, pupila, párpados y ceja.
    const eyeWhite = new THREE.MeshStandardMaterial({ color: '#f2f4f6', roughness: 0.35 });
    const irisMat = new THREE.MeshStandardMaterial({ color: '#2a3550', roughness: 0.4 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: '#14161a', roughness: 0.4 });
    for (const side of ['der', 'izq'] as const) {
      const eye = this.sim.eyes[side];
      const r0 = eye.globeRadiusMm;
      const gz = this.faceZ(eye.center[0], eye.center[1]) - r0 + 6;
      const globe = new THREE.Mesh(new THREE.SphereGeometry(r0, 28, 20), eyeWhite);
      globe.position.set(eye.center[0], eye.center[1], gz);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(4.4, 24), irisMat);
      iris.position.set(eye.center[0], eye.center[1], gz + r0 + 0.25);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(2.0, 20), pupilMat);
      pupil.position.set(eye.center[0], eye.center[1], gz + r0 + 0.45);
      // Párpados: arcos de toro finos de color piel sobre/bajo el globo.
      const lidU = new THREE.Mesh(new THREE.TorusGeometry(r0 + 1.6, 1.1, 8, 24, Math.PI * 0.72), skin);
      lidU.position.set(eye.center[0], eye.center[1], gz + r0 * 0.55);
      lidU.rotation.z = Math.PI * 0.14;
      const lidL = new THREE.Mesh(new THREE.TorusGeometry(r0 + 1.4, 0.9, 8, 24, Math.PI * 0.55), skin);
      lidL.position.set(eye.center[0], eye.center[1], gz + r0 * 0.55);
      lidL.rotation.z = Math.PI + Math.PI * 0.22;
      // Ceja.
      const brow = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 17, 8), hairMat);
      brow.position.set(eye.center[0], eye.center[1] + r0 + 7, gz + r0 * 0.45);
      brow.rotation.z = Math.PI / 2 + (side === 'der' ? 0.12 : -0.12);
      this.scene.add(globe, iris, pupil, lidU, lidL, brow);
      // Hotspot ocular: anillo fino alrededor de la órbita mirando a +z.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r0 + 6, 0.9, 8, 40),
        new THREE.MeshBasicMaterial({
          color: '#4da3ff',
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );
      ring.position.set(eye.center[0], eye.center[1], gz + r0 * 0.35);
      this.scene.add(ring);
      this.hotspots.push({ mesh: ring, station: 'ojo', side });
    }
    // Nariz: prisma redondeado + punta esférica, y boca.
    const noseY = c[1] - 38;
    const noseZ = this.faceZ(c[0], noseY);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(9, 24, 8), skin);
    nose.position.set(c[0], noseY, noseZ + 3);
    nose.rotation.x = -0.25;
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), skin);
    noseTip.position.set(c[0], noseY - 11, noseZ + 5);
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(19, 1.8, 2),
      new THREE.MeshStandardMaterial({ color: '#8a5a48', roughness: 0.9 }),
    );
    const mouthY = c[1] - 66;
    mouth.position.set(c[0], mouthY, this.faceZ(c[0], mouthY) - 1);
    this.scene.add(nose, noseTip, mouth);
    // Orejas: toros achatados a ±x a la altura de la ventana.
    for (const sx of [-1, 1] as const) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(10, 3.4, 10, 24), skin);
      ear.position.set(c[0] + sx * (r[0] + 5), c[1] - 10, c[2] + 2);
      ear.rotation.y = Math.PI / 2;
      ear.scale.set(1, 1.3, 0.6);
      this.scene.add(ear);
    }
    // Hotspots de la ventana temporal: anillos sutiles sobre la piel.
    for (const side of ['der', 'izq'] as const) {
      const wc = h.windowCenter[side];
      const onScalp = surfacePoint(h, wc, 9);
      const n = normalize(sub(onScalp, wc)); // normal local aproximada
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(h.windowRadiusMm + 2, 1.1, 8, 40),
        new THREE.MeshBasicMaterial({
          color: '#4da3ff',
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );
      ring.position.copy(v3(onScalp));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(n));
      this.scene.add(ring);
      this.hotspots.push({ mesh: ring, station: 'temporal', side });
    }
  }

  /** Abanico/rectángulo translúcido del plano de barrido bajo la sonda. */
  private updateScanPlane(s: AppState, pose: ProbePose, scan: ScanGeometry | null): void {
    this.planeGroup.clear();
    if (!scan) return;
    const depth = s.settings.depthMm;
    const basis = probeBasis(pose);
    const apex = v3(basis.origin);
    const mat = new THREE.MeshBasicMaterial({
      color: '#4da3ff',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (scan.kind === 'linear') {
      const a = scan.lines[0]!;
      const b = scan.lines[scan.lines.length - 1]!;
      const pts = [
        v3(a.origin),
        v3(b.origin),
        v3(add(b.origin, scale(b.dir, depth))),
        v3(add(a.origin, scale(a.dir, depth))),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      this.planeGroup.add(new THREE.Mesh(geo, mat));
    } else {
      const n = 16;
      const verts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const l0 = scan.lines[Math.round((i / n) * (scan.lines.length - 1))]!;
        const l1 = scan.lines[Math.round(((i + 1) / n) * (scan.lines.length - 1))]!;
        verts.push(
          apex.clone(),
          v3(add(l0.origin, scale(l0.dir, depth))),
          v3(add(l1.origin, scale(l1.dir, depth))),
        );
      }
      this.planeGroup.add(new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(verts), mat));
    }
  }

  // ── interacción ──

  private ndc(e: PointerEvent | WheelEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private raycastProbe(e: PointerEvent | WheelEvent): boolean {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.intersectObject(this.probe, true).length > 0;
  }

  private raycastHotspot(e: PointerEvent): Hotspot | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    for (const hs of this.hotspots) {
      if (this.raycaster.intersectObject(hs.mesh, false).length > 0) return hs;
    }
    return null;
  }

  private raycastScalp(e: PointerEvent): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.scalp, false);
    if (!hits.length) return null;
    const p = hits[0]!.point;
    return [p.x, p.y, p.z];
  }

  /** Ancla de arrastre: ejes tangentes proyectados a NDC (por 20 mm). */
  private slideAnchor: {
    ndc: THREE.Vector2;
    start: { offsetMm: number; offsetVMm: number };
    lat: THREE.Vector2;
    elev: THREE.Vector2;
    base: PoseBase;
  } | null = null;

  /** Punto 3D → coordenadas NDC de cámara. */
  private toNdc(p: Vec3): THREE.Vector3 {
    return v3(p).project(this.camera);
  }

  private beginSlide(e: PointerEvent): void {
    const base = stationBase(this.sim, this.state);
    const o = this.toNdc(base.origin);
    const latEnd = this.toNdc(add(base.origin, scale(base.lateral, 20)));
    const elevEnd = this.toNdc(add(base.origin, scale(base.elevation, 20)));
    this.slideAnchor = {
      ndc: this.ndc(e),
      start: { offsetMm: this.state.offsetMm, offsetVMm: this.state.offsetVMm },
      lat: new THREE.Vector2(latEnd.x - o.x, latEnd.y - o.y),
      elev: new THREE.Vector2(elevEnd.x - o.x, elevEnd.y - o.y),
      base,
    };
  }

  /**
   * Mapea el delta del puntero a desplazamientos de la sonda: descompone el
   * movimiento en pantalla sobre las proyecciones de los ejes tangentes
   * (lateral, elevación). Un arrastre puramente horizontal filtra entonces
   * offsetV solo por lo que el eje de elevación se proyecte en horizontal
   * (<25 % del lateral en las vistas 3/4). Si los ejes son degenerados en
   * pantalla, se recurre al raycast sobre el cuero cabelludo.
   */
  private applySlideDrag(e: PointerEvent): void {
    const a = this.slideAnchor;
    if (!a) return;
    const s = this.state;
    const dn = this.ndc(e).clone().sub(a.ndc);
    const det = a.lat.x * a.elev.y - a.elev.x * a.lat.y;
    if (Math.abs(det) > 1e-4) {
      const dL = (dn.x * a.elev.y - dn.y * a.elev.x) / det;
      const dE = (a.lat.x * dn.y - a.lat.y * dn.x) / det;
      const off = clampOffsets({
        offsetMm: a.start.offsetMm + dL * 20,
        offsetVMm: a.start.offsetVMm + dE * 20,
      });
      s.offsetMm = Math.round(off.offsetMm * 2) / 2;
      let vm = Math.round(off.offsetVMm * 2) / 2;
      // Arrastre casi horizontal: la curvatura del cráneo no debe filtrar
      // más del 25 % del movimiento lateral efectivo en la componente vertical.
      const dLat = s.offsetMm - a.start.offsetMm;
      if (
        Math.abs(dn.y) < 0.05 * Math.abs(dn.x) &&
        Math.abs(dLat) > 0 &&
        Math.abs(vm - a.start.offsetVMm) >= 0.25 * Math.abs(dLat)
      ) {
        vm =
          a.start.offsetVMm + (Math.sign(vm - a.start.offsetVMm) * Math.floor(0.24 * Math.abs(dLat) * 2)) / 2;
      }
      s.offsetVMm = vm;
      return;
    }
    const hit = this.raycastScalp(e);
    if (hit) {
      const off = clampOffsets(hitToOffsets(hit, a.base));
      s.offsetMm = Math.round(off.offsetMm * 2) / 2;
      s.offsetVMm = Math.round(off.offsetVMm * 2) / 2;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    this.lastXY = [e.clientX, e.clientY];
    if (e.button !== 0) return;
    if (this.raycastProbe(e)) {
      this.dragging = e.shiftKey ? 'tilt' : 'slide';
      if (this.dragging === 'slide') this.beginSlide(e);
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    const hs = this.raycastHotspot(e);
    if (hs && (hs.station !== this.state.station || hs.side !== this.state.side)) {
      this.onStationChange(hs.station, hs.side);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const s = this.state;
    if (this.dragging === 'slide') {
      this.applySlideDrag(e);
      return;
    }
    if (this.dragging === 'tilt') {
      const dx = e.clientX - this.lastXY[0];
      const dy = e.clientY - this.lastXY[1];
      this.lastXY = [e.clientX, e.clientY];
      s.tiltVDeg = Math.min(25, Math.max(-25, s.tiltVDeg + dx * 0.25));
      s.tiltDeg = Math.min(35, Math.max(-35, s.tiltDeg + dy * 0.25));
      return;
    }
    // Hover: resalta la sonda y cambia el cursor.
    const over = this.raycastProbe(e);
    if (over !== this.hoverProbe) {
      this.hoverProbe = over;
      const marker = this.probe.userData.marker as THREE.Mesh | undefined;
      const mat = marker?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) mat.emissiveIntensity = over ? 1.2 : 0.4;
      this.canvas.style.cursor = over ? 'grab' : '';
    }
  }

  private onPointerUp(): void {
    if (this.dragging) {
      this.dragging = null;
      this.slideAnchor = null;
      this.controls.enabled = true;
      this.canvas.style.cursor = this.hoverProbe ? 'grab' : '';
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.raycastProbe(e)) return; // OrbitControls zoom fuera de la sonda
    e.preventDefault();
    e.stopPropagation();
    const s = this.state;
    const step = e.deltaY < 0 ? 1 : -1;
    if (e.altKey) {
      s.press = Math.min(1, Math.max(0, s.press + step * 0.05));
    } else {
      s.rotDeg = Math.min(90, Math.max(-90, s.rotDeg + step * 5));
    }
  }
}
