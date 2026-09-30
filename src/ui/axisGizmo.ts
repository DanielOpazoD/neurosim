/**
 * Gizmo de ejes del paciente (DEC-59): L/R (izquierda/derecha del paciente,
 * ±x), S/I (superior/inferior, ±y) y A (anterior, +z), en la esquina
 * superior izquierda de la vista, con la orientación exacta de la cámara
 * principal. La vista de cabeza y el navegador usan la misma clase: con
 * cámaras enlazadas, el gizmo se ve idéntico en ambas y hace evidente que
 * miran desde el mismo lado.
 */
import * as THREE from 'three';

interface AxisSpec {
  readonly dir: [number, number, number];
  readonly label: string;
  readonly color: string;
}

const AXES: readonly AxisSpec[] = [
  { dir: [1, 0, 0], label: 'L', color: '#ef7a7a' },
  { dir: [-1, 0, 0], label: 'R', color: '#ef7a7a' },
  { dir: [0, 1, 0], label: 'S', color: '#7ad69a' },
  { dir: [0, -1, 0], label: 'I', color: '#7ad69a' },
  { dir: [0, 0, 1], label: 'A', color: '#7ab4ff' },
];

/** Tamaño del gizmo en píxeles CSS y margen a la esquina superior izquierda. */
export const GIZMO_CSS_PX = 58;
const GIZMO_MARGIN_PX = 6;

function labelSprite(text: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  );
  sprite.scale.set(0.62, 0.62, 1);
  return sprite;
}

export class AxisGizmo {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10);
  private readonly size = new THREE.Vector2();

  constructor() {
    for (const axis of AXES) {
      const d = new THREE.Vector3(...axis.dir);
      const positive = axis.label !== 'R' && axis.label !== 'I';
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        d.clone().multiplyScalar(0.95),
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: axis.color,
          transparent: !positive,
          opacity: positive ? 1 : 0.5,
          depthTest: false,
        }),
      );
      this.scene.add(line);
      const sprite = labelSprite(axis.label, axis.color);
      sprite.position.copy(d.multiplyScalar(1.3));
      this.scene.add(sprite);
    }
  }

  /** Pinta el gizmo en la esquina superior izquierda tras la escena principal. */
  render(renderer: THREE.WebGLRenderer, main: THREE.Camera): void {
    this.camera.quaternion.copy(main.quaternion);
    this.camera.position.set(0, 0, 4).applyQuaternion(main.quaternion);
    this.camera.updateMatrixWorld();
    renderer.getSize(this.size);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Esquina superior izquierda (el viewport de WebGL cuenta y desde abajo):
    // la sonda y su cable suelen ocupar las esquinas inferiores.
    const y = Math.max(0, this.size.y - GIZMO_CSS_PX - GIZMO_MARGIN_PX);
    renderer.setScissorTest(true);
    renderer.setScissor(GIZMO_MARGIN_PX, y, GIZMO_CSS_PX, GIZMO_CSS_PX);
    renderer.setViewport(GIZMO_MARGIN_PX, y, GIZMO_CSS_PX, GIZMO_CSS_PX);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.autoClear = autoClear;
  }
}
