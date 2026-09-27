#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uIq;
uniform sampler2D uAxial;
uniform sampler2D uLateral;
uniform int uAxialRadius;
uniform int uLateralRadius;
uniform int uKernelWidth;
uniform vec2 uSize;

out float outValue;

float axialValue(ivec2 p) {
  float value = 0.0;
  for (int t = -64; t <= 64; ++t) {
    if (t < -uAxialRadius || t > uAxialRadius) continue;
    int z = clamp(p.y + t, 0, int(uSize.y) - 1);
    value += texelFetch(uIq, ivec2(p.x, z), 0).r *
      texelFetch(uAxial, ivec2(t + uAxialRadius, 0), 0).r;
  }
  return value;
}

void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy - vec2(0.5)));
  float lateral = 0.0;
  for (int t = -64; t <= 64; ++t) {
    if (t < -uLateralRadius || t > uLateralRadius) continue;
    int x = clamp(p.x + t, 0, int(uSize.x) - 1);
    float weight = texelFetch(uLateral, ivec2(t + uLateralRadius, p.y), 0).r;
    lateral += axialValue(ivec2(x, p.y)) * weight;
  }
  outValue = lateral;
}
