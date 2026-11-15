// "Engraving" look for terrain, like 19th-century crater drawings: paper, ink contour lines that get
// heavier on dark slopes, hachure strokes running down steep walls, and cross-hatching in shadow.
// Built on MeshLambertMaterial so real lighting and shadow maps still decide what is dark. Owner: Visualization.
import * as THREE from "three";

export interface EngravingOptions {
  interval: number; // contour spacing in world units (vertical)
  hatch: number; // hachure spacing in world units (horizontal)
}

/** Linear brightness of flat white ground lit by a directional light at `sunAltDeg` plus ambient (three.js Lambert). */
export const flatBrightness = (sunAltDeg: number, dirIntensity: number, ambient: number) =>
  (dirIntensity * Math.max(Math.sin((sunAltDeg * Math.PI) / 180), 0.02) + ambient) / Math.PI;

export function engravingMaterial(o: EngravingOptions) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.toneMapped = false; // paper and ink colours come out exactly as written
  const uniforms = {
    uInterval: { value: o.interval },
    uHatch: { value: o.hatch },
    uFlat: { value: 0.1 }, // set with flatBrightness() whenever the Sun moves
    uPaper: { value: new THREE.Color("#efe7d4") },
    uInk: { value: new THREE.Color("#2b2419") },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWorldP;
uniform float uInterval, uHatch, uFlat;
uniform vec3 uPaper, uInk;
float inkLine(float t, float widthPx) {
  float fw = max(fwidth(t), 1e-5);
  float d = (0.5 - abs(fract(t) - 0.5)) / fw;
  // lines closer together than ~3 px fade out instead of turning the far distance solid black
  return (1.0 - smoothstep(widthPx - 0.6, widthPx + 0.6, d)) * (1.0 - smoothstep(0.2, 0.45, fw));
}`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
{
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114)); // linear light, before tone mapping
  float tone = clamp(0.55 + 0.45 * (lum - uFlat) / uFlat, 0.0, 1.0); // flat sunlit ground = mid-tone
  vec3 nrm = normalize(cross(dFdx(vWorldP), dFdy(vWorldP)));
  float slope = 1.0 - abs(nrm.z);
  // contour lines: thicker where it is darker
  float ink = inkLine(vWorldP.z / uInterval, mix(1.8, 0.35, tone));
  // hachures: strokes running down the slope, only on steep ground, denser when dark
  vec2 g = nrm.xy / max(length(nrm.xy), 1e-4);
  float across = dot(vWorldP.xy, vec2(-g.y, g.x)) / uHatch;
  ink = max(ink, inkLine(across, mix(1.6, 0.0, tone)) * smoothstep(0.05, 0.35, slope));
  // shadow: diagonal cross-hatching
  float dark = 1.0 - smoothstep(0.12, 0.3, tone);
  ink = max(ink, dark * max(inkLine((vWorldP.x + vWorldP.y) / (uHatch * 0.7), 0.9), inkLine((vWorldP.x - vWorldP.y) / (uHatch * 0.7), 0.9)));
  ink = max(ink, dark * 0.35);
  ink = max(ink, (1.0 - tone) * 0.22); // light tonal wash so form still reads where lines fade out
  gl_FragColor.rgb = mix(uPaper, uInk, clamp(ink, 0.0, 1.0));
}`);
  };
  m.customProgramCacheKey = () => "engraving";
  return { material: m, uniforms };
}
