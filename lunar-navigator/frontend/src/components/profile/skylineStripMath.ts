// Numbers behind the skyline strip (SkylineStrip.tsx). Pure functions, no drawing. Owner: LEAD.
//
// The rule is the same one the rest of the panel uses: a body is in view when the centre of its disc is above
// the ray-traced skyline at its azimuth (skylineAt: linear between whole degrees). A rise or a set is placed
// where the margin (altitude minus skyline) changes sign, linear between two hourly samples, exactly as
// nextCrossing in profileMath.ts does.

import type { SeriesPoint, Skyline } from "../../types";
import { skylineAt } from "./profileMath";
import type { Body } from "./profileMath";

export const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Closer than this (km) the terrain that sets the skyline is the ground beside the lander. Same limit as the panel. */
export const BESIDE_LANDER_KM = 0.2;

export interface TrackEvent {
  rising: boolean;
  index: number; // nearest sample of the series
  day: number; // days after the first sample of the series (the slider's "day")
  az: number; // where the centre of the disc meets the skyline
  alt: number;
}

/** A stretch of a body's path that is all in view or all hidden, and does not cross the 0 / 360 seam. */
export interface TrackRun { visible: boolean; az: number[]; alt: number[] }

export interface Track {
  body: Body;
  az: number[]; // per sample, 0 ≤ az < 360
  alt: number[];
  margin: number[]; // altitude − skyline at that azimuth; > 0 = in view
  day: number[]; // days after the first sample
  runs: TrackRun[];
  events: TrackEvent[];
  hoursInView: number; // linear between samples, so it agrees with the event times
  totalHours: number;
  samplesInView: number;
}

export function buildTrack(series: SeriesPoint[], elev: number[], body: Body): Track {
  const n = series.length;
  const az = new Array<number>(n), alt = new Array<number>(n), margin = new Array<number>(n), day = new Array<number>(n);
  const t = new Array<number>(n);
  let samplesInView = 0;
  for (let i = 0; i < n; i++) {
    const p = series[i];
    az[i] = norm360(body === "sun" ? p.sun_az : p.earth_az);
    alt[i] = body === "sun" ? p.sun_alt : p.earth_alt;
    margin[i] = alt[i] - skylineAt(elev, az[i]);
    t[i] = Date.parse(p.time);
    day[i] = (t[i] - t[0]) / 864e5;
    if (margin[i] > 0) samplesInView++;
  }

  const runs: TrackRun[] = [];
  const events: TrackEvent[] = [];
  let hoursInView = 0;
  let cur: TrackRun = { visible: n > 0 && margin[0] > 0, az: [], alt: [] };
  const open = (visible: boolean) => { cur = { visible, az: [], alt: [] }; runs.push(cur); };
  const add = (a: number, h: number) => { cur.az.push(a); cur.alt.push(h); };
  if (n) { runs.push(cur); add(az[0], alt[0]); }

  for (let j = 1; j < n; j++) {
    const a0 = az[j - 1], h0 = alt[j - 1], h1 = alt[j];
    const d = ((az[j] - a0 + 540) % 360) - 180; // the short way round
    const a1 = a0 + d; // may be below 0 or above 360: then the step crosses the seam
    const up0 = margin[j - 1] > 0, up1 = margin[j] > 0;
    const dtH = (t[j] - t[j - 1]) / 3.6e6;
    const breaks: { f: number; seam: boolean }[] = [];
    if (up0 !== up1) {
      const f = margin[j - 1] / (margin[j - 1] - margin[j]);
      breaks.push({ f, seam: false });
      events.push({ rising: up1, index: f < 0.5 ? j - 1 : j, day: (t[j - 1] + f * (t[j] - t[j - 1]) - t[0]) / 864e5,
        az: norm360(a0 + d * f), alt: h0 + (h1 - h0) * f });
      hoursInView += dtH * (up0 ? f : 1 - f);
    } else if (up0) {
      hoursInView += dtH;
    }
    if (a1 < 0) breaks.push({ f: a0 / (a0 - a1), seam: true });
    else if (a1 >= 360) breaks.push({ f: (360 - a0) / (a1 - a0), seam: true });
    breaks.sort((p, q) => p.f - q.f);
    let off = 0; // ±360 after the seam, so the azimuth stays inside 0…360
    for (const b of breaks) {
      const hb = h0 + (h1 - h0) * b.f;
      if (b.seam) {
        const edge = a1 < 0 ? 0 : 360;
        add(edge, hb);
        open(cur.visible);
        add(360 - edge, hb);
        off = a1 < 0 ? 360 : -360;
      } else {
        const ab = a0 + d * b.f + off;
        add(ab, hb);
        open(up1);
        add(ab, hb);
      }
    }
    add(a1 + off, h1);
  }
  return { body, az, alt, margin, day, runs, events, hoursInView, totalHours: n ? (t[n - 1] - t[0]) / 3.6e6 : 0, samplesInView };
}

/** A stretch of azimuth, 0 ≤ from < to ≤ 360. */
export interface Stretch { from: number; to: number }

/**
 * Runs of flagged directions as stretches of azimuth. Value i belongs to the degree centred on azimuth i
 * (i − 0.5 … i + 0.5), which is how the backend averages the skyline, so north (i = 0) has a half at each end.
 */
export function stretches(flag: boolean[]): Stretch[] {
  const n = flag.length;
  if (!n) return [];
  const w = 360 / n;
  const out: Stretch[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && flag[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ from: Math.max(0, (start - 0.5) * w), to: (i - 0.5) * w });
      start = -1;
    }
  }
  if (flag[0]) out.push({ from: 360 - w / 2, to: 360 });
  return out;
}

/** Directions where the skyline is the ground beside the lander (so it depends on how high the eye sits). */
export function besideFlags(sky: Skyline): boolean[] {
  return sky.dist_km.map((d) => d != null && Number.isFinite(d) && d < BESIDE_LANDER_KM);
}

/** Directions where the terrain data ends early and ground no higher than the highest in the file could raise the skyline. */
export function edgeFlags(sky: Skyline): boolean[] {
  const need = sky.edge_needs_m, top = sky.dem_top_m;
  if (!need || top == null) return sky.elev_deg.map(() => false);
  return sky.elev_deg.map((_, i) => { const v = need[i]; return v != null && Number.isFinite(v) && v < top; });
}

export function flagAt(flag: boolean[], az: number): boolean {
  const n = flag.length;
  return n > 0 && flag[Math.round((norm360(az) * n) / 360) % n];
}

/** Lowest and highest angle the strip has to show: the skyline, both paths with their discs, and the level line. */
export function angleRange(sky: Skyline, series: SeriesPoint[], discRadius: Record<Body, number>): { lo: number; hi: number } {
  let lo = 0, hi = 0;
  const take = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  for (const v of sky.elev_deg) take(v);
  for (const v of sky.elev_max_deg ?? []) take(v);
  for (const v of sky.elev_min_deg ?? []) take(v);
  for (const p of series) {
    take(p.sun_alt + discRadius.sun); take(p.sun_alt - discRadius.sun);
    take(p.earth_alt + discRadius.earth); take(p.earth_alt - discRadius.earth);
  }
  const pad = Math.max(0.3, (hi - lo) * 0.06);
  lo -= pad; hi += pad;
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  return { lo, hi };
}

/** Spacing of the angle ticks (deg) that gives at most `maxTicks` of them. */
export function niceStep(range: number, maxTicks = 6): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30]) if (range / s <= maxTicks) return s;
  return 45;
}

/** Lowest and highest point of the skyline and where they are. */
export function skylineExtremes(elev: number[]): { min: number; minAz: number; max: number; maxAz: number } {
  let min = Infinity, max = -Infinity, minAz = 0, maxAz = 0;
  const w = elev.length ? 360 / elev.length : 1;
  elev.forEach((v, i) => {
    if (v < min) { min = v; minAz = i * w; }
    if (v > max) { max = v; maxAz = i * w; }
  });
  return { min, minAz, max, maxAz };
}
