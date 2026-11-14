// Topographic maths: rotate an elevation tile so a chosen line runs left→right, trace contour lines
// (marching squares), and pick a tidy contour interval. Owner: Visualization.
//
// Tile convention (terrain.py): row 0 = north edge, col 0 = west edge, site at the centre.
// Rotated frame: u → right (along the slice bearing), v → down. Both in km from the centre.
//   east  = u·sinβ + v·cosβ
//   north = u·cosβ − v·sinβ
import { project } from "./geo";

const D = Math.PI / 180;

export interface Rotated {
  n: number; // n×n samples
  half: number; // km from centre to edge
  z: Float64Array; // elevation (m), NaN outside the source tile
  shadow: Uint8Array | null; // 1 = shadow, 0 = lit, 255 = unknown
}

/** u,v (km) → east,north (km) */
export const toEN = (u: number, v: number, b: number) => ({
  e: u * Math.sin(b * D) + v * Math.cos(b * D),
  n: u * Math.cos(b * D) - v * Math.sin(b * D),
});

/** east,north (km) → u,v (km) */
export const toUV = (e: number, n: number, b: number) => ({
  u: e * Math.sin(b * D) + n * Math.cos(b * D),
  v: e * Math.cos(b * D) - n * Math.sin(b * D),
});

/** Resample the tile into the rotated frame (bilinear for height, nearest for the shadow mask). */
export function rotate(grid: number[][], sizeKm: number, bearing: number, n: number, mask?: number[][] | null): Rotated {
  const m = grid.length;
  const half = sizeKm / 2;
  const px = sizeKm / (m - 1);
  const z = new Float64Array(n * n);
  const shadow = mask ? new Uint8Array(n * n) : null;
  // keep the rotated square inside the source tile's inscribed circle
  const r = half / Math.SQRT2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) - 0.5) * 2 * r;
      const v = (j / (n - 1) - 0.5) * 2 * r;
      const { e, n: no } = toEN(u, v, bearing);
      const c = (e + half) / px, rr = (half - no) / px;
      const k = j * n + i;
      if (c < 0 || rr < 0 || c > m - 1 || rr > m - 1) { z[k] = NaN; if (shadow) shadow[k] = 255; continue; }
      const c0 = Math.min(m - 2, Math.floor(c)), r0 = Math.min(m - 2, Math.floor(rr));
      const fc = c - c0, fr = rr - r0;
      z[k] = (grid[r0][c0] * (1 - fc) + grid[r0][c0 + 1] * fc) * (1 - fr) + (grid[r0 + 1][c0] * (1 - fc) + grid[r0 + 1][c0 + 1] * fc) * fr;
      if (shadow && mask) shadow[k] = mask[Math.round(rr)][Math.round(c)] ? 0 : 1; // mask: 1 = lit
    }
  }
  return { n, half: r, z, shadow };
}

/** A tidy interval giving roughly `target` contour lines: 1, 2, 2.5 or 5 × 10^k metres. */
export function niceInterval(range: number, target = 14) {
  const raw = Math.max(range, 1) / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((s) => s * p >= raw) ?? 10) * p;
}

export function levels(min: number, max: number, step: number) {
  const out: number[] = [];
  for (let l = Math.ceil(min / step) * step; l <= max; l += step) out.push(+l.toFixed(6));
  return out;
}

/** Marching squares. Returns one SVG path per level, in grid units (0…n−1). */
export function contours(z: Float64Array, n: number, lv: number[]): string[] {
  return lv.map((t) => {
    let d = "";
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i + 1], e = z[(j + 1) * n + i];
        if (Number.isNaN(a + b + c + e)) continue;
        const code = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (e > t ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const f = (p: number, q: number) => (t - p) / (q - p);
        const top = `${(i + f(a, b)).toFixed(2)},${j}`;
        const right = `${i + 1},${(j + f(b, c)).toFixed(2)}`;
        const bottom = `${(i + f(e, c)).toFixed(2)},${j + 1}`;
        const left = `${i},${(j + f(a, e)).toFixed(2)}`;
        const seg = (p: string, q: string) => { d += `M${p}L${q}`; };
        switch (code) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    return d;
  });
}

/** Where another site sits on the tile, in km east/north of the centre (south polar stereographic, as the backend). */
export function offsetKm(center: { lat: number; lon: number }, p: { lat: number; lon: number }) {
  const a = project(center.lat, center.lon), b = project(p.lat, p.lon);
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = center.lon * D;
  const north = { x: Math.sin(l), y: -Math.cos(l) }, east = { x: Math.cos(l), y: Math.sin(l) };
  return { e: dx * east.x + dy * east.y, n: dx * north.x + dy * north.y };
}
