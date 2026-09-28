#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPsf;
uniform sampler2D uTgc;
uniform float uMaxRef;
uniform float uGainDb;
uniform vec2 uSize;
uniform float uDepthMm;

out float outValue;

void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy - vec2(0.5)));
  float z = float(p.y) / max(1.0, uSize.y - 1.0);
  float tgcIndex = z * 7.0;
  int i0 = int(floor(tgcIndex));
  int i1 = min(7, i0 + 1);
  float f = fract(tgcIndex);
  float tgc = mix(texelFetch(uTgc, ivec2(i0, 0), 0).r, texelFetch(uTgc, ivec2(i1, 0), 0).r, f);
  float value = length(texelFetch(uPsf, p, 0).rg) / uMaxRef;
  outValue = 20.0 * log(value + 1e-6) / log(10.0) + uGainDb + tgc;
}
