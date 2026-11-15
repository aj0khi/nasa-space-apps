// Power, thermal and communications estimates for a landing site, from the hour-by-hour Sun / Earth series
// (/api/ephemeris/windows, terrain skyline included). Owner: Visualization.
// These are first-order engineering estimates for comparing sites, not a spacecraft design.
import type { SeriesPoint } from "../types";
import { surfaceTempK } from "./conditions";

export const S0 = 1361; // solar constant at 1 au, W/m²
export const C_KM_S = 299_792.458;
const D = Math.PI / 180;

export type Mount = "vertical" | "flat";

export interface PowerInputs {
  areaM2: number; // panel area
  efficiency: number; // 0..1, cells + losses
  mount: Mount; // vertical panels that turn to face the Sun (best at the poles) or flat on the deck
  nightLoadW: number; // heaters + avionics that must keep running in the dark
  batteryKWh: number; // usable battery energy
}

export const DEFAULT_POWER: PowerInputs = { areaM2: 2, efficiency: 0.3, mount: "vertical", nightLoadW: 100, batteryKWh: 3 };

const sunlit = (p: SeriesPoint) => p.sun_alt > p.sun_horizon;
const earthUp = (p: SeriesPoint) => p.earth_alt > p.earth_horizon;

/** Panel output in watts with the Sun `altDeg` above a flat horizon (0 W when the terrain blocks it). */
export function panelWatts(p: SeriesPoint, i: PowerInputs) {
  if (!sunlit(p) || p.sun_alt <= 0) return 0;
  const f = i.mount === "vertical" ? Math.cos(p.sun_alt * D) : Math.sin(p.sun_alt * D);
  return S0 * i.efficiency * i.areaM2 * Math.max(0, f);
}

/** Longest run of points where `pred` holds, in hours (series step = `stepH`). `open` = the run reaches the window's end. */
export function longestRun(series: SeriesPoint[], pred: (p: SeriesPoint) => boolean, stepH: number) {
  let best = 0, run = 0, bestOpen = false;
  series.forEach((p, k) => {
    run = pred(p) ? run + 1 : 0;
    if (run > best) { best = run; bestOpen = k === series.length - 1; }
  });
  return { hours: best * stepH, open: bestOpen };
}

export const stepHours = (s: SeriesPoint[]) => (s.length > 1 ? (Date.parse(s[1].time) - Date.parse(s[0].time)) / 3.6e6 : 1);

export function powerBudget(series: SeriesPoint[], i: PowerInputs) {
  const stepH = stepHours(series);
  const watts = series.map((p) => panelWatts(p, i));
  const energyKWh = watts.reduce((a, w) => a + w * stepH, 0) / 1000;
  const days = (series.length * stepH) / 24;
  const avgW = energyKWh * 1000 / Math.max(1, series.length * stepH);
  const dark = longestRun(series, (p) => !sunlit(p), stepH);
  const needKWh = (i.nightLoadW * dark.hours) / 1000;
  const lastsH = i.nightLoadW > 0 ? (i.batteryKWh * 1000) / i.nightLoadW : Infinity;
  const neverLit = watts.every((w) => w === 0);
  return {
    nowW: watts[0] ?? 0, avgW, peakW: Math.max(0, ...watts), energyKWh, days,
    dark, needKWh, lastsH, survives: !neverLit && lastsH >= dark.hours,
    positive: avgW >= i.nightLoadW, // does the site make more than the lander's baseline draw, on average?
    neverLit,
  };
}

export function thermal(series: SeriesPoint[]) {
  const stepH = stepHours(series);
  const now = series[0];
  const litNow = !!now && sunlit(now);
  const groundNowC = now ? surfaceTempK(now.sun_alt, litNow) - 273.15 : NaN;
  const maxSun = Math.max(0, ...series.filter(sunlit).map((p) => p.sun_alt));
  const hottestC = surfaceTempK(maxSun, maxSun > 0) - 273.15;
  const dark = longestRun(series, (p) => !sunlit(p), stepH);
  const neverLit = !series.some(sunlit);
  // a bare surface square-on to the Sun (a lander's side wall) gets the full flux, unlike the grazing-lit ground
  const sunFacingC = surfaceTempK(90, true) - 273.15;
  return { litNow, groundNowC, hottestC, sunFacingC, coldC: surfaceTempK(0, false) - 273.15, dark, neverLit };
}

export function comms(series: SeriesPoint[], earthDistanceKm: number | undefined) {
  const stepH = stepHours(series);
  const visibleFrac = series.length ? series.filter(earthUp).length / series.length : 0;
  const hidden = longestRun(series, (p) => !earthUp(p), stepH);
  const oneWayS = earthDistanceKm ? earthDistanceKm / C_KM_S : 384_400 / C_KM_S;
  const now = series[0];
  return {
    upNow: !!now && earthUp(now), earthAlt: now?.earth_alt ?? NaN, skyline: now?.earth_horizon ?? NaN,
    visibleFrac, hidden, oneWayS, roundTripS: 2 * oneWayS, distanceKm: earthDistanceKm,
    // the lander must look after itself: always for the landing itself (too slow to steer from Earth),
    // and for days at a time when Earth drops behind the skyline
    autonomy: visibleFrac === 0 ? "full" : hidden.hours >= 24 ? "long" : hidden.hours > 0 ? "short" : "landing",
  } as const;
}

export const fmtHours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} h`);
