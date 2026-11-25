// The default gameplay note material is independent of the editor's CSS.
export const NOTE_GLOW_PADDING = '12.0'

export const NOTE_APPEARANCE = `
float roundedRectDistance(vec2 point, vec2 halfSize, float radius) {
  vec2 edge = abs(point) - halfSize + radius;
  return length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0) - radius;
}

vec4 shadeNeonEdge(vec3 fill, vec3 color, float distance, float rimWidth,
                   float antialias, float glowRadius, float glowStrength) {
  float solid = 1.0 - smoothstep(-antialias, antialias, distance);
  float rim = smoothstep(-rimWidth - antialias, -rimWidth + antialias, distance);
  float halo = 1.0 - smoothstep(0.0, glowRadius, distance);
  vec3 edge = mix(color, vec3(1.0), 0.57);
  vec3 surface = mix(fill, edge, rim);
  return vec4(mix(color, surface, solid), solid + (1.0 - solid) * halo * halo * glowStrength);
}

vec4 shadeNoteHead(vec3 color, vec2 point, vec2 halfSize, float antialias,
                   float glowRadius, float glowStrength) {
  float size = min(halfSize.x, halfSize.y);
  float radius = size * 0.51;
  float rimWidth = size * 0.11;
  float gapWidth = size * 0.144;
  float inset = rimWidth + gapWidth;
  float distance = roundedRectDistance(point, halfSize, radius);
  float innerDistance = roundedRectDistance(point, halfSize - inset, size * 0.16);
  float inner = 1.0 - smoothstep(-antialias, antialias, innerDistance);
  float vertical = clamp(point.y / max(2.0 * halfSize.y, 0.001) + 0.5, 0.0, 1.0);
  vec3 brightFill = mix(color, vec3(1.0), mix(0.37, 0.16, vertical)) * 0.95;
  vec3 fill = mix(color * 0.48, brightFill, inner);
  return shadeNeonEdge(fill, color, distance, rimWidth, antialias, glowRadius, glowStrength * 0.8);
}

vec4 shadeHoldBody(vec3 color, vec2 point, vec2 halfSize, float antialias,
                   float glowRadius, float glowStrength, float isHeld) {
  vec2 edge = abs(point) - halfSize;
  float distance = length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0);
  float x = abs(point.x) / max(halfSize.x, 0.001);
  float center = 1.0 - smoothstep(0.0, 0.91, x);
  vec3 idleFill = color * mix(0.26, 0.59, center);
  vec3 heldFill = mix(color * 0.93, vec3(1.0), 0.13 + 0.18 * center);
  float borderGap = smoothstep(0.87, 0.91, x);
  vec3 fill = mix(mix(idleFill, heldFill, isHeld), color * mix(0.19, 0.33, isHeld), borderGap);

  // The dark center channel switches to an emissive strip and soft spill.
  float channelDistance = abs(point.x) - halfSize.x * 0.044;
  float channel = 1.0 - smoothstep(-antialias, antialias, channelDistance);
  float spill = 1.0 - smoothstep(0.044, 0.24, x);
  fill = mix(fill, mix(color, vec3(1.0), 0.82), spill * isHeld * 0.33);
  fill = mix(fill, mix(color * 0.095, mix(color, vec3(1.0), 0.92), isHeld), channel);
  return shadeNeonEdge(fill, color, distance, halfSize.x * 0.027, antialias,
    glowRadius * mix(0.60, 0.96, isHeld), glowStrength * mix(0.38, 0.81, isHeld));
}

vec4 noteOver(vec4 head, vec4 body) {
  float behind = body.a * (1.0 - head.a);
  float coverage = head.a + behind;
  return vec4((head.rgb * head.a + body.rgb * behind) / max(coverage, 0.001), coverage);
}
`
