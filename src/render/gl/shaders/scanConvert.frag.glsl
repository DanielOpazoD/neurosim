#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uDb;
uniform vec2 uSourceSize;
uniform vec2 uCanvasSize;
uniform float uDepthMm;
uniform float uDynamicRangeDb;
uniform float uWidthMmOrRad;
uniform int uKind;

out vec4 outColor;

void main() {
  vec2 pixel = vec2(gl_FragCoord.x - 0.5, uCanvasSize.y - gl_FragCoord.y - 0.5);
  float db;
  if (uKind == 0) {
    float sx = uCanvasSize.x / uSourceSize.x;
    float sy = uCanvasSize.y / uSourceSize.y;
    int sourceX = -1;
    int sourceY = -1;
    for (int i = 0; i < 1024; ++i) {
      if (float(i) >= uSourceSize.x) break;
      float x0 = floor(float(i) * sx);
      if (pixel.x >= x0 && pixel.x < x0 + sx + 1.0) sourceX = i;
    }
    for (int i = 0; i < 1024; ++i) {
      if (float(i) >= uSourceSize.y) break;
      float y0 = floor(float(i) * sy);
      if (pixel.y >= y0 && pixel.y < y0 + sy + 1.0) sourceY = i;
    }
    if (sourceX < 0 || sourceY < 0) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    ivec2 p = ivec2(sourceX, sourceY);
    db = texelFetch(uDb, p, 0).r;
  } else {
    float halfWidth = uWidthMmOrRad * 0.5;
    float cx = uCanvasSize.x * 0.5;
    float rMax = min(uCanvasSize.y * 1.15, length(vec2(uCanvasSize.x * 0.5, uCanvasSize.y)));
    float scale = rMax / uDepthMm;
    float dx = pixel.x - cx;
    float dy = pixel.y;
    float r = length(vec2(dx, dy)) / scale;
    float a = atan(dx, dy);
    if (a < -halfWidth || a > halfWidth || r >= uDepthMm || r < 0.0) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    int z = int(floor((r / uDepthMm) * uSourceSize.y));
    int x = int(floor(((a + halfWidth) / (2.0 * halfWidth)) * uSourceSize.x));
    db = texelFetch(uDb, ivec2(x, z), 0).r;
  }
  float gray = clamp(db / uDynamicRangeDb + 1.0, 0.0, 1.0);
  outColor = vec4(vec3(gray), 1.0);
}
