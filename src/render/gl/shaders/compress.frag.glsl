#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPsf;
uniform sampler2D uTgc;
uniform float uMaxRef;
uniform float uGainDb;

out float outValue;

void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy - vec2(0.5)));
  float tgc = texelFetch(uTgc, ivec2(p.y, 0), 0).r;
  float value = length(texelFetch(uPsf, p, 0).rg) / uMaxRef;
  outValue = 20.0 * log(value + 1e-6) / log(10.0) + uGainDb + tgc;
}
