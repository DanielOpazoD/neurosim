/**
 * Vista interactiva "cabeza + transductor": cabeza escaneada «Lee Perry-Smith»
 * (CC BY 3.0, DEC-59) ajustada a los ojos del caso, con la cabeza estilizada
 * (elipsoide de cuero cabelludo, ojos, orejas, globos) como respaldo mientras
 * carga o si falla, hotspots de ventana y la sonda encima. Permite
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
import { stationPose } from '../app/poses';
import { buildProbeGroup, probeBasis, updateProbePose } from './probeMesh';
import type { ProbePose } from '../domain/contracts';
import type { ScanGeometry } from '../ultrasound/probe';
import { AxisGizmo } from './axisGizmo';
import { fitHeadScan, lidTarget } from './headFit';
import {
  linkedCameraPosition,
  viewFromCamera,
  viewPreset,
  type ViewLink,
  type ViewOrientation,
} from './viewLink';

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

/** Radio del hotspot submandibular (anillo bajo el ángulo mandibular), mm. */
const SUBMANDIBULAR_HOTSPOT_MM = 12;

/** ¿El punto cae cerca de una ventana temporal, submandibular o de un globo ocular? */
export function hotspotAt(point: Vec3, sim: ReferenceCase): HotspotHit | null {
  for (const side of ['der', 'izq'] as const) {
    if (Math.hypot(...sub(point, sim.neck[side].frame.origin)) <= SUBMANDIBULAR_HOTSPOT_MM + 4) {
      return { station: 'submandibular', side };
    }
  }
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
  const pose = stationPose(sim, input);
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

/** Distancia (mm) desde la que se lanza el rayo de contacto visual hacia la piel. */
const CONTACT_RAY_START_MM = 120;
/** Corrección visual máxima del contacto (mm); más allá se deja la pose física. */
const CONTACT_MAX_SHIFT_MM = 45;

export interface HeadViewOptions {
  /** Cargar la cabeza escaneada (false → cabeza estilizada; `?headmodel=0`). */
  readonly scan?: boolean;
  /** Enlace de cámaras con el navegador anatómico (DEC-59). */
  readonly link?: ViewLink | null;
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
  private readonly gizmo = new AxisGizmo();
  private readonly link: ViewLink | null;
  /** Partes de la cabeza estilizada: se ocultan si carga el escaneo. */
  private readonly stylised: THREE.Object3D[] = [];
  /** Malla escaneada ya ajustada al caso (null: estilizada). */
  private scanMesh: THREE.Mesh | null = null;
  private dragging: 'slide' | 'tilt' | null = null;
  private lastXY: [number, number] = [0, 0];
  private hoverProbe = false;
  private station: Station = 'ojo';
  private side: Side = 'der';
  private applyingLink = false;
  /** Hay algo nuevo que pintar (pose, cámara enlazada, asset cargado). */
  private dirty = true;
  private lastRenderMs = -Infinity;
  /** Coste de CPU de `renderer.render` (ms): último y máximo (diagnóstico, DEC-59). */
  readonly renderStats = { count: 0, lastMs: 0, maxMs: 0, totalMs: 0 };
  /** `?perf3d`: `gl.finish()` tras cada pintado para medir CPU + GPU (diagnóstico). */
  private readonly perfSync =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf3d');
  /** 'escaneo' tras cargar el asset; 'estilizada' mientras tanto o si falla. */
  model: 'escaneo' | 'estilizada' = 'estilizada';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: ReferenceCase,
    private readonly state: AppState,
    private readonly onStationChange: (station: Station, side: Side) => void,
    opts: HeadViewOptions = {},
  ) {
    this.link = opts.link ?? null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor('#17191d');
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    // Luz cálida de hemisferio + clave + contraluz frío: sensación de piel
    // (dispersión subsuperficial sugerida por el rebote cálido de las sombras).
    this.scene.add(new THREE.HemisphereLight('#fff1e4', '#4a3830', 0.95));
    const key = new THREE.DirectionalLight('#fff4ea', 1.55);
    key.position.set(110, 150, 230);
    const rim = new THREE.DirectionalLight('#c4d8ff', 0.85);
    rim.position.set(-160, 90, -220);
    const fill = new THREE.DirectionalLight('#ffd9c4', 0.35);
    fill.position.set(-140, -40, 160);
    this.scene.add(key, rim, fill);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.enablePan = false;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 700;
    this.controls.addEventListener('start', () => (this.orbiting = true));
    this.controls.addEventListener('end', () => (this.orbiting = false));
    // Maestra del enlace: cada cambio de órbita publica la dirección de vista.
    this.controls.addEventListener('change', () => {
      this.dirty = true;
      if (!this.applyingLink) this.publishView();
    });
    this.link?.subscribe('cabeza', (view) => this.applyLinkedView(view));
    this.buildHead();
    this.scalp = this.scene.getObjectByName('scalp') as THREE.Mesh;
    this.scene.add(this.probe, this.planeGroup);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', () => this.onPointerUp());
    canvas.addEventListener('pointerleave', () => this.onPointerUp());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.resetCamera(this.station, this.side));
    this.canvas.dataset.headModel = this.model;
    this.resetCamera('ojo', 'der');
    if (opts.scan !== false) {
      this.loadScan().catch(() => {
        // Sin red o sin WebGL suficiente: se queda la cabeza estilizada.
        this.canvas.dataset.headModel = 'estilizada';
      });
    }
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }

  /** Objetivo de la cámara: centro del cráneo (estilizada) o de la cabeza escaneada. */
  private frameTarget(station: Station): Vec3 {
    const c = this.sim.head.skullCenter;
    const dy = station === 'submandibular' ? 30 : 0;
    // El escaneo incluye cara completa y mentón (~140 mm bajo los ojos):
    // el encuadre baja para que quepan cráneo y mentón.
    const y = this.scanMesh ? c[1] - 20 : c[1];
    return [c[0], y - dy, c[2] + 12];
  }

  private frameDistance(): number {
    const r = Math.max(...this.sim.head.skullRadii);
    return Math.min(this.controls.maxDistance, (this.scanMesh ? 6.1 : 4.8) * r);
  }

  resetCamera(station: Station, side: Side): void {
    this.station = station;
    this.side = side;
    // Preset ÚNICO compartido con el navegador (DEC-59); encuadre propio.
    const view = viewPreset(station, side);
    const target = this.frameTarget(station);
    this.applyingLink = true;
    try {
      this.controls.target.copy(v3(target));
      this.camera.position.copy(v3(linkedCameraPosition(target, view, this.frameDistance())));
      this.camera.up.copy(v3(view.up));
      this.camera.lookAt(this.controls.target);
      this.controls.update();
    } finally {
      this.applyingLink = false;
    }
    this.publishView();
    this.dirty = true;
  }

  private publishView(): void {
    const p = this.camera.position;
    const t = this.controls.target;
    const u = this.camera.up;
    this.link?.publish('cabeza', viewFromCamera([p.x, p.y, p.z], [t.x, t.y, t.z], [u.x, u.y, u.z]));
  }

  /** Aplica la orientación enlazada desde su objetivo y a su distancia actual. */
  applyLinkedView(view: ViewOrientation): void {
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    this.applyingLink = true;
    try {
      this.camera.position.copy(v3(linkedCameraPosition([t.x, t.y, t.z], view, dist)));
      this.camera.up.copy(v3(view.up));
      this.camera.lookAt(t);
    } finally {
      this.applyingLink = false;
    }
    this.dirty = true;
  }

  /** Dirección de vista actual (tests/diagnóstico). */
  viewDir(): Vec3 {
    const p = this.camera.position;
    const t = this.controls.target;
    return normalize([p.x - t.x, p.y - t.y, p.z - t.z]);
  }

  private lastKey = '';
  /**
   * Actualiza sonda y plano con la MISMA `ProbePose` que recibe el navegador
   * en el mismo fotograma (`currentPose` en main.ts, DEC-59).
   */
  update(s: AppState, pose: ProbePose, scan: ScanGeometry | null): boolean {
    if (s.station !== this.station || s.side !== this.side) this.resetCamera(s.station, s.side);
    const key = `${s.station}|${s.side}|${pose.origin.join(',')}|${pose.forward.join(',')}|${pose.lateral.join(',')}|${s.rotDeg}|${s.press}|${s.pwOn}|${s.settings.depthMm}|${this.model}`;
    const changed = key !== this.lastKey;
    this.lastKey = key;
    if (changed) {
      updateProbePose(this.probe, pose, s.station === 'ojo');
      this.updateScanPlane(s, pose, scan);
      this.applyContact(pose);
      this.dirty = true;
    }
    return changed;
  }

  /**
   * Pinta si hay cambios (pose, cámara, asset) como mucho cada
   * `minIntervalMs`, o siempre mientras se interactúa. La vista es una
   * segunda superficie WebGL: a ritmo reducido basta.
   */
  renderIfNeeded(nowMs: number, minIntervalMs = 150): boolean {
    const cameraMoved = this.controls.update();
    if (cameraMoved) this.dirty = true;
    if (!this.dirty) return false;
    if (!this.interacting && !cameraMoved && nowMs - this.lastRenderMs < minIntervalMs) return false;
    this.lastRenderMs = nowMs;
    this.dirty = false;
    this.render(false);
    return true;
  }

  render(updateControls = true): void {
    const w = this.canvas.clientWidth || 280;
    const h = this.canvas.clientHeight || 280;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setSize(w, h, false);
      this.renderer.setPixelRatio(dpr);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (updateControls) this.controls.update();
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.gizmo.render(this.renderer, this.camera);
    if (this.perfSync) this.renderer.getContext().finish();
    const ms = performance.now() - t0;
    const st = this.renderStats;
    st.count += 1;
    st.lastMs = ms;
    st.totalMs += ms;
    st.maxMs = Math.max(st.maxMs, ms);
    this.canvas.dataset.renderMs = ms.toFixed(2);
    this.canvas.dataset.renderAvgMs = (st.totalMs / st.count).toFixed(2);
  }

  // ── cabeza escaneada (DEC-59) ──

  /**
   * Carga «Lee Perry-Smith» (CC BY 3.0, ver docs/PROVENANCE.md), ajusta la
   * malla a los ojos del caso y oculta la cabeza estilizada (incluidos los
   * globos: los ojos del escaneo están cerrados). Los anillos de las
   * ventanas se recolocan sobre la piel escaneada.
   */
  private async loadScan(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}models/head/`;
    const tex = new THREE.TextureLoader();
    // GLTFLoader en su propio chunk (≈ 60 kB): solo se descarga con el escaneo.
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const [gltf, map, normalMap] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}LeePerrySmith.glb`),
      tex.loadAsync(`${base}Map-COL.jpg`),
      tex.loadAsync(`${base}Infinite-Level_02_Tangent_SmoothUV.jpg`),
    ]);
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!source && o instanceof THREE.Mesh) source = o;
    });
    if (!source) throw new Error('LeePerrySmith.glb sin malla');
    const geometry = (source as THREE.Mesh).geometry;
    map.colorSpace = THREE.SRGBColorSpace;
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    map.anisotropy = aniso;
    normalMap.anisotropy = aniso;
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.6,
      metalness: 0,
      // Rebote cálido mínimo: sombras de piel algo rojizas, no negras.
      emissive: new THREE.Color('#3b1d14'),
      emissiveIntensity: 0.18,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'headScan';
    const fit = fitHeadScan(this.sim);
    mesh.scale.set(fit.scale[0], fit.scale[1], fit.scale[2]);
    mesh.position.set(fit.offset[0], fit.offset[1], fit.offset[2]);
    mesh.updateMatrixWorld(true);
    geometry.computeBoundingSphere();
    this.scene.add(mesh);
    this.scanMesh = mesh;
    for (const o of this.stylised) o.visible = false;
    this.placeHotspotsOnScan();
    this.model = 'escaneo';
    this.canvas.dataset.headModel = 'escaneo';
    this.lastKey = '';
    this.resetCamera(this.station, this.side);
    this.dirty = true;
  }

  /** Primer impacto sobre la piel escaneada del rayo `from` + t·`dir` (mm). */
  private scanHit(from: Vec3, dir: Vec3, far: number): { t: number; point: Vec3 } | null {
    if (!this.scanMesh) return null;
    this.raycaster.set(v3(from), v3(normalize(dir)));
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObject(this.scanMesh, false);
    this.raycaster.far = Infinity;
    const h = hits[0];
    return h ? { t: h.distance, point: [h.point.x, h.point.y, h.point.z] } : null;
  }

  /**
   * Contacto VISUAL (solo esta vista; la pose física no cambia): se desliza
   * la sonda y su plano a lo largo del haz hasta que la cara toca la piel
   * escaneada (p. ej. el párpado cerrado).
   */
  private applyContact(pose: ProbePose): void {
    let shift = 0;
    if (this.scanMesh) {
      const fwd = normalize(pose.forward);
      const hit = this.scanHit(
        add(pose.origin, scale(fwd, -CONTACT_RAY_START_MM)),
        fwd,
        CONTACT_RAY_START_MM + CONTACT_MAX_SHIFT_MM,
      );
      const s = hit ? hit.t - CONTACT_RAY_START_MM : 0;
      shift = Math.abs(s) <= CONTACT_MAX_SHIFT_MM ? s : 0;
      const d = scale(fwd, shift);
      this.probe.position.add(v3(d));
      this.planeGroup.position.copy(v3(d));
    } else {
      this.planeGroup.position.set(0, 0, 0);
    }
    // Desplazamiento visual (mm, a lo largo del haz) hasta la piel escaneada.
    this.canvas.dataset.contactMm = shift.toFixed(1);
  }

  /** Recoloca los anillos de las ventanas sobre la superficie escaneada. */
  private placeHotspotsOnScan(): void {
    for (const hs of this.hotspots) {
      let origin: Vec3;
      let inward: Vec3;
      if (hs.station === 'ojo') {
        origin = lidTarget(this.sim, hs.side);
        inward = [0, 0, -1];
      } else if (hs.station === 'temporal') {
        const wc = this.sim.head.windowCenter[hs.side];
        origin = wc;
        inward = normalize(sub(this.sim.head.midbrainCenter, wc));
      } else {
        const f = this.sim.neck[hs.side].frame;
        origin = f.origin;
        inward = normalize(f.beam);
      }
      const hit = this.scanHit(add(origin, scale(inward, -150)), inward, 220);
      if (!hit) continue;
      hs.mesh.position.copy(v3(add(hit.point, scale(inward, -1.5))));
      hs.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(scale(inward, -1)));
    }
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

  private addStylised(...objs: THREE.Object3D[]): void {
    this.scene.add(...objs);
    this.stylised.push(...objs);
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
    this.addStylised(scalp);
    // Cabello: casquete del elipsoide +9 mm recortado a y > centro + 20 mm.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.acos(20 / (r[1] + 9))),
      hairMat,
    );
    hairCap.position.copy(v3(c));
    hairCap.scale.set(r[0] + 9, r[1] + 9, r[2] + 9);
    this.addStylised(hairCap);
    // Cuello.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(34, 38, 70, 24), skin);
    neck.position.set(c[0], c[1] - r[1] - 24, c[2] - 8);
    this.addStylised(neck);
    // Mandíbula estilizada: el punto submandibular queda en su cara inferior.
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), skin);
    jaw.position.set(c[0], -56, 12);
    jaw.scale.set(50, 24, 52);
    this.addStylised(jaw);
    // Hotspots submandibulares (DEC-58): anillos bajo el ángulo mandibular,
    // perpendiculares al haz craneal por defecto.
    for (const side of ['der', 'izq'] as const) {
      const f = this.sim.neck[side].frame;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(SUBMANDIBULAR_HOTSPOT_MM, 1.0, 8, 36),
        new THREE.MeshBasicMaterial({
          color: '#4da3ff',
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );
      ring.position.copy(v3(add(f.origin, scale(f.beam, -1))));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(scale(f.beam, -1)));
      this.scene.add(ring);
      this.hotspots.push({ mesh: ring, station: 'submandibular', side });
    }
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
      this.addStylised(globe, iris, pupil, lidU, lidL, brow);
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
    this.addStylised(nose, noseTip, mouth);
    // Orejas: toros achatados a ±x a la altura de la ventana.
    for (const sx of [-1, 1] as const) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(10, 3.4, 10, 24), skin);
      ear.position.set(c[0] + sx * (r[0] + 5), c[1] - 10, c[2] + 2);
      ear.rotation.y = Math.PI / 2;
      ear.scale.set(1, 1.3, 0.6);
      this.addStylised(ear);
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
  /** Material del plano compartido: se crea una vez (DEC-54). */
  private readonly planeMat = new THREE.MeshBasicMaterial({
    color: '#4da3ff',
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  private updateScanPlane(s: AppState, pose: ProbePose, scan: ScanGeometry | null): void {
    // Liberar las geometrías previas (antes se acumulaban en la GPU).
    this.planeGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.planeGroup.clear();
    if (!scan) return;
    const depth = s.settings.depthMm;
    const basis = probeBasis(pose);
    const apex = v3(basis.origin);
    const mat = this.planeMat;
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
    const hits = this.raycaster.intersectObject(this.scanMesh ?? this.scalp, false);
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
