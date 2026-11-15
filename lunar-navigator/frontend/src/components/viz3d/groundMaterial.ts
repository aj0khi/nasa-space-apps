// Realistic lunar ground: matte regolith with procedural metre-scale roughness added in the shader
// (pebbles, pits and ripples too small for the mesh). It tilts the lighting per pixel, so a low Sun
// picks out texture the way it does in real surface photos. An ESTIMATE, like lib/regolith.ts.
// Owner: Visualization.
import * as THREE from "three";

export function groundMaterial(color = "#a9a7a1") {
  const m = new THREE.MeshLambertMaterial({ color });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWorldP;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
// height of the fine roughness (m) at a horizontal position
float rough(vec2 p) {
  float h = 0.0, a = 0.05, w = 1.2;
  for (int o = 0; o < 4; o++) { h += a * vnoise(p / w); a *= 0.5; w *= 0.5; }
  return h;
}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{
  // slope of the fine roughness by finite differences, faded out where a pixel covers more than ~1 m
  float px = length(fwidth(vWorldP.xy));
  float fade = 1.0 - smoothstep(0.4, 2.5, px);
  vec2 p = vWorldP.xy; float e = 0.08;
  vec2 g = vec2(rough(p + vec2(e, 0.0)) - rough(p - vec2(e, 0.0)), rough(p + vec2(0.0, e)) - rough(p - vec2(0.0, e))) / (2.0 * e);
  normal = normalize(normal - (viewMatrix * vec4(g * 0.45 * fade, 0.0, 0.0)).xyz);
}`);
  };
  m.customProgramCacheKey = () => "lunar-ground";
  return m;
}
