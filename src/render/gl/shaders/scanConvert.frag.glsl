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
uniform int uGrayMap;

out vec4 outColor;

float sampleDb(vec2 f) {
  float x = clamp(f.x, 0.0, uSourceSize.x - 1.0);
  float y = clamp(f.y, 0.0, uSourceSize.y - 1.0);
  int x0 = int(floor(x));
  int y0 = int(floor(y));
  int x1 = min(int(uSourceSize.x) - 1, x0 + 1);
  int y1 = min(int(uSourceSize.y) - 1, y0 + 1);
  float tx = x - float(x0);
  float ty = y - float(y0);
  float a = texelFetch(uDb, ivec2(x0, y0), 0).r;
  float b = texelFetch(uDb, ivec2(x1, y0), 0).r;
  float c = texelFetch(uDb, ivec2(x0, y1), 0).r;
  float d = texelFetch(uDb, ivec2(x1, y1), 0).r;
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x - 0.5, uCanvasSize.y - gl_FragCoord.y - 0.5);
  float db;
  if (uKind == 0) {
    float sx = uCanvasSize.x / uSourceSize.x;
    float sy = uCanvasSize.y / uSourceSize.y;
    db = sampleDb(vec2((pixel.x + 0.5) / sx - 0.5, (pixel.y + 0.5) / sy - 0.5));
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
    db = sampleDb(vec2(
      ((a + halfWidth) / (2.0 * halfWidth)) * uSourceSize.x - 0.5,
      (r / uDepthMm) * uSourceSize.y - 0.5));
  }
  float x = clamp(db / uDynamicRangeDb + 1.0, 0.0, 1.0);
  // Mapas compartidos con ui/scanConvert.ts (grayMap): mantener idénticos.
  float gray;
  if (uGrayMap == 1) gray = 0.5 * x + 0.5 * x * x * (3.0 - 2.0 * x);
  else if (uGrayMap == 2) gray = pow(x, 0.8);
  else gray = x;
  outColor = vec4(vec3(gray), 1.0);
}
