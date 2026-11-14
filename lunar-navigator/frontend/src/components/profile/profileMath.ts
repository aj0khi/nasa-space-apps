// Shadow geometry along a vertical slice through the terrain. Owner: SKY3D. Checked by GEO.
//
// The Sun's direction is projected onto the plane of the slice:
//   tan(apparent angle) = tan(sun elevation) / |cos(sun azimuth − slice bearing)|
// A Sun shining along the slice gives the real elevation. A Sun shining across it looks steeper
// in the slice. Shadows only come from terrain *on* this line. Real terrain beside the line can
// also cast shadows (the 2D map's Shadows tab uses the full grid for that).

import type { SeriesPoint } from "../../types";

const D = Math.PI / 180;

/** x: metres along the slice, negative = back (bearing+180), positive = toward `bearing`. z: elevation (m). */
export interface Slice { x: number[]; z: number[] }

export function stitch(back: { distance_m: number[]; elevation_m: number[] }, fwd: { distance_m: number[]; elevation_m: number[] }): Slice {
  return {
    x: [...back.distance_m.slice(1).map((d) => -d).reverse(), ...fwd.distance_m],
    z: [...back.elevation_m.slice(1).reverse(), ...fwd.elevation_m],
  };
}

export interface InSection { up: boolean; tanA: number; apparent: number; sunRight: boolean }

export function inSection(sunAlt: number, sunAz: number, bearing: number): InSection {
  const c = Math.cos((sunAz - bearing) * D);
  if (sunAlt <= 0) return { up: false, tanA: NaN, apparent: sunAlt, sunRight: c > 0 };
  if (Math.abs(c) < 1e-6) return { up: true, tanA: Infinity, apparent: 90, sunRight: true };
  const tanA = Math.tan(sunAlt * D) / Math.abs(c);
  return { up: true, tanA, apparent: Math.atan(tanA) / D, sunRight: c > 0 };
}

/** lit[i]: does point i see the Sun? top[i]: height of the shadow edge above point i (= z where lit). */
export function shade(s: Slice, sun: InSection): { lit: boolean[]; top: number[] } {
  const n = s.x.length;
  const top = s.z.slice();
  if (!sun.up) return { lit: new Array(n).fill(false), top };
  if (!Number.isFinite(sun.tanA)) return { lit: new Array(n).fill(true), top };
  const lit = new Array<boolean>(n);
  let h = -Infinity; // shadow line height, swept away from the Sun
  let prev = -1;
  for (let k = 0; k < n; k++) {
    const i = sun.sunRight ? n - 1 - k : k;
    if (prev >= 0) h -= Math.abs(s.x[i] - s.x[prev]) * sun.tanA;
    lit[i] = s.z[i] >= h - 0.5;
    top[i] = Math.max(h, s.z[i]);
    h = Math.max(h, s.z[i]);
    prev = i;
  }
  return { lit, top };
}

export type Body = "sun" | "earth";

/** Hours of direct sun (or of direct line of sight to Earth) at every point across the whole time series. */
export function sunHours(s: Slice, series: SeriesPoint[], bearing: number, body: Body = "sun"): number[] {
  const hours = new Array(s.x.length).fill(0);
  // each sample stands for the interval up to the next one, so the total equals the series span
  for (let j = 0; j + 1 < series.length; j++) {
    const a = series[j], b = series[j + 1];
    const dtH = (Date.parse(b.time) - Date.parse(a.time)) / 3.6e6;
    const sun = body === "sun" ? inSection(a.sun_alt, a.sun_az, bearing) : inSection(a.earth_alt, a.earth_az, bearing);
    if (!sun.up) continue;
    const { lit } = shade(s, sun);
    for (let i = 0; i < lit.length; i++) if (lit[i]) hours[i] += dtH;
  }
  return hours;
}

export function nearestIndex(series: SeriesPoint[], t: Date): number {
  let best = 0, bestD = Infinity;
  const ms = t.getTime();
  for (let i = 0; i < series.length; i++) {
    const d = Math.abs(Date.parse(series[i].time) - ms);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
