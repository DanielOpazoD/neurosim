import type { AcquisitionSettings } from '../../domain/contracts';
import type { BeamSpec } from '../../ultrasound/beam';
import { psfKernelsTexture } from '../../ultrasound/postIq';
import type { ScanGeometry } from '../../ultrasound/probe';
import { createWebGl2Context } from './context';
import compressSource from './shaders/compress.frag.glsl?raw';
import psfSource from './shaders/psf.frag.glsl?raw';
import scanConvertSource from './shaders/scanConvert.frag.glsl?raw';

const vertexSource = `#version 300 es
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}`;

export interface GlBmodeParams {
  readonly dz: number;
  readonly scan: ScanGeometry;
  readonly settings: AcquisitionSettings;
  readonly beam: BeamSpec;
  /** 0 = lineal, 1 = sigmoide, 2 = gamma 0,8 (ui/scanConvert.ts). */
  readonly grayMap?: number;
}

export class GlBmodePipeline {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly psfProgram: WebGLProgram;
  private readonly compressProgram: WebGLProgram;
  private readonly scanProgram: WebGLProgram;
  private readonly psfFramebuffer: WebGLFramebuffer;
  private readonly dbFramebuffer: WebGLFramebuffer;
  private readonly iqTexture: WebGLTexture;
  private readonly axialTexture: WebGLTexture;
  private readonly lateralTexture: WebGLTexture;
  private readonly tgcTexture: WebGLTexture;
  private readonly rowGainTexture: WebGLTexture;
  private readonly psfTexture: WebGLTexture;
  private readonly dbTexture: WebGLTexture;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private axialRadius = 0;
  private lateralRadius = 0;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    psfProgram: WebGLProgram,
    compressProgram: WebGLProgram,
    scanProgram: WebGLProgram,
  ) {
    this.gl = gl;
    this.psfProgram = psfProgram;
    this.compressProgram = compressProgram;
    this.scanProgram = scanProgram;
    this.vao = this.must(gl.createVertexArray());
    this.psfFramebuffer = this.must(gl.createFramebuffer());
    this.dbFramebuffer = this.must(gl.createFramebuffer());
    this.iqTexture = this.must(gl.createTexture());
    this.axialTexture = this.must(gl.createTexture());
    this.lateralTexture = this.must(gl.createTexture());
    this.tgcTexture = this.must(gl.createTexture());
    this.rowGainTexture = this.must(gl.createTexture());
    this.psfTexture = this.must(gl.createTexture());
    this.dbTexture = this.must(gl.createTexture());
    gl.bindVertexArray(this.vao);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.BLEND);
  }

  static create(canvas: HTMLCanvasElement): GlBmodePipeline | null {
    const context = createWebGl2Context(canvas);
    if (!context) return null;
    const { gl } = context;
    try {
      const psfProgram = linkProgram(gl, vertexSource, psfSource);
      const compressProgram = linkProgram(gl, vertexSource, compressSource);
      const scanProgram = linkProgram(gl, vertexSource, scanConvertSource);
      return new GlBmodePipeline(canvas, gl, psfProgram, compressProgram, scanProgram);
    } catch (error) {
      console.warn('WebGL2 B-mode pipeline unavailable', error);
      return null;
    }
  }

  render(iq: Float32Array, width: number, height: number, params: GlBmodeParams): void {
    const gl = this.gl;
    const kernels = psfKernelsTexture(width, height, params.dz, params.scan, params.beam);
    this.ensureSourceTextures(width, height, kernels.axial.w.length, kernels.lateralRadius);
    this.uploadFloatTexture(this.iqTexture, width, height, iq, gl.RG);
    this.uploadFloatTexture(this.axialTexture, kernels.axial.w.length, 1, kernels.axial.w, gl.RED);
    this.uploadFloatTexture(
      this.lateralTexture,
      kernels.lateralRadius * 2 + 1,
      height,
      kernels.lateral,
      gl.RED,
    );
    this.uploadFloatTexture(
      this.tgcTexture,
      params.settings.tgcDb.length,
      1,
      Float32Array.from(params.settings.tgcDb),
      gl.RED,
    );
    this.uploadFloatTexture(this.rowGainTexture, 1, height, kernels.rowGain, gl.RED);

    gl.bindVertexArray(this.vao);
    gl.useProgram(this.psfProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.psfFramebuffer);
    gl.viewport(0, 0, width, height);
    bindTexture(gl, this.iqTexture, 0, this.psfProgram, 'uIq');
    bindTexture(gl, this.axialTexture, 1, this.psfProgram, 'uAxial');
    bindTexture(gl, this.lateralTexture, 2, this.psfProgram, 'uLateral');
    bindTexture(gl, this.rowGainTexture, 3, this.psfProgram, 'uRowGain');
    uniform1i(gl, this.psfProgram, 'uAxialRadius', kernels.axial.r);
    uniform1i(gl, this.psfProgram, 'uLateralRadius', kernels.lateralRadius);
    uniform1i(gl, this.psfProgram, 'uKernelWidth', kernels.lateralRadius * 2 + 1);
    uniform2f(gl, this.psfProgram, 'uSize', width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.compressProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dbFramebuffer);
    gl.viewport(0, 0, width, height);
    bindTexture(gl, this.psfTexture, 0, this.compressProgram, 'uPsf');
    bindTexture(gl, this.tgcTexture, 1, this.compressProgram, 'uTgc');
    uniform1f(gl, this.compressProgram, 'uMaxRef', 4);
    uniform1f(gl, this.compressProgram, 'uGainDb', params.settings.gainDb);
    uniform2f(gl, this.compressProgram, 'uSize', width, height);
    uniform1f(gl, this.compressProgram, 'uDepthMm', params.settings.depthMm);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.scanProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    bindTexture(gl, this.dbTexture, 0, this.scanProgram, 'uDb');
    uniform2f(gl, this.scanProgram, 'uSourceSize', width, height);
    uniform2f(gl, this.scanProgram, 'uCanvasSize', this.canvas.width, this.canvas.height);
    uniform1f(gl, this.scanProgram, 'uDepthMm', params.settings.depthMm);
    uniform1f(gl, this.scanProgram, 'uDynamicRangeDb', params.settings.dynamicRangeDb);
    uniform1f(gl, this.scanProgram, 'uWidthMmOrRad', params.scan.widthMmOrRad);
    uniform1i(gl, this.scanProgram, 'uKind', params.scan.kind === 'linear' ? 0 : 1);
    uniform1i(gl, this.scanProgram, 'uGrayMap', params.grayMap ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private ensureSourceTextures(
    width: number,
    height: number,
    axialLength: number,
    lateralRadius: number,
  ): void {
    if (
      width === this.sourceWidth &&
      height === this.sourceHeight &&
      axialLength === this.axialRadius &&
      lateralRadius === this.lateralRadius
    ) {
      return;
    }
    const gl = this.gl;
    this.sourceWidth = width;
    this.sourceHeight = height;
    this.axialRadius = axialLength;
    this.lateralRadius = lateralRadius;
    allocateFloatTexture(gl, this.iqTexture, width, height, 2);
    allocateFloatTexture(gl, this.axialTexture, axialLength, 1, 1);
    allocateFloatTexture(gl, this.lateralTexture, lateralRadius * 2 + 1, height, 1);
    allocateFloatTexture(gl, this.tgcTexture, 8, 1, 1);
    allocateFloatTexture(gl, this.rowGainTexture, 1, height, 1);
    allocateFloatTexture(gl, this.psfTexture, width, height, 2);
    allocateFloatTexture(gl, this.dbTexture, width, height, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.psfFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.psfTexture, 0);
    assertFramebuffer(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dbFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.dbTexture, 0);
    assertFramebuffer(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private uploadFloatTexture(
    texture: WebGLTexture,
    width: number,
    height: number,
    data: Float32Array,
    format: number,
  ): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, gl.FLOAT, data);
  }

  private must<T>(value: T | null): T {
    if (!value) throw new Error('WebGL2 resource unavailable');
    return value;
  }
}

function allocateFloatTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
  channels: 1 | 2,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const internal = channels === 2 ? gl.RG32F : gl.R32F;
  const format = channels === 2 ? gl.RG : gl.RED;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.FLOAT, null);
}

function bindTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  unit: number,
  program: WebGLProgram,
  name: string,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1i(location, unit);
}

function uniform1i(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1i(location, value);
}

function uniform1f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1f(location, value);
}

function uniform2f(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform2f(location, x, y);
}

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 program unavailable');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 program link failed');
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 shader unavailable');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL2 shader compile failed');
  }
  return shader;
}

function assertFramebuffer(gl: WebGL2RenderingContext): void {
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('WebGL2 float framebuffer unavailable');
  }
}
