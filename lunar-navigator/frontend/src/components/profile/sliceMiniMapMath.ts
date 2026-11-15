// Numbers behind the top-down mini-map: unpacking the horizon map, relief shading, and which pixels see the body.
// Owner: LEAD. No React in here, so the browser checks can import it and time it on its own.
import type { ShadowMap } from "../../types";

/** Elevations below this mark pixels outside the terrain data (the backend writes -99999 there). */
export const NO_TERRAIN_BELOW_M = -90000;

export interface MiniMap {
  map: ShadowMap;
  res: number;
  nAz: number; // directions per pixel (72 for a 5 degree step)
  pixelM: number; // width of one pixel on the ground
  horizon: Uint8Array; // res * res * nAz bytes; angle = byte * map.horizon_scale + map.horizon_offset
  relief: Uint8ClampedArray; // res * res * 4 RGBA: grey relief shading with a fixed light, clear where there is no terrain
  blank: number; // share of pixels with no terrain (0 to 1)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Relief shading with a fixed light from the north-west, 45 degrees up. It only shows the shape of the ground and
 * has nothing to do with the real Sun. Gentle ground is shaded as if it were steeper (up to 40 times) so that
 * wide maps, where a pixel is kilometres across, still read.
 */
export function reliefRGBA(elev: number[], res: number, pixelM: number): { rgba: Uint8ClampedArray; blank: number } {
  const n = res * res;
  const gx = new Float32Array(n), gy = new Float32Array(n);
  const ok = (i: number) => elev[i] > NO_TERRAIN_BELOW_M;
  let lo = Infinity, hi = -Infinity, sum = 0, count = 0;
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const i = r * res + c;
      if (!ok(i)) continue;
      const z = elev[i];
      if (z < lo) lo = z;
      if (z > hi) hi = z;
      // one-sided differences at the map edge and beside missing terrain
      const w = c > 0 && ok(i - 1) ? i - 1 : i, e = c < res - 1 && ok(i + 1) ? i + 1 : i;
      const nn = r > 0 && ok(i - res) ? i - res : i, s = r < res - 1 && ok(i + res) ? i + res : i;
      gx[i] = e === w ? 0 : (elev[e] - elev[w]) / ((e - w) * pixelM); // rise per metre toward the east
      gy[i] = nn === s ? 0 : (elev[nn] - elev[s]) / (((s - nn) / res) * pixelM); // toward the north
      sum += gx[i] * gx[i] + gy[i] * gy[i];
      count++;
    }
  }
  const rms = count ? Math.sqrt(sum / count) : 0;
  const steepen = rms > 0 ? Math.min(40, Math.max(1, 0.3 / rms)) : 1;
  const span = hi > lo ? hi - lo : 1;
  const L = [-0.5, 0.5, Math.SQRT1_2]; // east, north, up
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue; // stays clear
    const a = -gx[i] * steepen, b = -gy[i] * steepen;
    const shade = Math.max(0, (a * L[0] + b * L[1] + L[2]) / Math.sqrt(a * a + b * b + 1));
    const g = 34 + 200 * (0.82 * shade + 0.18 * ((elev[i] - lo) / span));
    rgba[4 * i] = g * 0.95;
    rgba[4 * i + 1] = g * 0.97;
    rgba[4 * i + 2] = g;
    rgba[4 * i + 3] = 255;
  }
  return { rgba, blank: n ? 1 - count / n : 0 };
}

/** Unpack a response once: the horizon bytes and the relief picture. */
export function unpack(map: ShadowMap): MiniMap {
  const res = map.res;
  const nAz = Math.round(360 / map.az_step_deg);
  const horizon = fromBase64(map.horizon_b64);
  if (horizon.length !== res * res * nAz || map.elevation_m.length !== res * res) throw new Error("The shadow map has the wrong size.");
  const pixelM = (map.size_km * 1000) / res;
  const { rgba, blank } = reliefRGBA(map.elevation_m, res, pixelM);
  return { map, res, nAz, pixelM, horizon, relief: rgba, blank };
}

/**
 * Which pixels cannot see the body. `hidden[i]` becomes 1 where the body's centre is at or below that pixel's
 * horizon in the body's direction (the horizon is interpolated between the two neighbouring azimuth steps).
 * Returns how many pixels are hidden. This is the only thing recomputed when the time slider moves.
 */
export function hiddenMask(m: MiniMap, alt: number, az: number, hidden: Uint8Array): number {
  const { horizon, nAz } = m;
  const a = ((((az % 360) + 360) % 360) / 360) * nAz;
  const k0 = Math.floor(a) % nAz, k1 = (k0 + 1) % nAz, f = a - Math.floor(a);
  const need = (alt - m.map.horizon_offset) / m.map.horizon_scale; // the body's altitude in byte units
  const n = m.res * m.res;
  let count = 0;
  for (let i = 0, j = 0; i < n; i++, j += nAz) {
    const h0 = horizon[j + k0];
    const h = h0 + (horizon[j + k1] - h0) * f;
    const dark = h >= need ? 1 : 0;
    hidden[i] = dark;
    count += dark;
  }
  return count;
}

/** The horizon (degrees, lander frame) of one pixel toward `az`, interpolated like the mask. */
export function horizonAt(m: MiniMap, row: number, col: number, az: number): number {
  const a = ((((az % 360) + 360) % 360) / 360) * m.nAz;
  const k0 = Math.floor(a) % m.nAz, k1 = (k0 + 1) % m.nAz, f = a - Math.floor(a);
  const j = (row * m.res + col) * m.nAz;
  return (m.horizon[j + k0] + (m.horizon[j + k1] - m.horizon[j + k0]) * f) * m.map.horizon_scale + m.map.horizon_offset;
}

/** Bearing (whole degrees clockwise from north, 0 to 359) of a point `east`, `north` of the centre. */
export function bearingOf(east: number, north: number): number {
  return ((Math.round((Math.atan2(east, north) * 180) / Math.PI) % 360) + 360) % 360;
}

/** A round length for the scale bar: the largest of 1, 2, 5 x 10^n km that is at most 40 % of the map. */
export function scaleBarKm(sizeKm: number): number {
  const max = sizeKm * 0.4;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  return max >= 5 * p ? 5 * p : max >= 2 * p ? 2 * p : p;
}

/** "165 m" or "2.1 km". */
export function fmtPixel(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "rgb(232, 163, 61)" to [232, 163, 61]; null when the browser gave something else. */
export function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
