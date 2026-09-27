export interface WebGl2Context {
  readonly gl: WebGL2RenderingContext;
  readonly floatColorBuffer: EXT_color_buffer_float;
}

export function createWebGl2Context(canvas: HTMLCanvasElement | OffscreenCanvas): WebGl2Context | null {
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;
  const floatColorBuffer = gl.getExtension('EXT_color_buffer_float');
  return floatColorBuffer ? { gl, floatColorBuffer } : null;
}

export function isWebGL2Available(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return createWebGl2Context(canvas) !== null;
}
