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

// ---------- Cross-section overhaul. Owner: LEAD. Additive: everything above is unchanged. ----------
//
// The slice now comes from GET /terrain/section as x_m / z_m in the lander's own frame: x along the
// slice, z up from the lander's ground point, with the Moon's curvature already in z. In that frame a
// light ray is a straight line, so the sweep above still works, and it also works for a Sun that sits
// a little BELOW the lander's horizontal (a high site can still see it, because the ground falls away).
// The yes / no answer for the lander itself does not come from the slice at all: it comes from the
// ray-traced skyline (GET /terrain/skyline), which looks in every direction, not just along this line.

/** Mean lunar radius (m), the same sphere the backend uses for curvature. */
export const R_MOON_M = 1_737_400;
/** Number of fixed slice directions (the A end points along one of them). */
export const STATES = 16;
export const STATE_STEP = 360 / STATES; // 22.5°
/** Height of the lander's "eye" above the ground (m). Same as the backend skyline observer. */
export const EYE_M = 2;
/** Apparent radius of the disc seen from the Moon (deg). From JPL Horizons angular diameters. */
export const DISC_RADIUS: Record<Body, number> = { sun: 0.27, earth: 0.95 };
/** Height scales on offer. 1 = true scale. */
export const EXAG_STEPS = [1, 2, 5, 10, 20];

const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Nearest of the 16 fixed slice directions (a multiple of 22.5°), 0 ≤ result < 360. */
export function snap16(az: number): number {
  return (Math.round(norm360(az) / STATE_STEP) % STATES) * STATE_STEP;
}

/** 1…16: which fixed direction the A end points along (1 = north, 5 = east, 9 = south, 13 = west). */
export function stateNumber(bearing: number): number {
  return (Math.round(norm360(bearing) / STATE_STEP) % STATES) + 1;
}

export function fromSection(sec: { x_m: number[]; z_m: number[] }): Slice {
  return { x: sec.x_m, z: sec.z_m };
}

/** Ground height at `x` (linear interpolation; s.x ascends). Null outside the slice. */
export function groundAt(s: Slice, x: number): number | null {
  const n = s.x.length;
  if (!n || x < s.x[0] || x > s.x[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.x[mid] <= x) lo = mid; else hi = mid;
  }
  if (hi === lo || s.x[hi] === s.x[lo]) return s.z[lo];
  const f = (x - s.x[lo]) / (s.x[hi] - s.x[lo]);
  return s.z[lo] * (1 - f) + s.z[hi] * f;
}

/** A body's direction projected into the slice. Unlike inSection, the angle is signed: it may be below horizontal. */
export interface InSlice {
  tanA: number; // tan of the apparent angle in the slice; ±Infinity when the body is square to the slice
  apparent: number; // that angle in degrees
  sunRight: boolean; // the body is toward the A end (+x)
  off: number; // angle between the body's azimuth and the slice line, 0…90°
  along: boolean; // the slice points at the body (or straight away from it) to within half a step
}

export function inSlice(alt: number, az: number, bearing: number): InSlice {
  const c = Math.cos((az - bearing) * D);
  const ac = Math.abs(c);
  const tanA = ac < 1e-6 ? (alt > 0 ? Infinity : alt < 0 ? -Infinity : 0) : Math.tan(alt * D) / ac;
  const off = Math.acos(Math.min(1, ac)) / D;
  return { tanA, apparent: Math.atan(tanA) / D, sunRight: c >= 0, off, along: off <= STATE_STEP / 2 + 1e-6 };
}

/**
 * Same sweep as `shade`, for a signed angle. `radiusM` is the Moon's radius when the slice has the
 * curvature in z (measured terrain), or Infinity for a flat slice (synthetic terrain).
 *
 * Only ground on this slice casts shadows. For a body below the lander's horizontal the sweep needs
 * to know what lies beyond the body-side end of the slice: it assumes the ground carries on around
 * the Moon at the height of that end. On a flat slice that means everything is dark, as before.
 */
export function shadeSlice(s: Slice, tanA: number, sunRight: boolean, radiusM = Infinity): { lit: boolean[]; top: number[] } {
  const n = s.x.length;
  const top = s.z.slice();
  if (!n || Number.isNaN(tanA) || tanA === -Infinity) return { lit: new Array(n).fill(false), top };
  if (tanA === Infinity) return { lit: new Array(n).fill(true), top };
  const first = sunRight ? n - 1 : 0;
  let h = -Infinity; // height of the shadow line, swept away from the body
  if (tanA < 0) {
    if (!Number.isFinite(radiusM)) return { lit: new Array(n).fill(false), top };
    // Highest shadow line that a smooth Moon beyond the end would throw onto the end of the slice.
    const gap = radiusM * -tanA - Math.abs(s.x[first]);
    h = s.z[first] + (gap > 0 ? (gap * gap) / (2 * radiusM) : 0);
  }
  const lit = new Array<boolean>(n);
  let any = false;
  let prev = -1;
  for (let k = 0; k < n; k++) {
    const i = sunRight ? n - 1 - k : k;
    if (prev >= 0) h -= Math.abs(s.x[i] - s.x[prev]) * tanA;
    lit[i] = s.z[i] >= h - 0.5;
    if (lit[i]) any = true;
    top[i] = Math.max(h, s.z[i]);
    h = Math.max(h, s.z[i]);
    prev = i;
  }
  // Fully dark (night): draw no shadow volume, like `shade` does.
  return any ? { lit, top } : { lit, top: s.z.slice() };
}

/** Like sunHours, on a slice from /terrain/section. Hours of direct light at every point of the still slice. */
export function lightHours(s: Slice, series: SeriesPoint[], bearing: number, body: Body = "sun", radiusM = Infinity): number[] {
  const hours = new Array(s.x.length).fill(0);
  for (let j = 0; j + 1 < series.length; j++) {
    const a = series[j], b = series[j + 1];
    const dtH = (Date.parse(b.time) - Date.parse(a.time)) / 3.6e6;
    const p = body === "sun" ? inSlice(a.sun_alt, a.sun_az, bearing) : inSlice(a.earth_alt, a.earth_az, bearing);
    if (p.tanA < 0 && !Number.isFinite(radiusM)) continue;
    const { lit } = shadeSlice(s, p.tanA, p.sunRight, radiusM);
    for (let i = 0; i < lit.length; i++) if (lit[i]) hours[i] += dtH;
  }
  return hours;
}

// ---- Ray-traced skyline: is the body in view from the lander? ----

/** Skyline height (deg) at any azimuth: linear between whole degrees, wrapping at 360. */
export function skylineAt(elev: number[], az: number): number {
  const n = elev.length;
  if (!n) return NaN;
  const x = (norm360(az) * n) / 360;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return elev[i] * (1 - f) + elev[(i + 1) % n] * f;
}

/** Distance (km) to the terrain that sets the skyline at this azimuth (nearest whole degree). Null when unknown. */
export function skylineDistAt(dist: (number | null)[], az: number): number | null {
  const n = dist.length;
  if (!n) return null;
  const v = dist[Math.round((norm360(az) * n) / 360) % n];
  return v == null || !Number.isFinite(v) ? null : v;
}

/** clear: the whole disc is above the skyline. partial: the skyline cuts the disc. hidden: all of it is below. */
export type Seen = "clear" | "partial" | "hidden";

export interface BodyView {
  horizon: number; // skyline height at the body's azimuth (deg)
  margin: number; // body altitude − skyline (deg); > 0 = the centre of the disc is in view
  state: Seen;
  blockerKm: number | null; // how far away the terrain that sets the skyline there is
}

export function bodyView(alt: number, az: number, sky: { elev_deg: number[]; dist_km: (number | null)[] }, body: Body): BodyView {
  const r = DISC_RADIUS[body];
  const horizon = skylineAt(sky.elev_deg, az);
  const margin = alt - horizon;
  const state: Seen = margin >= r ? "clear" : margin > -r ? "partial" : "hidden";
  return { horizon, margin, state, blockerKm: skylineDistAt(sky.dist_km, az) };
}

export interface Crossing { hours: number; rising: boolean }

/** Next time after sample `i` that the centre of the disc crosses the skyline (linear between samples). Null if it never does. */
export function nextCrossing(series: SeriesPoint[], i: number, elev: number[], body: Body): Crossing | null {
  if (i < 0 || i >= series.length || !elev.length) return null;
  const m = (p: SeriesPoint) => (body === "sun" ? p.sun_alt - skylineAt(elev, p.sun_az) : p.earth_alt - skylineAt(elev, p.earth_az));
  const t0 = Date.parse(series[i].time);
  let prev = m(series[i]);
  const up = prev > 0;
  for (let j = i + 1; j < series.length; j++) {
    const cur = m(series[j]);
    if (cur > 0 !== up) {
      const f = prev === cur ? 0 : prev / (prev - cur);
      const ta = Date.parse(series[j - 1].time), tb = Date.parse(series[j].time);
      return { hours: (ta + f * (tb - ta) - t0) / 3.6e6, rising: !up };
    }
    prev = cur;
  }
  return null;
}

export interface SightHit { x: number; z: number; distM: number }

/**
 * Where a straight line from the lander's eye (x = 0, `eyeM` above the ground) first meets the slice,
 * going toward +x (dir 1) or −x (dir −1) with slope `tanEl`. Null if it clears the slice.
 */
export function sightHit(s: Slice, dir: 1 | -1, tanEl: number, eyeM = EYE_M): SightHit | null {
  const z0 = groundAt(s, 0);
  const n = s.x.length;
  if (z0 == null || n < 2) return null;
  let prevA = 0, prevF = -eyeM; // f = ground − line; at the lander the line is eyeM above the ground
  for (let k = 0; k < n; k++) {
    const i = dir > 0 ? k : n - 1 - k;
    const a = dir * s.x[i];
    if (a <= 0) continue;
    const f = s.z[i] - (z0 + eyeM + a * tanEl);
    if (f >= 0) {
      const t = f === prevF ? 0 : -prevF / (f - prevF);
      const ah = prevA + t * (a - prevA);
      return { x: dir * ah, z: z0 + eyeM + ah * tanEl, distM: ah };
    }
    prevA = a;
    prevF = f;
  }
  return null;
}

/** "3.2 days", "7 hours". The series is hourly, so nothing finer than an hour is claimed. */
export function fmtDuration(hours: number): string {
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days`;
  if (hours >= 1.5) return `${Math.round(hours)} hours`;
  return hours >= 1 ? "about 1 hour" : "less than an hour";
}

/** Smallest height scale that gives the relief at least `wantPx` of height on screen. */
export function autoExag(reliefM: number, pxPerM: number, wantPx = 120): number {
  for (const e of EXAG_STEPS) if (reliefM * pxPerM * e >= wantPx) return e;
  return EXAG_STEPS[EXAG_STEPS.length - 1];
}

// ---------- Locked slice, events, true ground light. Owner: LEAD (panel). Additive: everything above is unchanged. ----------
//
// The slice no longer turns with the Sun by default: it is locked to one direction. A body is "in the page" when its
// azimuth is within PAGE_HALF_DEG of the slice line (either end). Only then is a sight line or a slice shadow drawn,
// and then at the body's TRUE elevation. Off the page nothing is projected: the marker sits at the true elevation.

/** A body this close (deg) to the slice line, at either end, is drawn in the slice. */
export const PAGE_HALF_DEG = STATE_STEP / 2;

/** Azimuth folded into 0 ≤ az < 360. */
export const normAz = (az: number) => norm360(az);

/** Nearest whole degree, 0…359. */
export const wholeDeg = (az: number) => Math.round(norm360(az)) % 360;

/** Signed difference a − b, in −180 < d ≤ 180. */
export function azDiff(a: number, b: number): number {
  const d = norm360(a - b);
  return d > 180 ? d - 360 : d;
}

/** Azimuth a fraction f of the way from a to b, going the short way round. */
export function azLerp(a: number, b: number, f: number): number {
  return norm360(a + azDiff(b, a) * f);
}

/** A moment when the centre of the disc crosses the ray-traced skyline. */
export interface SkyEvent {
  i: number; // the sample of the series just before the crossing
  timeMs: number; // when (linear between the two hourly samples)
  rising: boolean;
  az: number; // the body's azimuth at that moment (deg)
  alt: number; // its altitude at that moment (deg) = the skyline height there
  blockerKm: number | null; // how far away the terrain it crosses is
}

/** Every rise and set in the series, in time order. Same rule as `nextCrossing`. */
export function skyEvents(series: SeriesPoint[], sky: { elev_deg: number[]; dist_km: (number | null)[] }, body: Body): SkyEvent[] {
  const out: SkyEvent[] = [];
  if (series.length < 2 || !sky.elev_deg.length) return out;
  const alt = (p: SeriesPoint) => (body === "sun" ? p.sun_alt : p.earth_alt);
  const azi = (p: SeriesPoint) => (body === "sun" ? p.sun_az : p.earth_az);
  let prev = alt(series[0]) - skylineAt(sky.elev_deg, azi(series[0]));
  for (let j = 1; j < series.length; j++) {
    const a = series[j - 1], b = series[j];
    const cur = alt(b) - skylineAt(sky.elev_deg, azi(b));
    if (cur > 0 !== prev > 0) {
      const f = prev === cur ? 0 : prev / (prev - cur);
      const ta = Date.parse(a.time), tb = Date.parse(b.time);
      const az = azLerp(azi(a), azi(b), f);
      out.push({ i: j - 1, timeMs: ta + f * (tb - ta), rising: cur > 0, az, alt: alt(a) + f * (alt(b) - alt(a)), blockerKm: skylineDistAt(sky.dist_km, az) });
    }
    prev = cur;
  }
  return out;
}

/** Hours in the series with the centre of the disc above the skyline. Each sample stands for the interval up to the next. */
export function hoursInView(series: SeriesPoint[], elev: number[], body: Body): number {
  let h = 0;
  for (let j = 0; j + 1 < series.length; j++) {
    const p = series[j];
    const m = body === "sun" ? p.sun_alt - skylineAt(elev, p.sun_az) : p.earth_alt - skylineAt(elev, p.earth_az);
    if (m > 0) h += (Date.parse(series[j + 1].time) - Date.parse(p.time)) / 3.6e6;
  }
  return h;
}

/** Index of the entry of `timesMs` (ascending) nearest to `tMs`, or −1 when none is within `tolMs`. Matches by time, not by position. */
export function timeIndex(timesMs: number[], tMs: number, tolMs: number): number {
  const n = timesMs.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesMs[mid] <= tMs) lo = mid; else hi = mid;
  }
  const best = Math.abs(timesMs[hi] - tMs) < Math.abs(timesMs[lo] - tMs) ? hi : lo;
  return Math.abs(timesMs[best] - tMs) <= tolMs ? best : -1;
}

/** For each x of `xs`: index of the nearest entry of `grid` (ascending), or −1 when x lies more than one grid step outside it. */
export function nearestOnGrid(grid: number[], xs: number[]): number[] {
  const n = grid.length;
  if (n < 2) return xs.map(() => (n ? 0 : -1));
  const step = (grid[n - 1] - grid[0]) / (n - 1);
  return xs.map((x) => {
    if (x < grid[0] - step || x > grid[n - 1] + step) return -1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (grid[mid] <= x) lo = mid; else hi = mid;
    }
    return Math.abs(grid[hi] - x) < Math.abs(grid[lo] - x) ? hi : lo;
  });
}

/**
 * Height scale picked once per site and reach: true scale when the relief then shows at least 60 px,
 * otherwise the smallest scale that brings it to about 120 px.
 */
export function defaultExag(reliefM: number, pxPerM: number): number {
  return reliefM * pxPerM >= 60 ? 1 : autoExag(reliefM, pxPerM, 110);
}

/**
 * How much of the off-slice marker belongs at the A end (1) or the A′ end (0). The marker sits at the nearer end;
 * within `blendDeg` of square to the slice the two ends share it, so it never jumps from one end to the other.
 */
export function endShare(az: number, bearing: number, blendDeg = 12): number {
  const c = Math.cos((az - bearing) * D);
  return Math.min(1, Math.max(0, 0.5 + c / (2 * Math.sin(blendDeg * D))));
}
