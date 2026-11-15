// "Engraving" look for terrain, like 19th-century crater drawings: white paper, black ink, short pen strokes
// (hachures) running down every slope and getting heavier on the side turned away from the Sun, faint contour
// lines, and cross-hatching in shadow. Built on MeshLambertMaterial so real lighting and shadow maps still decide
// what is dark. Optionally, permanently shadowed ground is drawn in blue-black ink with fine horizontal ruling.
// Owner: Visualization.
import * as THREE from "three";

export const PAPER = "#f6f3ea";
export const INK = "#1a1714";
/** Permanently shadowed ground: blue-black ink, ruled like the water on old engraved maps. */
export const PSR_INK = "#1c3352";

export interface EngravingOptions {
  interval: number; // contour spacing in world units (vertical)
  hatch: number; // hachure spacing in world units (horizontal)
  contour?: number; // contour line strength, 0..1 (faint on the top surface, full on the cut sides)
  hachure?: number; // down-slope stroke strength, 0..1 (off on the vertical cut sides)
  psr?: boolean; // the geometry has an `aPsr` attribute (0..1 permanently shadowed): rule it in PSR_INK
}

/** Linear brightness of flat white ground lit by a directional light at `sunAltDeg` plus ambient (three.js Lambert). */
export const flatBrightness = (sunAltDeg: number, dirIntensity: number, ambient: number) =>
  (dirIntensity * Math.max(Math.sin((sunAltDeg * Math.PI) / 180), 0.02) + ambient) / Math.PI;

const PSR_VERT_DECL = `
attribute float aPsr;
varying float vPsr;`;
const PSR_VERT_MAIN = `
vPsr = aPsr;`;
const PSR_FRAG = `
  // permanently shadowed: blue-black wash with fine horizontal ruling, and a thin outline at its edge
  float inPsr = smoothstep(0.35, 0.65, vPsr);
  float rule = inkLine(vWorldP.y / (uHatch * 0.55), 0.8);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uPsrInk, inPsr * max(rule, 0.38));
  float edge = abs(vPsr - 0.5) / max(fwidth(vPsr), 1e-4);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uPsrInk, (1.0 - smoothstep(0.6, 1.6, edge)) * step(1e-3, fwidth(vPsr)));`;

export function engravingMaterial(o: EngravingOptions) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.toneMapped = false; // paper and ink colours come out exactly as written
  const uniforms = {
    uInterval: { value: o.interval },
    uHatch: { value: o.hatch },
    uContour: { value: o.contour ?? 1 },
    uHachure: { value: o.hachure ?? 1 },
    uFlat: { value: 0.1 }, // set with flatBrightness() whenever the Sun moves
    uPaper: { value: new THREE.Color(PAPER) },
    uInk: { value: new THREE.Color(INK) },
    uPsrInk: { value: new THREE.Color(PSR_INK) },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;" + (o.psr ? PSR_VERT_DECL : ""))
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;" + (o.psr ? PSR_VERT_MAIN : ""));
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWorldP;${o.psr ? "\nvarying float vPsr;" : ""}
uniform float uInterval, uHatch, uContour, uHachure, uFlat;
uniform vec3 uPaper, uInk, uPsrInk;
float inkLine(float t, float widthPx) {
  float fw = max(fwidth(t), 1e-5);
  float d = (0.5 - abs(fract(t) - 0.5)) / fw;
  // lines closer together than ~3 px fade out instead of turning the far distance solid black
  return (1.0 - smoothstep(widthPx - 0.6, widthPx + 0.6, d)) * (1.0 - smoothstep(0.2, 0.45, fw));
}
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
{
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114)); // linear light, before tone mapping
  float tone = clamp(0.55 + 0.45 * (lum - uFlat) / uFlat, 0.0, 1.0); // flat sunlit ground = mid-tone
  vec3 nrm = normalize(cross(dFdx(vWorldP), dFdy(vWorldP)));
  float slope = 1.0 - abs(nrm.z);
  // contour lines: fine, a little heavier where it is darker
  float ink = inkLine(vWorldP.z / uInterval, mix(0.9, 0.3, tone)) * uContour;
  // hachures: pen strokes running straight down the slope on all sloping ground, broken into staggered dashes
  // so they read as hand strokes; thick on the shaded side, hairlines in full sun
  vec2 g = nrm.xy / max(length(nrm.xy), 1e-4);
  float across = dot(vWorldP.xy, vec2(-g.y, g.x)) / uHatch;
  float along = dot(vWorldP.xy, g) / (uHatch * 3.5);
  float dash = smoothstep(0.08, 0.2, fract(along + hash1(floor(across))));
  ink = max(ink, inkLine(across, mix(1.5, 0.3, tone)) * smoothstep(0.03, 0.25, slope) * dash * uHachure);
  // shadow: diagonal cross-hatching
  float dark = (1.0 - smoothstep(0.12, 0.3, tone)) * uHachure; // off on the cut sides, where it reads as stripes
  ink = max(ink, dark * max(inkLine((vWorldP.x + vWorldP.y) / (uHatch * 0.7), 0.9), inkLine((vWorldP.x - vWorldP.y) / (uHatch * 0.7), 0.9)));
  ink = max(ink, dark * 0.35);
  ink = max(ink, (1.0 - tone) * 0.18); // light tonal wash so form still reads where lines fade out
  gl_FragColor.rgb = mix(uPaper, uInk, clamp(ink, 0.0, 1.0));${o.psr ? PSR_FRAG : ""}
}`);
  };
  // the shader text differs with/without PSR, so they must not share a compiled program
  m.customProgramCacheKey = () => (o.psr ? "engraving-v3-psr" : "engraving-v3");
  return { material: m, uniforms };
}
