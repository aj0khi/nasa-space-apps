// Sunlight & shadow along a slice through the site, across one lunar day. Owner: SKY3D.
//
// Cross-section overhaul (LEAD). What the panel does:
//   - The ground is measured terrain from GET /terrain/section (x_m / z_m with the Moon's curvature in z).
//   - The slice is LOCKED to one direction: the Sun's direction when the site opens, a direction the user picks, or
//     the direction of a sunrise or sunset ("event view"). "Follow the Sun" (16 fixed directions) is an option.
//   - A body is "in the page" only within 11.25° of the slice line. In the page it gets a sight line at its true
//     angle. Off the page nothing is projected: a hollow marker at the true elevation, no sight line, no slice shadow.
//   - Ground colours come from GET /terrain/slice-light (every point ray traced) when it answers. Otherwise the
//     panel falls back to slice-only shading in the page, and to neutral ground off the page.
//   - "Is the lander in sunlight / can it see Earth" is ray traced in every direction (GET /terrain/skyline) from the
//     chosen eye height.
//   - The frame is steady: one drawing height, one height scale per site and reach, reserved space for every line.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { compass, fmtLat } from "../../lib/geo";
import { useApp } from "../../state/store";
import type { Section, SeriesPoint, Skyline, SliceLight } from "../../types";
import ExplainCard from "../learn/ExplainCard";
import { useExpert } from "../learn/ModeGate";
import {
  DISC_RADIUS, EXAG_STEPS, EYE_M, R_MOON_M, STATES, STATE_STEP, bodyView, defaultExag, endShare, fmtDuration, fromSection,
  groundAt, hoursInView, inSlice, nearestIndex, nearestOnGrid, normAz, shadeSlice, sightHit, skyEvents, skylineDistAt, snap16,
  stateNumber, timeIndex, wholeDeg,
} from "./profileMath";
import type { Body, BodyView, SkyEvent, Slice } from "./profileMath";
import SkylineStrip from "./SkylineStrip";
import SliceMiniMap from "./SliceMiniMap";

// ---- the frame: fixed, so nothing moves when the time, the slice or the body changes ----
const W = 1000;
const H = 400; // drawing height (viewBox units). Never changes.
const LABEL_BAND = 84; // top band kept for the labels and the 1:1 inset
const BASE_PAD = 30; // solid ground under the lowest point of the slice
const LANDER_Y = 250; // where the lander's ground sits whenever the relief allows it
const TOP_CLAMP = 96; // a marker that would leave through the top stops here, below the labels and the 1:1 inset
const EDGE = 40; // how far in from the side the Sun / Earth marker sits
const DISC = 12; // marker radius (px). A symbol: the real disc would be about 2 px wide at this scale.
const INSET_W = 220, INSET_H = 50, INSET_Y = 30;

const LUNAR_DAY_DAYS = 29.53;
const D2R = Math.PI / 180;
const MAX_KM = 150;
const LENGTH_PRESETS = [8, 30, 100, 150]; // reach each way from the lander (km)
const EYE_HEIGHTS = [2, 5, 10]; // height of the solar panel or antenna above the ground (m)
const LIGHT_POINTS = 201; // ground points per slice in the ray-traced light
const EVENT_LEAD_H = 12; // an event view starts this long before the sunrise or sunset
const NO_POINTS: SeriesPoint[] = [];
const NO_EVENTS: SkyEvent[] = [];
// Closer than this, the terrain that sets the skyline is the ground beside the lander. There the answer depends on
// how high the solar panels or antenna sit, and a 20 m terrain grid cannot settle it.
const BESIDE_LANDER_KM = 0.2;

// The same shadow maths answers two questions: where does sunlight reach (power), and where is Earth
// in direct line of sight (communication)? Terrain blocks a radio link exactly like it blocks light.
const VIEW = {
  sun: { tab: "Sunlight / power", color: "var(--sun)", lit: "Sunlit ground", dark: "Shaded ground", air: "Shadow in the air",
    down: "The Sun is below the horizon", total: "Direct sun", pct: "Slice in shade",
    name: "Sun", the: "the Sun", The: "The Sun", rise: "Sunrise", set: "Sunset", noRise: "No sunrise", noSet: "No sunset" },
  earth: { tab: "Earth / communications", color: "var(--earth)", lit: "Earth in view", dark: "Earth blocked by terrain", air: "No line of sight to Earth",
    down: "Earth is below the horizon; a relay is needed", total: "Direct Earth contact", pct: "Slice with no contact",
    name: "Earth", the: "Earth", The: "Earth", rise: "Earthrise", set: "Earthset", noRise: "No Earthrise", noSet: "No Earthset" },
} as const;

// Slices already read this session, so going back to a direction is instant and the ground does not flicker.
const sectionCache = new Map<string, Promise<Section>>();
function loadSection(p: { lat: number; lon: number }, azimuth: number, lengthKm: number): Promise<Section> {
  const k = `${p.lat},${p.lon},${azimuth},${lengthKm}`;
  let hit = sectionCache.get(k);
  if (!hit) {
    hit = api.section(p, azimuth, lengthKm);
    sectionCache.set(k, hit);
    // A failed read, or a fallback to synthetic terrain, should be tried again next time.
    hit.then((d) => { if (d.synthetic) sectionCache.delete(k); }, () => { sectionCache.delete(k); });
    if (sectionCache.size > 300) {
      const oldest = sectionCache.keys().next();
      if (!oldest.done) sectionCache.delete(oldest.value);
    }
  }
  return hit;
}

// ---- ray-traced light along the slice (GET /terrain/slice-light) ----
// One request at a time (each can take many seconds of ray tracing), and only for the slice that is still wanted.
interface LightWant { site: string; loc: { lat: number; lon: number }; azimuth: number; lengthKm: number; start: string; observerM: number }
const lightKey = (w: LightWant) => `${w.site}|${w.azimuth}|${w.lengthKm}|${w.start}|${w.observerM}`;
const lightDone = new Map<string, SliceLight>(); // answers already received
const lightFailed = new Map<string, { at: number; reason: string }>();
const LIGHT_RETRY_MS = 20000;
let lightQueue: Promise<void> = Promise.resolve();

function fetchLight(w: LightWant, dropped: () => boolean): Promise<SliceLight> {
  const k = lightKey(w);
  const failed = lightFailed.get(k);
  if (failed && Date.now() - failed.at < LIGHT_RETRY_MS) return Promise.reject(new Error(failed.reason));
  const p = lightQueue.then(() => {
    const hit = lightDone.get(k);
    if (hit) return hit;
    if (dropped()) throw new Error("superseded");
    return api.sliceLight(w.loc, w.azimuth, w.lengthKm, w.start, LUNAR_DAY_DAYS, 60, w.observerM, LIGHT_POINTS).then((d) => {
      lightDone.set(k, d);
      if (lightDone.size > 24) {
        const oldest = lightDone.keys().next();
        if (!oldest.done) lightDone.delete(oldest.value);
      }
      return d;
    }, (e) => {
      lightFailed.set(k, { at: Date.now(), reason: String(e instanceof Error ? e.message : e) });
      throw e;
    });
  });
  lightQueue = p.then(() => undefined, () => undefined);
  return p;
}

/** Why the ray-traced light is missing, in plain words. */
function lightReason(msg: string): string {
  if (/501/.test(msg)) return "this backend does not have it yet";
  if (/422/.test(msg)) return "it cannot be worked out for this slice";
  if (/503/.test(msg)) return "the terrain data could not be read";
  return "the request failed";
}

/** The ray-traced light for the slice on screen. `prev` is the last answer received, kept until a newer one arrives. */
function useSliceLight(want: LightWant | null, request: boolean) {
  const [prev, setPrev] = useState<{ key: string; want: LightWant; data: SliceLight } | null>(null);
  const [fail, setFail] = useState<{ key: string; reason: string } | null>(null);
  const k = want ? lightKey(want) : "";
  useEffect(() => {
    if (!want || !request) return;
    const ready = lightDone.get(k);
    if (ready) { setPrev({ key: k, want, data: ready }); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchLight(want, () => cancelled).then(
        (data) => { if (!cancelled) { setPrev({ key: k, want, data }); setFail(null); } },
        (e) => { if (!cancelled) setFail({ key: k, reason: lightReason(String(e instanceof Error ? e.message : e)) }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, request]);
  const exact = k ? lightDone.get(k) ?? null : null;
  const failed = fail && fail.key === k ? fail.reason : null;
  // While the answer for a new eye height is on its way, the previous colours for the same ground stay on screen.
  const sameGround = !!want && !!prev && prev.want.site === want.site && prev.want.azimuth === want.azimuth
    && prev.want.lengthKm === want.lengthKm && prev.want.start === want.start;
  const data = exact ?? (sameGround && !failed ? prev!.data : null);
  return { data, exact: !!exact, failed };
}

// Height scale decided once per site and reach, from the first slice that arrives for it.
const autoScale = new Map<string, number>();

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : km.toFixed(0));
/** "120 m" under a kilometre, otherwise "3.2 km" / "28 km". */
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${fmtKm(m / 1000)} km`);
const fmtDeg = (d: number) => `${Math.abs(d).toFixed(1)}°`;
/** "1.6° above horizontal" / "0.3° below horizontal". Horizontal = the lander's level plane. */
const aboveBelow = (alt: number) => (Math.abs(alt) < 0.05 ? "level with horizontal (0.0°)" : `${fmtDeg(alt)} ${alt >= 0 ? "above" : "below"} horizontal`);
const signed = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}°`;
/** "96°" or "22.5°": whole degrees unless the direction is one of the half-degree steps. */
const fmtAz = (az: number) => `${Number.isInteger(az) ? az : az.toFixed(1)}°`;
const scaleName = (e: number) => (e === 1 ? "1:1" : `×${e}`);

interface Lock { site: string; az: number; auto: boolean } // auto = chosen by the panel when the site opened
interface Viewed { on: string; timeMs: number; rising: boolean } // the sunrise or sunset the slice was lined up with

/** Play speed: milliseconds per step of the series (one step = one hour of lunar time). */
const SPEEDS = [{ name: "Slow", ms: 240 }, { name: "Normal", ms: 120 }, { name: "Fast", ms: 60 }];

/** `letter` labels the slice ends (A … A′) and the site in the middle, as in the team sketch. */
export default function SunProfile({ letter = "A" }: { letter?: string }) {
  const gradientId = useId();
  const groundId = useId();
  const insetId = useId();
  const { time, setTime, baseTime, setBaseTime } = useApp();
  const details = useApp((s) => s.details); // A–H engine verdict for the selected site (null for custom points)
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";

  const [lock, setLock] = useState<Lock | null>(null); // direction the slice is locked to
  const [follow, setFollow] = useState(false); // optional: the slice turns with the body, in 16 steps
  const [smooth, setSmooth] = useState(true); // when following: turn in 1° steps and glide (on), or jump between 16 directions (off)
  const [mapBig, setMapBig] = useState(false); // the small map on the drawing, enlarged
  const [stepMs, setStepMs] = useState(120); // play speed
  const turning = follow && smooth;
  const [mirror, setMirror] = useState(false); // draw the slice the other way round (A on the left)
  const [lengthKm, setLengthKm] = useState(8);
  const [exagPick, setExagPick] = useState<{ on: string; value: number } | null>(null); // the user's height scale, for one site and reach
  const [observerM, setObserverM] = useState<number>(EYE_M);
  const [playing, setPlaying] = useState(false);
  const [body, setBody] = useState<Body>("sun");
  const [viewed, setViewed] = useState<Viewed | null>(null);
  const view = VIEW[body];
  const override = useApp((s) => s.sunOverride);
  const expert = useExpert();

  const seasons = useApi(() => api.seasons(new Date().toISOString()), [], 0);
  const series = useApi(() => (loc ? api.windows(loc, baseTime.toISOString(), LUNAR_DAY_DAYS, 60).then((d) => ({ d, site: key })) : null),
    [key, baseTime.getTime()], 0);

  // Positions for this site only: after a site change the old site's Sun must not pick the slice.
  const pts = series.data && series.data.site === key ? series.data.d.series : NO_POINTS;
  const idx = pts.length ? nearestIndex(pts, time) : 0;
  const ephem = pts[idx];
  // Expert "what if": a manual Sun position (Mission setup) replaces the ephemeris Sun.
  const now = ephem && override ? { ...ephem, sun_alt: override.alt, sun_az: override.az } : ephem;
  const manualSun = !!override && body === "sun";
  const targetAz = now ? (body === "sun" ? now.sun_az : now.earth_az) : 0;
  const targetAlt = now ? (body === "sun" ? now.sun_alt : now.earth_alt) : null;

  // ---- which way the slice points ----
  // Locked by default. When a site opens, the lock is the body's direction at that moment (nearest whole degree).
  const lockAz = lock && lock.site === key ? lock.az : now ? wholeDeg(targetAz) : null;
  useEffect(() => {
    if (key && now && (!lock || lock.site !== key)) setLock({ site: key, az: wholeDeg(targetAz), auto: true });
    // the direction is read once, when the positions for a new site arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !now, lock?.site]);
  const azNow = normAz(targetAz);
  const bearing = follow ? (now ? (smooth ? Math.floor(azNow) % 360 : snap16(targetAz)) : null) : lockAz;
  const turnF = turning && now ? azNow - Math.floor(azNow) : 0; // how far the body is from `bearing` toward the next degree
  const bearingB = turning && bearing != null ? (bearing + 1) % 360 : null;
  const lockTo = (az: number) => {
    setFollow(false);
    setViewed(null);
    setLock({ site: key, az: Math.round(normAz(az) * 2) / 2 % 360, auto: false });
  };
  const pickBody = (b: Body) => {
    setBody(b);
    setViewed(null);
    // A lock the user never touched goes with the body being looked at.
    if (b !== body && now && lock && lock.site === key && lock.auto && !follow) {
      setLock({ site: key, az: wholeDeg(b === "sun" ? now.sun_az : now.earth_az), auto: true });
    }
  };

  // Measured ground along the slice. The previous slice stays on screen until the next one arrives.
  const section = useApi(() => (loc && bearing != null ? loadSection(loc, bearing, lengthKm).then((d) => ({ d, site: key })) : null),
    [key, bearing, lengthKm], turning ? 0 : 120);
  const sec = section.data && section.data.site === key ? section.data.d : null; // never another site's ground
  const sectionB = useApi(() => (loc && bearingB != null ? loadSection(loc, bearingB, lengthKm).then((d) => ({ d, site: key })) : null),
    [key, bearingB, lengthKm], 0);
  const secB = sectionB.data && sectionB.data.site === key && bearingB != null
    && Math.abs(sectionB.data.d.azimuth - bearingB) < 0.01 && Math.abs(sectionB.data.d.length_km - lengthKm) < 0.01 ? sectionB.data.d : null;
  // Mixed only when both slices are the ones wanted; otherwise the whole-degree slice is shown as it is.
  const mixed = turning && !!sec && !!secB && bearing != null && Math.abs(sec.azimuth - bearing) < 0.01
    && Math.abs(sec.length_km - lengthKm) < 0.01 && sec.x_m.length === secB.x_m.length;
  const shown = sec ? (mixed ? normAz(sec.azimuth + turnF) : sec.azimuth) : bearing ?? 0; // direction of the slice on screen
  const shownKm = sec ? sec.length_km : lengthKm;
  const stale = !!sec && bearing != null && (Math.abs(sec.azimuth - bearing) > 0.01 || Math.abs(sec.length_km - lengthKm) > 0.01);

  // Ray-traced skyline all around the lander, from the chosen eye height: decides whether the body is in view.
  const sky = useApi(() => (loc ? api.skyline(loc, observerM).then((d) => ({ d, site: key })) : null), [key, observerM], 0);
  const skyline: Skyline | null = sky.data && sky.data.site === key ? sky.data.d : null;
  // Expert: the same skyline from 2 m, to show what the taller mast gains.
  const wantLow = !!loc && expert && observerM !== EYE_M;
  const skyLow = useApi(() => (loc && wantLow ? api.skyline(loc, EYE_M).then((d) => ({ d, site: key })) : null), [key, wantLow], 0);
  const skylineLow = wantLow && skyLow.data && skyLow.data.site === key ? skyLow.data.d : null;

  // Play: step through the lunar day (1 sample = 1 hour). The clock waits while the next slice is being read.
  const waiting = useRef(false);
  waiting.current = !!loc && !section.error && (!sec || stale || (turning && !secB && !sectionB.error));
  useEffect(() => {
    if (!playing || !pts.length) return;
    const id = setInterval(() => {
      if (waiting.current) return;
      const i = nearestIndex(pts, useApp.getState().time);
      setTime(new Date(pts[(i + 1) % pts.length].time));
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, pts, setTime, stepMs]);

  // Following the Sun: read all 16 directions in the background, one at a time, starting with the one on screen.
  const startState = useRef(0);
  startState.current = bearing != null ? stateNumber(bearing) - 1 : 0;
  useEffect(() => {
    if (!loc || !follow || smooth) return;
    let stop = false;
    (async () => {
      for (let s = 0; s < STATES && !stop; s++) {
        try { await loadSection(loc, ((startState.current + s) % STATES) * STATE_STEP, lengthKm); } catch { /* tried again when shown */ }
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow, smooth, lengthKm]);
  // Smooth follow: read the slices a few degrees either side ahead of time, so the ground never waits.
  useEffect(() => {
    if (!loc || !turning || bearing == null) return;
    for (let d = 1; d <= 8; d++) for (const k of [-d, d]) loadSection(loc, normAz(bearing + k), lengthKm).catch(() => { /* read again when shown */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, turning, bearing, lengthKm]);

  const sliceA = useMemo(() => (sec ? fromSection(sec) : null), [sec]);
  const sliceB = useMemo(() => (secB ? fromSection(secB) : null), [secB]);
  // Smooth turning: the ground is the mix of the two neighbouring slices, weighted by the body's exact direction,
  // so the ground and the body move together, step for step.
  const slice: Slice | null = useMemo(() => (mixed && sliceA && sliceB
    ? { x: sliceA.x.map((x, i) => x + (sliceB.x[i] - x) * turnF), z: sliceA.z.map((z, i) => z + (sliceB.z[i] - z) * turnF) }
    : sliceA), [mixed, sliceA, sliceB, turnF]);
  const radius = sec?.curvature ? R_MOON_M : Infinity;

  // Where the body is relative to the slice. In the page = within 11.25° of the slice line, at either end.
  const place = now && targetAlt != null ? inSlice(targetAlt, targetAz, shown) : null;
  const inPage = !!place && place.along;
  const off = place ? place.off : 0;
  const tanEl = targetAlt != null ? Math.tan(targetAlt * D2R) : 0; // the TRUE elevation. Nothing on the drawing uses a projected angle.
  const toA = place ? place.sunRight : true; // the body is toward the A end

  /** Put the body on the right or the left of the drawing: flip the view if it is in the page, else turn the slice to it. */
  const aim = (right: boolean) => {
    if (!now) return;
    if (follow || inPage) { setMirror(toA ? !right : right); return; }
    lockTo(wholeDeg(targetAz));
    setMirror(!right);
  };
  /** Turn the slice to the body and keep it on the side where its hollow marker is. */
  const reAim = () => {
    if (!now) return;
    const right = toA ? !mirror : mirror;
    lockTo(wholeDeg(targetAz));
    setMirror(!right);
  };
  const toggleFollow = () => {
    if (follow && bearing != null) { lockTo(bearing); return; }
    setFollow(true); setViewed(null);
  };

  // In the page only: shadows cast by ground on this slice, with the body's true elevation.
  const shadeNow = useMemo(() => (slice && inPage ? shadeSlice(slice, tanEl, toA, radius) : null), [slice, inPage, tanEl, toA, radius]);
  const sight = useMemo(() => (slice && inPage ? { hit: sightHit(slice, toA ? 1 : -1, tanEl, observerM) } : null),
    [slice, inPage, toA, tanEl, observerM]);

  // Ray-traced answer for the lander: body altitude against the skyline at the body's azimuth.
  const seenSun = now && skyline ? bodyView(now.sun_alt, now.sun_az, skyline, "sun") : null;
  const seenEarth = now && skyline ? bodyView(now.earth_alt, now.earth_az, skyline, "earth") : null;
  const seen = body === "sun" ? seenSun : seenEarth;
  // The Sun counts as shining somewhere near the site when it is above horizontal, or in view from the lander.
  const sunShines = !!now && (now.sun_alt > 0 || (!!seenSun && seenSun.state !== "hidden"));

  // ---- sunrises and sunsets (Earthrises and Earthsets): hourly positions against the ray-traced skyline ----
  const events = useMemo(() => (skyline && pts.length && !manualSun ? skyEvents(pts, skyline, body) : NO_EVENTS), [skyline, pts, body, manualSun]);
  const next = events.find((e) => e.i >= idx) ?? null;
  const nextSet = events.find((e) => e.i >= idx && !e.rising) ?? null;
  const nextRise = events.find((e) => e.i >= idx && e.rising) ?? null;
  const evName = (rising: boolean) => { const n = rising ? view.rise : view.set; return body === "sun" ? n.toLowerCase() : n; }; // "sunset", "Earthset"
  const tNow = now ? Date.parse(now.time) : 0;
  const viewOn = `${key}|${body}|${baseTime.getTime()}`;
  const viewedEv = useMemo(() => {
    if (!viewed || viewed.on !== viewOn) return null;
    let best: SkyEvent | null = null;
    for (const e of events) {
      if (e.rising !== viewed.rising || Math.abs(e.timeMs - viewed.timeMs) > 36 * 3.6e6) continue;
      if (!best || Math.abs(e.timeMs - viewed.timeMs) < Math.abs(best.timeMs - viewed.timeMs)) best = e;
    }
    return best;
  }, [viewed, viewOn, events]);
  const earlier = viewedEv ? [...events].reverse().find((e) => e.timeMs < viewedEv.timeMs - 1) ?? null : [...events].reverse().find((e) => e.i < idx) ?? null;
  const later = viewedEv ? events.find((e) => e.timeMs > viewedEv.timeMs + 1) ?? null : next;
  /** Line the slice up with a sunrise or sunset and go to a little before it. */
  const goEvent = (e: SkyEvent) => {
    setFollow(false);
    setPlaying(false);
    setLock({ site: key, az: wholeDeg(e.az), auto: false });
    setViewed({ on: viewOn, timeMs: e.timeMs, rising: e.rising });
    if (pts.length) setTime(new Date(pts[nearestIndex(pts, new Date(e.timeMs - EVENT_LEAD_H * 3.6e6))].time));
  };

  // ---- ray-traced light for every ground point of the slice on screen ----
  const want: LightWant | null = loc && sec && !turning ? { site: key, loc, azimuth: sec.azimuth, lengthKm: sec.length_km, start: baseTime.toISOString(), observerM } : null;
  const lightGot = useSliceLight(want, !stale);
  const lightData = lightGot.data;
  const lightMs = useMemo(() => (lightData ? lightData.times.map((t) => Date.parse(t)) : null), [lightData]);
  const lightAt = useMemo(() => (lightData && slice ? nearestOnGrid(lightData.x_m, slice.x) : null), [lightData, slice]);
  // The time step is matched by its timestamp. No match (another date, a manual Sun) means no true colours.
  const lightRow = useMemo(() => {
    if (!lightData || !lightMs || !now || manualSun) return null;
    const tol = lightMs.length > 1 ? (lightMs[1] - lightMs[0]) / 2 : 30 * 60e3;
    const t = timeIndex(lightMs, Date.parse(now.time), tol);
    const row = t < 0 ? undefined : (body === "sun" ? lightData.sun : lightData.earth)[t];
    return row && row.length === lightData.x_m.length ? row : null;
  }, [lightData, lightMs, now?.time, manualSun, body]);
  const lightHours = lightData && !manualSun ? (body === "sun" ? lightData.sun_hours : lightData.earth_hours) : null;
  // What the ground colours are: "true" (every point ray traced), "slice" (this slice only), "none" (neutral ground).
  const colours: "true" | "slice" | "none" = lightRow && lightAt ? "true" : inPage ? "slice" : "none";
  const lightWait = !manualSun && !lightRow && !lightGot.failed; // still on its way

  // ---- height scale: one per site and reach, decided from the first slice, unless the user picks one ----
  const scaleKey = `${key}|${lengthKm}`;
  const secForReach = !!sec && Math.abs(sec.length_km - lengthKm) < 0.01;
  let autoEx = autoScale.get(scaleKey);
  if (autoEx == null && slice && sec && secForReach) {
    let zmin = Infinity, zmax = -Infinity;
    for (const z of slice.z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    autoEx = defaultExag(zmax - zmin, W / (2000 * sec.length_km));
    autoScale.set(scaleKey, autoEx);
  }
  const lastExag = useRef(1);
  // While a slice of a new reach is on its way, the old one keeps the scale it was drawn with.
  if (secForReach) lastExag.current = (exagPick && exagPick.on === scaleKey ? exagPick.value : null) ?? autoEx ?? 1;
  const exag = lastExag.current;
  const pickLength = (km: number) => setLengthKm(Math.max(2, Math.min(MAX_KM, km)));

  // ---------- geometry → pixels: the still part (changes only with the slice, the scale or the mirror) ----------
  const frame = useMemo(() => {
    if (!slice || !sec || slice.x.length < 2) return null;
    const L = sec.length_km * 1000;
    const pxPerM = W / (2 * L);
    const vpm = pxPerM * exag;
    let zmin = Infinity, zmax = -Infinity;
    for (const z of slice.z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    const z0 = groundAt(slice, 0) ?? 0;
    // The lander sits at the same height on the drawing whenever the relief allows it.
    const lo = LABEL_BAND + (zmax - z0) * vpm; // higher than this and the peaks run into the labels
    const hi = H - BASE_PAD - (z0 - zmin) * vpm; // lower than this and the floor leaves the frame
    const cut = lo > hi; // too tall for the frame at this height scale
    const yL = cut ? Math.min(lo, H - 70) : Math.min(hi, Math.max(lo, LANDER_Y));
    const X = (x: number) => (mirror ? W - (x + L) * pxPerM : (x + L) * pxPerM);
    const Y = (z: number) => yL - (z - z0) * vpm;
    const n = slice.x.length;
    const groundLine = slice.x.map((x, i) => `${X(x).toFixed(1)},${Y(slice.z[i]).toFixed(1)}`);
    const groundFill = `M${X(slice.x[0]).toFixed(1)},${H} L${groundLine.join(" L")} L${X(slice.x[n - 1]).toFixed(1)},${H} Z`;
    // The same slice at 1:1, small, shown whenever the heights are stretched. It sits at the A′ end.
    let inset: { x: number; d: string; lander: number } | null = null;
    if (exag !== 1) {
      const p = INSET_W / (2 * L);
      const ix = mirror ? W - 40 - INSET_W : 40;
      const fits = (zmax - zmin) * p <= INSET_H - 8;
      const Yi = (z: number) => (fits ? INSET_Y + INSET_H - 4 - (z - zmin) * p : Math.min(INSET_Y + 4 + (zmax - z) * p, INSET_Y + INSET_H));
      const Xi = (x: number) => ix + (mirror ? INSET_W - (x + L) * p : (x + L) * p);
      const stepI = Math.max(1, Math.floor(n / 220));
      const line: string[] = [];
      for (let i = 0; i < n; i += stepI) line.push(`${Xi(slice.x[i]).toFixed(1)},${Yi(slice.z[i]).toFixed(1)}`);
      line.push(`${Xi(slice.x[n - 1]).toFixed(1)},${Yi(slice.z[n - 1]).toFixed(1)}`);
      inset = { x: ix, d: `M${Xi(slice.x[0]).toFixed(1)},${INSET_Y + INSET_H} L${line.join(" L")} L${Xi(slice.x[n - 1]).toFixed(1)},${INSET_Y + INSET_H} Z`, lander: Xi(0) };
    }
    return { X, Y, z0, groundLine, groundFill, cut, inset };
  }, [slice, sec, exag, mirror]);

  const skyEl = seen ? seen.horizon : null; // ray-traced skyline height in the body's true direction (deg)
  // ---------- geometry → pixels: the part that moves with time ----------
  const draw = useMemo(() => {
    if (!frame || !slice) return null;
    const { X, Y, groundLine } = frame;
    const n = slice.x.length;
    const px = mirror ? -1 : 1; // slice direction → screen direction

    // Each ground point: 1 lit, 0 dark, 2 not known (drawn neutral).
    const tone = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      if (colours === "true") {
        const j = lightAt![i];
        tone[i] = j < 0 ? 2 : lightRow!.charCodeAt(j) === 49 ? 1 : 0;
      } else tone[i] = colours === "slice" && shadeNow ? (shadeNow.lit[i] ? 1 : 0) : 2;
    }
    const runs: { tone: number; d: string }[] = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || tone[i] !== tone[start]) {
        runs.push({ tone: tone[start], d: `M${groundLine.slice(start, Math.min(i + 1, n)).join(" L")}` });
        start = i;
      }
    }

    // In the page: the shadow that ground on this slice throws into the air, at the body's true elevation.
    // With ray-traced colours the shadow edge cannot pass above a point that is lit, so it starts again at the
    // ground there: the picture then never shows a shadow in the air over sunlit ground.
    let air: string | null = null;
    if (shadeNow) {
      let top = shadeNow.top;
      if (colours === "true" && Number.isFinite(tanEl)) {
        top = new Array<number>(n);
        let h = -Infinity, prev = -1;
        for (let k = 0; k < n; k++) {
          const i = toA ? n - 1 - k : k;
          if (prev < 0) h = shadeNow.top[i];
          else h -= Math.abs(slice.x[i] - slice.x[prev]) * tanEl;
          h = tone[i] === 1 ? slice.z[i] : Math.max(h, slice.z[i]);
          top[i] = h;
          prev = i;
        }
      }
      const airTop = slice.x.map((x, i) => `${X(x).toFixed(1)},${Math.max(0, Y(top[i])).toFixed(1)}`);
      air = `M${airTop.join(" L")} L${groundLine.slice().reverse().join(" L")} Z`;
    }

    // Rays aimed at the edges that cast shadows on this slice (lit point whose down-sun neighbour is dark).
    const rays: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const theta = Math.atan(tanEl * exag);
    if (shadeNow && shadeNow.lit.some(Boolean)) {
      const dirPx = (toA ? 1 : -1) * px;
      const step = toA ? -1 : 1; // direction shadows fall, along the slice
      const casters: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = i + step;
        if (shadeNow.lit[i] && j >= 0 && j < n && !shadeNow.lit[j]) casters.push(i);
      }
      if (!casters.length) for (let q = 1; q <= 3; q++) casters.push(Math.floor((q * n) / 4));
      const len = 170;
      for (const i of casters.slice(0, 4)) {
        const x1 = X(slice.x[i]), y1 = Y(slice.z[i]);
        rays.push({ x1, y1, x2: x1 + dirPx * len * Math.cos(theta), y2: y1 - len * Math.sin(theta) });
      }
    }

    // The lander's eye, and the marker. One rule in the page and off it: the marker sits near an end of the drawing, at
    // the body's true elevation as seen from the eye (times the height scale). Only its style differs.
    const eye = { x: X(0), y: Y(frame.z0 + observerM) };
    const t = tanEl * exag;
    const tanSky = skyEl != null ? Math.tan(skyEl * D2R) * exag : null;
    const at = (dirPx: number) => {
      const xe = dirPx > 0 ? W - EDGE : EDGE;
      let x = xe, y = eye.y - Math.abs(xe - eye.x) * t;
      // The ray-traced skyline in the body's true direction, at the same place on the drawing: a true angle too.
      let sky: number | null = tanSky != null ? eye.y - Math.abs(xe - eye.x) * tanSky : null;
      if (y < TOP_CLAMP) { y = TOP_CLAMP; x = eye.x + (dirPx * (eye.y - TOP_CLAMP)) / t; sky = null; } // leaves through the top
      else if (y > H - 6) { y = H - 6; x = eye.x + (dirPx * (eye.y - (H - 6))) / t; sky = null; } // heads into the ground
      if (sky != null && (sky < TOP_CLAMP || sky > H - 4)) sky = null;
      return { x, y, sky, side: dirPx > 0 ? -1 : 1 };
    };
    const markers: { x: number; y: number; w: number; sky: number | null; side: number }[] = [];
    let sightLine: { x2: number; y2: number; hit: { x: number; y: number } | null } | null = null;
    if (targetAlt != null) {
      if (inPage) {
        const m = at((toA ? 1 : -1) * px);
        markers.push({ ...m, w: 1 });
        sightLine = { x2: m.x, y2: m.y, hit: sight?.hit ? { x: X(sight.hit.x), y: Y(sight.hit.z) } : null };
      } else {
        // The nearer end. Close to square to the slice the two ends share the marker, so it never jumps across.
        const wA = endShare(targetAz, shown);
        if (wA > 0.02) markers.push({ ...at(px), w: wA });
        if (wA < 0.98) markers.push({ ...at(-px), w: 1 - wA });
      }
    }
    return { eye, runs, air, rays, markers, sightLine };
  }, [frame, slice, mirror, colours, lightAt, lightRow, shadeNow, tanEl, exag, toA, observerM, targetAlt, inPage, sight, targetAz, shown, skyEl]);

  // ---------- numbers under the drawing ----------
  const sliceShadePct = shadeNow ? Math.round((100 * shadeNow.lit.filter((l) => !l).length) / shadeNow.lit.length) : null;
  const trueShadePct = useMemo(() => {
    if (!lightRow) return null;
    let dark = 0;
    for (let i = 0; i < lightRow.length; i++) if (lightRow.charCodeAt(i) !== 49) dark++;
    return Math.round((100 * dark) / lightRow.length);
  }, [lightRow]);
  const shadePct = colours === "true" ? trueShadePct : colours === "slice" ? sliceShadePct : null;
  const shadeSub = colours === "true" ? `every point ray traced through the terrain${lightData?.synthetic ? " model (synthetic)" : ""}`
    : colours === "slice" ? "from ground on this slice only" : "needs the ray-traced data";
  const maxH = lightHours && lightHours.length ? Math.max(...lightHours) : 0;
  const totalH = pts.length ? (Date.parse(pts[pts.length - 1].time) - Date.parse(pts[0].time)) / 3.6e6 : 0;
  // The ray-traced hours count every time step of the light data as one step long, so their total is steps x step.
  const lightTotalH = lightMs && lightMs.length > 1 ? (lightMs.length * (lightMs[1] - lightMs[0])) / 3.6e6 : totalH;
  const dayN = now ? (Date.parse(now.time) - Date.parse(pts[0].time)) / 864e5 : 0;
  const hoursStrip = useMemo(() => {
    if (!lightHours || !lightData || !sec || lightData.x_m.length < 2) return null;
    const L = sec.length_km * 1000, p = W / (2 * L);
    const w = Math.abs(lightData.x_m[1] - lightData.x_m[0]) * p;
    return lightData.x_m.map((x, j) => ({ x: (mirror ? W - (x + L) * p : (x + L) * p) - w / 2, w: w + 0.6, h: lightHours[j] }));
  }, [lightHours, lightData, sec, mirror]);

  // ---------- words ----------
  const eyeUsed = skyline ? skyline.observer_m : observerM;
  const skyWords = verdictWords(body, seen, skyline, sky.error);
  const how = skyline?.synthetic ? "Synthetic model, not measured terrain" : "Ray traced through the terrain";
  const nextValue = !skyline ? (sky.error ? "n/a" : "…") : manualSun ? "n/a"
    : next ? `${next.rising ? view.rise : view.set} in ${fmtDuration((next.timeMs - tNow) / 3.6e6)}`
    : `${seen && seen.margin > 0 ? view.noSet : view.noRise} in this lunar day`;
  const nextSub = !skyline ? undefined : manualSun ? "not worked out for a manual Sun position"
    : `when its centre crosses the ${skyline.synthetic ? "synthetic" : "ray traced"} skyline${next ? "" : " (none before the end of the slider)"}`;

  // The terrain file stops at 80°S. Where it ends early toward the body, ground beyond the edge is not in the answer.
  // The line of sight to the body passes over the edge at a known height; if ground no higher than the highest point
  // in the whole file could reach that line, an "in view" answer may be too optimistic, so say so.
  const edgeNote = (() => {
    if (!skyline || skyline.synthetic || !seen || seen.state === "hidden" || targetAlt == null) return null;
    if (!skyline.seen_km || skyline.dem_top_m == null || skyline.site_elevation_m == null) return null;
    const reach = skylineDistAt(skyline.seen_km, targetAz);
    if (reach == null || reach >= skyline.reach_km - 1) return null;
    const e = targetAlt * D2R, th = (reach * 1000) / R_MOON_M;
    const lineM = ((R_MOON_M + skyline.site_elevation_m + skyline.observer_m) * Math.cos(e)) / Math.cos(e + th) - R_MOON_M;
    if (!(lineM < skyline.dem_top_m)) return null;
    return `toward ${view.the} the terrain data ends ${fmtDist(reach * 1000)} from the lander (it stops at 80°S). Ground beyond that is not included: anything there higher than about ${Math.round(lineM / 10) * 10} m elevation would block the view, so "in view" could be optimistic.`;
  })();

  // The two fixed lines at the top of the drawing. The angle is always the real one from the ephemeris.
  const hidden = !!seen && seen.state === "hidden";
  const angleText = targetAlt == null ? "" : `${view.name} ${aboveBelow(targetAlt)}${inPage ? "" : `, ${off.toFixed(0)}° off this slice`}`;
  const lineText = targetAlt == null ? "" : !inPage ? `Off this slice, toward ${compass(targetAz)}: hollow marker at its real height, no sight line`
    : targetAlt <= 0 && (!seen || hidden) ? view.down
    : hidden ? `${view.The} is below the terrain skyline in its direction: out of view from the lander`
    : sight?.hit ? `Sight line meets the ground on this slice ${fmtDist(sight.hit.distM)} out`
    : "Sight line clears the ground on this slice";
  const scaleText = exag === 1 ? "drawn 1:1, no vertical stretch" : `heights ×${exag}; printed angles are real`;

  // What the slice is doing, in one line.
  const eventLocked = !!viewedEv && !follow && lockAz === wholeDeg(viewedEv.az);
  const stateText = bearing == null && !sec ? null
    : turning ? { b: `Following ${view.the} smoothly`, rest: `: the slice turns with it, ${letter} points to ${fmtAz(shown)} (${compass(shown)})` }
    : follow ? { b: `Following ${view.the}: slice ${stateNumber(shown)} of ${STATES}`, rest: `, ${letter} points to ${fmtAz(shown)} (${compass(shown)})` }
    : { b: `Slice locked toward ${fmtAz(shown)} (${compass(shown)})`,
      rest: eventLocked ? `, where ${view.the} ${viewedEv!.rising ? "rises" : "sets"}` : lock?.auto ? `, where ${view.the} was when the site opened` : "" };

  // What the event view shows, or what comes next. Always one line, so nothing below moves.
  const eventLine = (() => {
    if (!skyline) return { text: sky.error ? "Sunrise and sunset times need the skyline, which could not be loaded." : "Working out sunrise and sunset from the skyline…", widen: null as number | null };
    if (manualSun) return { text: "Sunrise and sunset are not worked out for a manual Sun position.", widen: null };
    const e = viewedEv ?? next;
    if (!e) return { text: `No ${body === "sun" ? "sunrise or sunset" : "Earthrise or Earthset"} after this moment in this lunar day: ${view.the} stays ${seen && seen.margin > 0 ? "in view" : "out of view"} to the end of the slider.`, widen: null };
    const dh = (e.timeMs - tNow) / 3.6e6;
    const name = e.rising ? view.rise : view.set;
    const when = dh >= 0 ? `${name} in ${fmtDuration(dh)}` : `${name} was ${fmtDuration(-dh)} ago`;
    const where = e.blockerKm == null ? `toward ${e.az.toFixed(0)}° (${compass(e.az)})`
      : e.blockerKm < BESIDE_LANDER_KM ? `${e.rising ? "over" : "behind"} the ground beside the lander, ${fmtDist(e.blockerKm * 1000)} away toward ${e.az.toFixed(0)}° (${compass(e.az)})`
      : `${e.rising ? "over" : "behind"} terrain ${fmtDist(e.blockerKm * 1000)} away toward ${e.az.toFixed(0)}° (${compass(e.az)})`;
    const beyond = e.blockerKm != null && sec && e.blockerKm > sec.length_km;
    const want = beyond ? LENGTH_PRESETS.find((p) => p >= e.blockerKm! * 1.05) ?? MAX_KM : null;
    const far = !beyond ? "" : e.blockerKm! > MAX_KM ? ", farther than the longest slice" : ", beyond the end of this slice";
    const tail = !viewedEv ? ` Press "Next ${evName(e.rising)}" to line the slice up with it.` : eventLocked ? " Drag the time across it." : "";
    return { text: `${viewedEv ? when : `Next: ${when.charAt(0).toLowerCase()}${when.slice(1)}`}, ${where}${viewedEv ? far : ""}.${tail}`,
      widen: viewedEv && want && sec && want > sec.length_km ? want : null };
  })();

  // One line under the drawing when the slice and the ray-traced answer need explaining together.
  const hint = (() => {
    if (!seen || !place || !sec || targetAlt == null) return null;
    const d = seen.blockerKm;
    const blocked = seen.state !== "clear";
    const hides = seen.state === "hidden" ? "hides" : "partly hides";
    const side = `${off.toFixed(0)}° to the side of this slice`;
    if (blocked && !inPage) {
      return { text: `The terrain that ${hides} ${view.the}${d != null ? ` is ${fmtDist(d * 1000)} away` : " lies"} toward ${compass(targetAz)}, off this slice.`,
        look: true, widen: null as number | null };
    }
    if (blocked && d != null && d > sec.length_km) {
      const wantKm = LENGTH_PRESETS.find((p) => p >= d * 1.05) ?? MAX_KM;
      return { text: d > MAX_KM
          ? `The terrain that ${hides} ${view.the} is ${fmtKm(d)} km away, farther than the longest slice (${MAX_KM} km each way).`
          : `The terrain that ${hides} ${view.the} is ${fmtKm(d)} km away, beyond the end of this slice.`,
        look: false, widen: wantKm > sec.length_km ? wantKm : null };
    }
    if (blocked && sight && !sight.hit) {
      if (seen.state === "partial" && seen.margin >= 0) {
        return { text: `The line to the centre of ${view.the} is clear, but the skyline cuts the lower part of its disc${d != null ? ` (terrain ${fmtDist(d * 1000)} away)` : ""}.`,
          look: false, widen: null };
      }
      return { text: `The terrain that ${hides} ${view.the} lies toward ${targetAz.toFixed(0)}° (${compass(targetAz)})${d != null ? `, ${fmtDist(d * 1000)} away` : ""}. That is ${side}, so the slice passes beside it.`,
        look: false, widen: null };
    }
    if (!blocked && sight?.hit) {
      return { text: `This slice meets higher ground ${fmtDist(sight.hit.distM)} out, but the true direction to ${view.the} (${targetAz.toFixed(0)}°, ${side}) clears the terrain. The answer for the lander follows the true direction.`,
        look: false, widen: null };
    }
    return null;
  })();

  // Where the ground colours come from, in one or two fixed lines.
  const groundNote = colours === "true"
    ? `Ground colours: every point is ray traced through the terrain in all directions${lightData?.synthetic ? " (synthetic terrain model, not measured terrain)" : ""}, from ${lightData!.observer_m} m above the ground${lightGot.exact ? "." : ", and is being traced again for the new eye height…"}`
    : manualSun ? (inPage ? "Manual Sun position: the colours show only shadows cast by ground on this slice. Terrain beside it can also cast shadows."
      : "Manual Sun position, off this slice: the ground is drawn without shadows.")
    : lightWait ? (inPage ? "Ray tracing the ground… Until that arrives the colours show only shadows cast by ground on this slice. Terrain beside it can also cast shadows."
      : `Ray tracing the ground… ${view.The} is off this slice, so no shadows are drawn until that arrives.`)
    : inPage ? `Ray-traced ground light is not available (${lightGot.failed ?? "no data for this moment"}). The colours show only shadows cast by ground on this slice. Terrain beside it can also cast shadows.`
    : `Ray-traced ground light is not available (${lightGot.failed ?? "no data for this moment"}). ${view.The} is off this slice, so the ground is drawn without shadows: they need the ray-traced data.`;

  // Expert: what the taller mast gains over the lunar day.
  const gain = useMemo(() => {
    if (!skyline || !skylineLow || !pts.length || manualSun || Math.abs(skyline.observer_m - observerM) > 0.01) return null;
    return { high: hoursInView(pts, skyline.elev_deg, body), low: hoursInView(pts, skylineLow.elev_deg, body) };
  }, [skyline, skylineLow, pts, body, manualSun, observerM]);

  const loadingText = series.error ? `Could not load the Sun and Earth positions (${series.error}).`
    : !sec && section.error ? `Could not load the terrain slice (${section.error}).`
    : !pts.length ? "Loading Sun and Earth positions…"
    : "Loading the terrain slice… the first read of a site takes a few seconds, or up to half a minute when the terrain is read from NASA.";

  const endA = { t: letter, right: !mirror }, endB = { t: `${letter}′`, right: mirror };
  const leftAz = mirror ? shown : shown + 180, rightAz = mirror ? shown + 180 : shown;
  const darkColor = body === "sun" ? "var(--shade)" : "var(--red)";
  const toneColor = (t: number) => (t === 1 ? view.color : t === 0 ? darkColor : "var(--muted)");

  return (
    <div className="panel profile">
      <h3>Cross section {letter}–{letter}′: {body === "sun" ? "sunlight" : "contact with Earth"} along a slice through the site {sec?.synthetic && <small>(synthetic terrain)</small>}</h3>

      {sec?.synthetic && loc && (
        <div className="override-note profile-placeholder" role="note">
          <b>Placeholder ground, not real terrain.</b>{" "}
          {loc.lat > -80
            ? `This point is at ${fmtLat(loc.lat)}, outside the south polar terrain data (80° S to the pole).`
            : "The measured terrain could not be read for this point."}{" "}
          The shape drawn below is a stand-in. The height of {body === "sun" ? "the Sun" : "Earth"} is real for this point
          {loc.lat > -80 ? `, and away from the pole ${body === "sun" ? "the Sun" : "Earth"} can stand far above the horizon` : ""}.
          For a real cross section, pick a landing site from the list on the right.
        </div>
      )}

      <div className="profile-head">
        <div className="profile-head-main">
          <div className="tabs" role="group" aria-label="What to check along the slice" style={{ marginBottom: 8 }}>
            {(Object.keys(VIEW) as Body[]).map((b) => (
              <button key={b} className={body === b ? "active" : ""} aria-pressed={body === b} onClick={() => pickBody(b)}>{VIEW[b].tab}</button>
            ))}
          </div>

          <div className="viewpoints profile-dir">
            <span className="muted small">Slice direction</span>
            <div className="tabs" role="group" aria-label="Which way the slice points">
              <button disabled={!now} onClick={() => aim(false)} title={`Turn the slice to ${view.the} and draw it on the left`}>{view.name} on the left</button>
              <button disabled={!now} onClick={() => aim(true)} title={`Turn the slice to ${view.the} and draw it on the right`}>{view.name} on the right</button>
              <button className={follow ? "active" : ""} aria-pressed={follow} disabled={!now} onClick={toggleFollow}
                title={`The slice turns with ${view.the}, so it always stays in the page. Press again to lock the slice where it is.`}>Follow {view.the}: {follow ? "on" : "off"}</button>
              <button className={smooth ? "active" : ""} aria-pressed={smooth} onClick={() => setSmooth(!smooth)}
                title="While following. On: the slice turns one degree at a time and the ground glides. Off: it jumps between 16 fixed directions.">Smooth turning: {smooth ? "on" : "off"}</button>
            </div>
            <span className="muted small">{body === "sun" ? "Sunrise and sunset" : "Earthrise and Earthset"}</span>
            <div className="tabs" role="group" aria-label={body === "sun" ? "Sunrise and sunset" : "Earthrise and Earthset"}>
              <button disabled={!earlier} onClick={() => earlier && goEvent(earlier)} title="Line the slice up with the event before this one">Earlier event</button>
              <button className="profile-next" disabled={!nextSet} onClick={() => nextSet && goEvent(nextSet)}
                title={nextSet ? `Lock the slice to where ${view.the} sets and go to ${EVENT_LEAD_H} hours before it` : `No ${evName(false)} after this moment in this lunar day`}>
                Next {evName(false)}
              </button>
              <button className="profile-next" disabled={!nextRise} onClick={() => nextRise && goEvent(nextRise)}
                title={nextRise ? `Lock the slice to where ${view.the} rises and go to ${EVENT_LEAD_H} hours before it` : `No ${evName(true)} after this moment in this lunar day`}>
                Next {evName(true)}
              </button>
              <button disabled={!later} onClick={() => later && goEvent(later)} title="Line the slice up with the event after this one">Later event</button>
            </div>
          </div>
          {override && (
            <div className="override-note">Manual Sun position ({override.alt}°, {override.az}°) from Mission setup. <button className="link" onClick={() => useApp.getState().setSunOverride(null)}>Use the real Sun</button></div>
          )}

          <div className="profile-state" aria-live="polite">
            {stateText ? <span className="profile-state-main"><b>{stateText.b}</b>{stateText.rest}</span> : <span>Finding where {view.the} is…</span>}
            {stale && !section.error && <span>· loading the slice toward {fmtAz(bearing!)}…</span>}
            {stale && section.error && <span>· could not load the slice toward {fmtAz(bearing!)} ({section.error})</span>}
            {sec && <span>· Terrain: {sec.source}</span>}
            {sec?.synthetic && sec.note && <span>· {sec.note}</span>}
          </div>
          <div className="profile-event" aria-live="polite">
            <span title={eventLine.text}>{eventLine.text}</span>
            {eventLine.widen && !hint?.widen && <button onClick={() => pickLength(eventLine.widen!)}>Widen the slice to {eventLine.widen} km each way</button>}
          </div>
        </div>
        {/* the same moment from above: a small map beside the controls, just above the end of the drawing */}
        <div className="profile-mapcol">
          <div className={`profile-map${mapBig ? " big" : ""}`}>
            <SliceMiniMap loc={loc} sliceAzimuth={shown} lengthKm={shownKm} letter={letter} body={body} bodyAlt={targetAlt} bodyAz={now ? targetAz : null}
              bodyInView={seen ? seen.state !== "hidden" : (targetAlt ?? 0) > 0} observerM={observerM} color={view.color}
              onPickAzimuth={lockTo} />
            <button className="profile-map-size" aria-pressed={mapBig} onClick={() => setMapBig(!mapBig)}>{mapBig ? "Smaller" : "Larger"}</button>
          </div>
        </div>
      </div>

      <div className="profile-frame">
        {draw && frame && slice ? (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
            aria-label={`Terrain slice from ${compass(leftAz)} to ${compass(rightAz)}. ${angleText}. ${lineText}. ${view.pct}: ${shadePct != null ? `${shadePct}%` : "not known"}. Lander: ${skyWords.value}.`}>
            <defs>
              <radialGradient id={gradientId}>
                <stop offset="0%" stopColor={body === "sun" ? "#fffdf2" : "#c3e6fb"} />
                <stop offset="65%" stopColor={body === "sun" ? "#ffe8a6" : "#4d98cf"} />
                <stop offset="100%" stopColor={body === "sun" ? "#e5aa54" : "#173c6d"} />
              </radialGradient>
              <linearGradient id={groundId} x1="0" x2="0" y1="0" y2="1">
                <stop stopColor="#777a7b" />
                <stop offset="100%" stopColor="#272b32" />
              </linearGradient>
              <clipPath id={insetId}><rect x={frame.inset ? frame.inset.x : 0} y={INSET_Y} width={INSET_W} height={INSET_H} /></clipPath>
            </defs>
            {/* the same slice at 1:1, whenever the heights are stretched */}
            {frame.inset && (
              <g>
                <rect x={frame.inset.x} y={INSET_Y} width={INSET_W} height={INSET_H} fill="var(--panel)" stroke="var(--line)" />
                <path d={frame.inset.d} fill="var(--ground)" clipPath={`url(#${insetId})`} />
                <line x1={frame.inset.lander} x2={frame.inset.lander} y1={INSET_Y + 3} y2={INSET_Y + INSET_H} stroke="var(--text)" strokeOpacity={0.45} strokeDasharray="2 3" />
                <text x={frame.inset.x + 5} y={INSET_Y + 12} fontSize={11} fill="var(--muted)">1:1</text>
              </g>
            )}
            {draw.rays.map((r, i) => <line key={i} {...r} stroke={view.color} strokeOpacity={0.55} strokeWidth={1.2} />)}
            {/* in the page the marker is drawn before the ground, so higher ground on the slice hides it, as in a side view */}
            {inPage && draw.markers.map((m, i) => <circle key={i} cx={m.x} cy={m.y} r={DISC} fill={`url(#${gradientId})`} fillOpacity={hidden ? 0.45 : 1} />)}
            <path d={frame.groundFill} fill={`url(#${groundId})`} />
            {draw.air && <path d={draw.air} fill="var(--shadow-air)" />}
            {draw.runs.map((r, i) => (
              <path key={i} d={r.d} fill="none" stroke={toneColor(r.tone)} strokeOpacity={r.tone === 2 ? 0.55 : 1} strokeWidth={3.5} strokeLinejoin="round" />
            ))}
            {/* off the page: a hollow marker at the true elevation, in front of the ground because it is not in this slice */}
            {!inPage && draw.markers.map((m, i) => (
              <circle key={i} className="profile-off" cx={m.x} cy={m.y} r={DISC - 1} fill="var(--panel)" fillOpacity={0.35 * m.w}
                stroke={view.color} strokeOpacity={0.3 + 0.65 * m.w} strokeWidth={2} strokeDasharray="4 3" />
            ))}
            {/* the ray-traced skyline in the body's true direction, as a tick at the marker: the body is in view when
                the centre of its marker is above the tick */}
            {draw.markers.map((m, i) => m.sky != null && (
              <g key={i} opacity={0.35 + 0.65 * m.w}>
                <line x1={m.x - 21} x2={m.x + 21} y1={m.sky} y2={m.sky} stroke="var(--text)" strokeWidth={2} />
                <circle cx={m.x} cy={m.y} r={1.6} fill={inPage ? "#3a2a10" : view.color} />
              </g>
            ))}
            {/* sight line from the lander toward the Sun / Earth, at the real angle. In the page only. */}
            {draw.sightLine && (
              <g className="profile-sight">
                {draw.sightLine.hit ? (
                  <>
                    <line x1={draw.eye.x} y1={draw.eye.y} x2={draw.sightLine.hit.x} y2={draw.sightLine.hit.y} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="7 4" />
                    <line x1={draw.sightLine.hit.x} y1={draw.sightLine.hit.y} x2={draw.sightLine.x2} y2={draw.sightLine.y2} stroke="var(--text)" strokeOpacity={0.3} strokeWidth={1.2} strokeDasharray="2 5" />
                    <circle cx={draw.sightLine.hit.x} cy={draw.sightLine.hit.y} r={5} fill="var(--panel)" stroke="var(--text)" strokeWidth={2} />
                  </>
                ) : (
                  <line x1={draw.eye.x} y1={draw.eye.y} x2={draw.sightLine.x2} y2={draw.sightLine.y2} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="7 4" />
                )}
              </g>
            )}
            {/* the landing site */}
            <line x1={draw.eye.x} x2={draw.eye.x} y1={72} y2={H} stroke="var(--text)" strokeDasharray="3 4" strokeOpacity={0.5} />
            <text x={draw.eye.x} y={66} textAnchor="middle" fontSize={14} fill="var(--text)" className="profile-halo">▼ {letter}</text>
            {/* two fixed lines: the body's real angle, and what the sight line does */}
            <text x={W / 2} y={22} textAnchor="middle" fontSize={15} fill="var(--text)" className="profile-halo">{angleText}</text>
            <text x={W / 2} y={42} textAnchor="middle" fontSize={12.5} fill="var(--muted)" className="profile-halo">{lineText}</text>
            {!inPage && now && draw.markers.length > 0 && (() => {
              const m = draw.markers.reduce((a, b) => (b.w > a.w ? b : a));
              const bw = 210, bx = Math.min(W - bw - 34, Math.max(34, m.x - bw / 2)), by = Math.min(H - 36, m.y + 22);
              return (
                <g className="profile-reaim" role="button" tabIndex={0} aria-label={`Turn the slice to ${view.the}`} onClick={reAim}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reAim(); } }}>
                  <rect x={bx} y={by} width={bw} height={26} rx={4} fill="var(--panel)" stroke={view.color} strokeWidth={1.4} />
                  <text x={bx + bw / 2} y={by + 17.5} textAnchor="middle" fontSize={13} fill="var(--text)">Turn the slice to {view.the}</text>
                </g>
              );
            })()}
            {/* slice ends, A and A′: A is the end the slice direction points to */}
            {[endB, endA].map((e) => {
              const x = e.right ? W - 1.5 : 1.5;
              return (
                <g key={e.t}>
                  <line x1={x} x2={x} y1={6} y2={H} stroke="var(--text)" strokeWidth={2} />
                  <text x={e.right ? x - 8 : x + 8} y={24} textAnchor={e.right ? "end" : "start"} fontSize={18} fontWeight={700} fill="var(--text)">{e.t}</text>
                </g>
              );
            })}
            {/* the height scale, said on the drawing, at the A′ end */}
            <text x={endB.right ? W - 40 : 40} y={22} textAnchor={endB.right ? "end" : "start"} fontSize={12.5}
              fill={exag === 1 ? "var(--muted)" : "var(--text)"} className="profile-halo">{scaleText}</text>
            {frame.cut && (
              <text x={endB.right ? W - 12 : 12} y={H - 9} textAnchor={endB.right ? "end" : "start"} fontSize={12} fill="var(--text)" className="profile-halo">
                At this height scale part of the ground is outside the frame
              </text>
            )}
          </svg>
        ) : (
          <div className="profile-loading">{loadingText}</div>
        )}
      </div>

      {/* hours of light per ground point over the lunar day: only from the ray-traced data */}
      <svg viewBox={`0 0 ${W} 18`} width="100%" height={18} preserveAspectRatio="none" aria-hidden>
        <rect x={0} y={0} width={W} height={18} fill="var(--line)" fillOpacity={0.35} />
        {hoursStrip && hoursStrip.map((r, j) => (
          <rect key={j} x={r.x} width={r.w} height={18} fill={view.color} fillOpacity={maxH ? 0.1 + 0.9 * (r.h / maxH) : 0.1} />
        ))}
      </svg>
      <div className="profile-axis">
        <span><b>{mirror ? letter : `${letter}′`}</b> · {compass(leftAz)} · −{shownKm} km</span>
        <span>
          {hoursStrip
            ? <>{view.total} over this lunar day, ray traced at every point: up to {maxH.toFixed(0)} h of {lightTotalH.toFixed(0)} h ({lightTotalH ? Math.min(100, Math.round((100 * maxH) / lightTotalH)) : 0}%) · stronger colour = more</>
            : <>{view.total} per ground point over this lunar day: {manualSun ? "not shown for a manual Sun position" : turning ? "not shown while the slice turns; lock the slice to see it" : lightWait ? "ray tracing the ground…" : "needs the ray-traced data"}</>}
        </span>
        <span>+{shownKm} km · {compass(rightAz)} · <b>{mirror ? `${letter}′` : letter}</b></span>
      </div>

      <div className="profile-stats">
        {!expert ? (
          <div className="stats">
            <Stat label={body === "sun" ? "Landing spot" : "Call home?"} value={skyWords.value} sub={skyWords.sub} />
            <Stat label={`Next ${body === "sun" ? "sunrise or sunset" : "Earthrise or Earthset"}`} value={nextValue} sub={nextSub} />
            <Stat label="Where the Sun is" value={now ? (sunShines ? `Low in the ${compass(now.sun_az)}` : "Below the horizon") : "…"}
              sub={now ? `${aboveBelow(now.sun_alt)}${now.sun_alt > 0 && now.sun_alt < 3 ? ": barely up, like sunrise" : now.sun_alt <= 0 && sunShines ? ": still in view from this high ground" : ""}` : undefined} />
            <Stat label="Shadows point" value={now && sunShines ? compass(now.sun_az + 180) : "n/a"} />
            <Stat label={body === "sun" ? "This slice in shadow" : "This slice cut off from Earth"} value={shadePct != null ? `${shadePct}%` : now ? "n/a" : "…"} sub={shadeSub} />
            <Stat label="Moment" value={now ? `Day ${dayN.toFixed(1)} of ${LUNAR_DAY_DAYS}` : "…"} sub="one lunar day ≈ 29.5 Earth days" />
          </div>
        ) : (
        <div className="stats">
          <Stat label={body === "sun" ? "Landing spot" : "Earth contact at the lander"} value={skyWords.value} sub={skyWords.sub} />
          <Stat label={`${view.name} above skyline`} value={seen ? signed(seen.margin) : sky.error ? "n/a" : "…"}
            sub={seen && targetAlt != null ? `${view.name} ${signed(targetAlt)}, skyline ${signed(seen.horizon)} toward ${targetAz.toFixed(0)}°; disc radius ${DISC_RADIUS[body]}°` : sky.error ? "skyline not loaded" : undefined} />
          <Stat label={`Next ${body === "sun" ? "sunrise / sunset" : "Earthrise / Earthset"}`} value={nextValue} sub={nextSub} />
          <Stat label="Sun elevation" value={now ? `${now.sun_alt.toFixed(1)}°` : "…"} sub={override ? "manual override" : "geometric, at the slider time"} />
          <Stat label="Shadow azimuth" value={now && sunShines ? `${((now.sun_az + 180) % 360).toFixed(0)}° (${compass(now.sun_az + 180)})` : "n/a"} sub={now && now.sun_alt > 0 ? `1 m rock → ${(1 / Math.tan((now.sun_alt * Math.PI) / 180)).toFixed(0)} m shadow` : undefined} />
          <Stat label="Sun azimuth" value={now ? `${now.sun_az.toFixed(0)}° (${compass(now.sun_az)})` : "…"} />
          <Stat label={`${view.name} off the slice line`} value={place ? `${off.toFixed(1)}°` : "…"}
            sub={place ? (inPage ? "in the page (within 11.25°): sight line drawn at the real angle" : "off the page: hollow marker, nothing projected") : undefined} />
          <Stat label={view.pct} value={shadePct != null ? `${shadePct}%` : now ? "n/a" : "…"} sub={shadeSub} />
          <Stat label={body === "sun" ? "Earth (ray traced)" : "Sun (ray traced)"}
            value={body === "sun" ? shortWords("earth", seenEarth) : shortWords("sun", seenSun)}
            sub={skyline ? `${how}, at the slider time` : undefined} />
          {details && (
            <Stat label="Earth contact (A–H engine)" value={details.visibility.has_earth_comm ? "in view · contact ✓" : "blocked · relay needed"}
              sub={`A–H engine, ${details.query_timestamp_utc.slice(11, 16)} UTC (incl. +${details.ephemeris.relief_dip_deg}° for site height)`} />
          )}
          <Stat label="Moment" value={now ? `Day ${dayN.toFixed(1)} of ${LUNAR_DAY_DAYS}` : "…"} sub={now ? new Date(now.time).toUTCString().slice(5, 22) + " UTC" : ""} />
        </div>
        )}
      </div>

      {/* the eye height goes in through a spread, so it reaches the strip whether or not the strip declares it */}
      <SkylineStrip {...{ observerM }} skyline={skyline} series={pts} index={idx} body={body} sliceAzimuth={shown} letter={letter}
        onPickAzimuth={lockTo}
        onPickTime={(i) => pts[i] && setTime(new Date(pts[i].time))} />

      <div className="profile-hint">
        {hint && (
          <>
            <span>{hint.text}</span>
            {hint.widen && <button onClick={() => pickLength(hint.widen!)}>Widen the slice to {hint.widen} km each way</button>}
            {hint.look && <button onClick={() => lockTo(wholeDeg(targetAz))}>Lock to {view.the} now</button>}
          </>
        )}
      </div>

      <div className="profile-legend">
        <span><i className="line sun" style={{ background: view.color }} />{view.lit}</span>
        <span><i className="line shade" style={body === "earth" ? { background: "var(--red)" } : undefined} />{view.dark}</span>
        <span><i className="swatch air" />{view.air}, from ground on this slice</span>
        <span><i className="line sight" />Sight line from the lander to {view.the}</span>
        <span><i className="ring" style={{ color: view.color }} />{view.name} off this slice</span>
        <span><i className="line tick" />Skyline in {view.the === "Earth" ? "Earth's" : "the Sun's"} true direction (ray traced)</span>
        <span>{exag === 1 ? "Drawn 1:1, no vertical exaggeration" : `Heights exaggerated ×${exag}; printed angles are real`}{sec?.curvature ? " · Moon's curve included" : ""}</span>
      </div>
      <p className="muted small profile-note">Sun and Earth symbols are schematic, not to scale. {groundNote} The small map at the top right shows the same moment from above, with shadows ray traced on the real terrain; click it to aim the slice, or press "Larger" to read it.</p>

      {skyline && (
        <div className="profile-source">
          Answer for the lander: {skyline.synthetic ? "synthetic terrain model (no measured terrain was available)" : `rays traced in every direction through ${skyline.source}, out to ${skyline.reach_km.toFixed(0)} km or to the edge of the terrain data, from ${skyline.observer_m} m above the ground`}
          {skyline.synthetic && skyline.note ? `. ${skyline.note}` : ""}. {colours === "true" ? "The colours on the slice are ray traced the same way from every ground point." : "Without the ray-traced ground light, the colours on the slice show only shadows cast by ground on this slice."}
          {edgeNote && <> <b>Caution:</b> {edgeNote}</>}
        </div>
      )}

      <div className="controls">
        <label>Lunar season</label>
        <div className="seasons">
          {(seasons.data ?? []).map((s) => {
            const active = Math.abs(Date.parse(s.time) - baseTime.getTime()) < 3.6e6;
            return (
              <button key={s.key} className={active ? "active" : ""} onClick={() => setBaseTime(new Date(s.time))}
                title={`Sun over ${Math.abs(s.subsolar_lat).toFixed(2)}° ${s.subsolar_lat < 0 ? "S" : "N"}`}>
                {s.name}<small>{new Date(s.time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small>
              </button>
            );
          })}
        </div>

        <label htmlFor="t">Time in lunar day</label>
        <div className="ctl">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <input id="t" type="range" min={0} max={Math.max(0, pts.length - 1)} value={idx}
            onChange={(e) => pts.length && setTime(new Date(pts[+e.target.value].time))} />
          <output>Day {dayN.toFixed(1)}</output>
        </div>

        <label>Play speed</label>
        <div className="tabs" role="group" aria-label="How fast the time runs when playing">
          {SPEEDS.map((v) => (
            <button key={v.ms} className={stepMs === v.ms ? "active" : ""} aria-pressed={stepMs === v.ms} onClick={() => setStepMs(v.ms)}>{v.name}</button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>one lunar day in about {Math.round((Math.max(1, pts.length) * stepMs) / 1000)} seconds</span>
        </div>

        <label>Slice reach</label>
        <div className="tabs" role="group" aria-label="How far the slice reaches each way from the lander">
          {LENGTH_PRESETS.map((km) => (
            <button key={km} className={lengthKm === km ? "active" : ""} aria-pressed={lengthKm === km} onClick={() => pickLength(km)}>{km} km</button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>each way from the lander</span>
        </div>

        <label>Height scale</label>
        <div className="tabs" role="group" aria-label="How much the heights are stretched">
          {EXAG_STEPS.map((e) => (
            <button key={e} className={exag === e ? "active" : ""} aria-pressed={exag === e} onClick={() => setExagPick({ on: scaleKey, value: e })}>{scaleName(e)}</button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>
            {exag === 1 ? "true scale" : "heights stretched; printed angles are real; see the small 1:1 picture"}
            {exagPick && exagPick.on === scaleKey && autoEx != null && exagPick.value !== autoEx && <> · <button className="link" onClick={() => setExagPick(null)}>back to {scaleName(autoEx)}</button></>}
          </span>
        </div>

        <label>Eye height</label>
        <div className="tabs" role="group" aria-label="Height of the solar panel or antenna above the ground">
          {EYE_HEIGHTS.map((m) => (
            <button key={m} className={observerM === m ? "active" : ""} aria-pressed={observerM === m} onClick={() => setObserverM(m)}>{m} m</button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>
            height of the solar panel or antenna. On a crest the skyline is often the lander's own ground, so a taller mast sees more.
            {eyeUsed !== observerM && !sky.error && " Tracing the skyline again…"}
            {expert && gain && <> At {observerM} m: {gain.high.toFixed(0)} h of {body === "sun" ? "sunlight" : "Earth in view"} in this lunar day, {Math.abs(gain.high - gain.low) < 0.5 ? "the same as" : `${Math.abs(gain.high - gain.low).toFixed(0)} h ${gain.high >= gain.low ? "more" : "less"} than`} at {EYE_M} m ({gain.low.toFixed(0)} h).</>}
          </span>
        </div>

        {expert && <>
        <label htmlFor="b">Slice direction</label>
        <div className="ctl">
          <input id="b" type="range" min={0} max={360 - STATE_STEP} step={STATE_STEP} value={snap16(bearing ?? 0)}
            onChange={(e) => lockTo(+e.target.value)} />
          <output>{compass((bearing ?? 0) + 180)} to {compass(bearing ?? 0)}, {fmtAz(bearing ?? 0)}</output>
        </div>

        <label htmlFor="l">Slice length</label>
        <div className="ctl">
          <input id="l" type="range" min={2} max={MAX_KM} value={lengthKm} onChange={(e) => pickLength(+e.target.value)} />
          <output>{2 * lengthKm} km across</output>
        </div>
        </>}
      </div>

      <ExplainCard text={body === "sun" ? explain.profile : explain.profileEarth} />
    </div>
  );
}

/** The ray-traced answer for the lander, in words. */
function verdictWords(body: Body, seen: BodyView | null, sky: Skyline | null, error: string | null): { value: string; sub: string } {
  if (!seen || !sky) {
    return error ? { value: "n/a", sub: `The skyline could not be loaded (${error}), so there is no answer for the lander yet.` }
      : { value: "…", sub: "Tracing rays through the terrain…" };
  }
  const the = VIEW[body].the;
  const eye = `${sky.observer_m} m eye height`;
  const how = sky.synthetic ? "Synthetic model, not measured terrain" : "Ray traced through the terrain";
  const beside = seen.blockerKm != null && seen.blockerKm < BESIDE_LANDER_KM;
  const far = seen.blockerKm == null ? "below the skyline"
    : beside ? `behind the ground beside the lander, ${fmtDist(seen.blockerKm * 1000)} away. This close, the answer depends on how high the panels or antenna sit (${eye})`
    : `behind terrain ${fmtDist(seen.blockerKm * 1000)} away`;
  const cut = beside ? ` (ground beside the lander: depends on mast height, ${eye})` : "";
  if (body === "sun") {
    if (seen.state === "clear") return { value: "In sunlight", sub: `${how}: the Sun is ${fmtDeg(seen.margin)} above the skyline.` };
    if (seen.state === "partial") return { value: "Sun partly hidden", sub: `${how}: the skyline cuts across the Sun's disc${cut}.` };
    return { value: "In shadow", sub: `${how}: the Sun is ${far}.` };
  }
  if (seen.state === "clear") return { value: "Earth in view", sub: `${how}: ${the} is ${fmtDeg(seen.margin)} above the skyline.` };
  if (seen.state === "partial") return { value: "Earth partly hidden", sub: `${how}: the skyline cuts across Earth's disc${cut}.` };
  return { value: "Needs a relay", sub: `${how}: ${the} is ${far}.` };
}

function shortWords(body: Body, seen: BodyView | null): string {
  if (!seen) return "…";
  const m = signed(seen.margin);
  if (seen.state === "clear") return body === "sun" ? `in view, ${m}` : `in view · contact ✓ (${m})`;
  if (seen.state === "partial") return `partly hidden, ${m}`;
  return body === "sun" ? `hidden, ${m}` : `hidden · relay needed (${m})`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub ?? ""}</div>
    </div>
  );
}
