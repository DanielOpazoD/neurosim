/**
 * Modelo 3D de la sonda compartido por el navegador anatómico y la vista de
 * cabeza interactiva. Transductor estilizado ~110 mm: placa de contacto
 * (huella según tipo), cuerpo capsular gris claro, empuñadura oscura,
 * muesca ámbar en el lado +lateral y cable. Mallas con nombre: foot, body,
 * top, marker, cable. Ejes locales: x = lateral, y = elevación, z = haz.
 */
import * as THREE from 'three';
import type { ProbePose } from '../domain/contracts';
import { cross, normalize, type Vec3 } from '../core/vec3';

const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

/** Huella del transductor en mm (lateral × elevación). */
export const FOOTPRINT = { linear: [50, 12] as const, sector: [26, 18] as const };

const SKIN_MAT = (transparent = false) =>
  new THREE.MeshStandardMaterial({
    color: '#cfd4da',
    roughness: 0.55,
    metalness: 0.15,
    ...(transparent ? { transparent: true, opacity: 0.6, depthWrite: false } : {}),
  });
const GRIP_MAT = () => new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.7, metalness: 0.1 });
const MARKER_MAT = () =>
  new THREE.MeshStandardMaterial({ color: '#e8b44a', emissive: '#e8b44a', emissiveIntensity: 0.4 });

/** Base ortonormal de la sonda: lateral, elevación y forward del haz. */
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

/** Placa de contacto según el tipo de transductor. */
function footMesh(linear: boolean, transparent = false): THREE.Mesh {
  const [w, d] = linear ? FOOTPRINT.linear : FOOTPRINT.sector;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, 3.2), SKIN_MAT(transparent));
  m.name = 'foot';
  m.position.set(0, 0, -1.6);
  return m;
}

/** Muesca ámbar del marcador en el borde +lateral de la huella. */
function markerMesh(linear: boolean): THREE.Mesh {
  const [w] = linear ? FOOTPRINT.linear : FOOTPRINT.sector;
  const m = new THREE.Mesh(new THREE.BoxGeometry(4.5, 9, 3.6), MARKER_MAT());
  m.name = 'marker';
  m.position.set(w / 2 - 2, 0, -4.6);
  return m;
}

export interface ProbeMeshOptions {
  /** Versión compacta para el navegador anatómico: huella + muñón + muesca,
   *  40 % transparente para no tapar la anatomía. */
  readonly compact?: boolean;
}

/** Sonda estilizada: huella + cuerpo + empuñadura + alivio + cable. */
export function buildProbeGroup(linear = true, opts: ProbeMeshOptions = {}): THREE.Group {
  const group = new THREE.Group();
  if (opts.compact) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(10.5, 12, 4, 16), SKIN_MAT(true));
    body.name = 'body';
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, -12);
    const marker = markerMesh(linear);
    (marker.material as THREE.MeshStandardMaterial).transparent = true;
    (marker.material as THREE.MeshStandardMaterial).opacity = 0.85;
    group.add(footMesh(linear, true), body, marker);
    group.userData.linear = linear;
    group.userData.compact = true;
    group.userData.body = body;
    group.userData.marker = marker;
    return group;
  }
  // Cuerpo capsular ~82 mm a lo largo de −z.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(10.5, 61, 6, 20), SKIN_MAT());
  body.name = 'body';
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0, -43.5);
  // Empuñadura oscura.
  const top = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 8.5, 11, 18), GRIP_MAT());
  top.name = 'top';
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 0, -90);
  // Alivio de tensión + cable oscuro de 80 mm.
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(5, 3, 8, 12), GRIP_MAT());
  relief.name = 'relief';
  relief.rotation.x = Math.PI / 2;
  relief.position.set(0, 0, -99);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 80, 8), GRIP_MAT());
  cable.name = 'cable';
  cable.rotation.x = Math.PI / 2;
  cable.position.set(0, 0, -143);
  group.add(footMesh(linear), body, top, relief, cable, markerMesh(linear));
  group.userData.linear = linear;
  group.userData.body = body;
  group.userData.top = top;
  group.userData.marker = group.children.find((o) => o.name === 'marker');
  return group;
}

/** Coloca el grupo sobre la pose y adapta la huella al tipo de transductor. */
export function updateProbePose(group: THREE.Group, pose: ProbePose, linear: boolean): void {
  const basis = probeBasis(pose);
  const m = new THREE.Matrix4().makeBasis(v3(basis.lateral), v3(basis.elevation), v3(basis.forward));
  group.setRotationFromMatrix(m);
  group.position.copy(v3(basis.origin));
  if (group.userData.linear !== linear) {
    group.userData.linear = linear;
    const compact = group.userData.compact === true;
    const oldFoot = group.children.find((o) => o.name === 'foot') as THREE.Mesh | undefined;
    const oldMarker = group.userData.marker as THREE.Mesh | undefined;
    if (oldFoot) {
      group.remove(oldFoot);
      oldFoot.geometry.dispose();
    }
    if (oldMarker) {
      group.remove(oldMarker);
      oldMarker.geometry.dispose();
    }
    const foot = footMesh(linear, compact);
    const marker = markerMesh(linear);
    if (compact) {
      (marker.material as THREE.MeshStandardMaterial).transparent = true;
      (marker.material as THREE.MeshStandardMaterial).opacity = 0.85;
    }
    group.add(foot, marker);
    group.userData.marker = marker;
  }
}
