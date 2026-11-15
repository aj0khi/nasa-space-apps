// Sunlight & shadow along a slice through the site, across one lunar day. Owner: SKY3D.
//
// Cross-section overhaul (LEAD). Same panel and controls; what changed underneath:
//   - The ground is measured terrain from GET /terrain/section (x_m / z_m with the Moon's curvature in z).
//   - The slice has 16 fixed directions (every 22.5°). The date and time pick which one is shown, and the
//     ground stays still while that one is on screen.
//   - "Is the lander in sunlight / can it see Earth" is ray traced in every direction (GET /terrain/skyline).
//     The colours along the slice still show only the shadows cast by ground on this one line.
//   - The Sun's real angle is printed on the drawing, and a sight line is drawn from the lander.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { compass } from "../../lib/geo";
import { useApp } from "../../state/store";
import type { Section, SeriesPoint, Skyline } from "../../types";
import ExplainCard from "../learn/ExplainCard";
import { useExpert } from "../learn/ModeGate";
import {
  DISC_RADIUS, EXAG_STEPS, EYE_M, R_MOON_M, STATES, STATE_STEP, autoExag, bodyView, fmtDuration, fromSection, groundAt,
  inSlice, lightHours, nearestIndex, nextCrossing, shadeSlice, sightHit, skylineDistAt, snap16, stateNumber,
} from "./profileMath";
import type { Body, BodyView } from "./profileMath";

const W = 1000;
const TOP = 120; // room above the terrain for the Sun and its rays
const BOTTOM = 26;
const LUNAR_DAY_DAYS = 29.53;
const D2R = Math.PI / 180;
const EDGE = 40; // how far in from the side the Sun / Earth marker sits
const DISC = 12; // marker radius (px). A symbol: the real disc would be about 2 px wide at this scale.
const TRUE_SCALE_MAX_KM = 15; // slices up to this reach are drawn 1:1 by default
const MAX_KM = 150;
const LENGTH_PRESETS = [8, 30, 100, 150]; // reach each way from the lander (km)
const NO_POINTS: SeriesPoint[] = [];
// Closer than this, the terrain that sets the skyline is the ground beside the lander. There the answer depends on
// how high the solar panels or antenna sit (the model looks from 2 m up), and a 20 m terrain grid cannot settle it.
const BESIDE_LANDER_KM = 0.2;

// Four ways to look at the site, relative to the Sun (or Earth). `offset` turns the slice bearing (A end) away from its azimuth.
const VIEWPOINTS = [
  { key: "right", offset: 0 },
  { key: "left", offset: 180 },
  { key: "front", offset: 90 },
  { key: "back", offset: 270 },
] as const;
type ViewKey = (typeof VIEWPOINTS)[number]["key"];

const VIEWPOINT_TEXT: Record<Body, Record<ViewKey, { label: string; note: string }>> = {
  sun: {
    right: { label: "Sun on the right", note: "Sun on your right: shadows fall to the left, along the slice." },
    left: { label: "Sun on the left", note: "Sun on your left: shadows fall to the right, along the slice." },
    front: { label: "Facing the Sun", note: "You face the Sun: it shines across the slice, so shadows fall toward you, not along this line." },
    back: { label: "Sun behind you", note: "Sun behind you: shadows fall away from you, not along this line." },
  },
  earth: {
    right: { label: "Earth on the right", note: "Earth on your right: ground that blocks the radio link shows up along the slice." },
    left: { label: "Earth on the left", note: "Earth on your left: ground that blocks the radio link shows up along the slice." },
    front: { label: "Facing Earth", note: "You face Earth: the link runs across the slice, so the ground that blocks it is mostly off this line." },
    back: { label: "Earth behind you", note: "Earth is behind you: the link runs across the slice, so the ground that blocks it is mostly off this line." },
  },
};

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

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : km.toFixed(0));
/** "120 m" under a kilometre, otherwise "3.2 km" / "28 km". */
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${fmtKm(m / 1000)} km`);
const fmtDeg = (d: number) => `${Math.abs(d).toFixed(1)}°`;
/** "1.6° above horizontal" / "0.3° below horizontal". Horizontal = the lander's level plane. */
const aboveBelow = (alt: number) => `${fmtDeg(alt)} ${alt >= 0 ? "above" : "below"} horizontal`;
const signed = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}°`;

/** `letter` labels the slice ends (A … A′) and the site in the middle, as in the team sketch. */
export default function SunProfile({ letter = "A" }: { letter?: string }) {
  const gradientId = useId();
  const groundId = useId();
  const { time, setTime, baseTime, setBaseTime } = useApp();
  const details = useApp((s) => s.details); // A–H engine verdict for the selected site (null for custom points)
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";

  const [manualBearing, setBearing] = useState(STATE_STEP);
  const [followSun, setFollowSun] = useState(true); // system_arch.md: A–A′ runs along the Sun's ray
  const [lengthKm, setLengthKm] = useState(8);
  const [exagPick, setExagPick] = useState<number | null>(null); // null = automatic: 1:1 up to 15 km each way
  const [playing, setPlaying] = useState(false);
  const [body, setBody] = useState<Body>("sun");
  const [viewpoint, setViewpoint] = useState<ViewKey>("right");
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

  // Following the Sun: A′ (away from the Sun) → site → A (toward the Sun). The A end snaps to the nearest of
  // 16 fixed directions (22.5° apart), so the ground stays still until the Sun has moved on to the next one.
  // The viewpoint buttons turn the slice relative to the Sun; the turn is applied before snapping.
  // In the Earth-contact view the slice follows Earth instead (A = toward Earth).
  const vp = VIEWPOINTS.find((v) => v.key === viewpoint)!;
  const targetAz = now ? (body === "sun" ? now.sun_az : now.earth_az) : 0;
  const targetAlt = now ? (body === "sun" ? now.sun_alt : now.earth_alt) : null;
  const bearing = followSun && now ? snap16(targetAz + vp.offset) : snap16(manualBearing);

  // Measured ground along the slice. The previous slice stays on screen until the next one arrives.
  const ready = !followSun || !!now; // when following the Sun, wait until its position is known
  const section = useApi(() => (loc && ready ? loadSection(loc, bearing, lengthKm).then((d) => ({ d, site: key })) : null),
    [key, bearing, lengthKm, ready], 120);
  const sec = section.data && section.data.site === key ? section.data.d : null; // never another site's ground
  const shown = sec ? sec.azimuth : bearing; // direction of the slice on screen
  const shownKm = sec ? sec.length_km : lengthKm;
  const stale = !!sec && (Math.abs(sec.azimuth - bearing) > 0.01 || Math.abs(sec.length_km - lengthKm) > 0.01);

  // Ray-traced skyline all around the lander: decides whether the Sun / Earth is in view from the lander itself.
  const sky = useApi(() => (loc ? api.skyline(loc).then((d) => ({ d, site: key })) : null), [key], 0);
  const skyline: Skyline | null = sky.data && sky.data.site === key ? sky.data.d : null;

  // Play: step through the lunar day (1 sample = 1 hour). The clock waits while the next slice is being read.
  const waiting = useRef(false);
  waiting.current = !!loc && !section.error && (!sec || stale);
  useEffect(() => {
    if (!playing || !pts.length) return;
    const id = setInterval(() => {
      if (waiting.current) return;
      const i = nearestIndex(pts, useApp.getState().time);
      setTime(new Date(pts[(i + 1) % pts.length].time));
    }, 60);
    return () => clearInterval(id);
  }, [playing, pts, setTime]);

  // Read the next direction ahead of time, so the change is smooth when the Sun gets there.
  useEffect(() => {
    if (!loc || !followSun || !sec || stale || override) return;
    for (let j = idx + 1; j < Math.min(pts.length, idx + 60); j++) {
      const b = snap16((body === "sun" ? pts[j].sun_az : pts[j].earth_az) + vp.offset);
      if (b !== bearing) {
        loadSection(loc, b, lengthKm).catch(() => undefined);
        break;
      }
    }
    // idx is read once per direction on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bearing, lengthKm, stale, !sec, followSun, body, vp.offset, pts, !override]);

  const slice = useMemo(() => (sec ? fromSection(sec) : null), [sec]);
  const radius = sec?.curvature ? R_MOON_M : Infinity;

  // `light` is the light source for the chosen view, projected into the slice: the Sun, or Earth for the radio link.
  const light = now && targetAlt != null ? inSlice(targetAlt, targetAz, shown) : null;
  const shadeNow = useMemo(() => (slice && light ? shadeSlice(slice, light.tanA, light.sunRight, radius) : null),
    [slice, light?.tanA, light?.sunRight, radius]);
  const hours = useMemo(() => (slice && pts.length ? lightHours(slice, pts, shown, body, radius) : null),
    [slice, pts, shown, body, radius]);
  const anyLit = !!shadeNow && shadeNow.lit.some(Boolean);

  // Sight line from the lander toward the body at its true elevation. Only when the slice points at the body.
  const sight = useMemo(() => {
    if (!slice || !light || targetAlt == null || !light.along) return null;
    const tanEl = Math.tan(targetAlt * D2R);
    const dir: 1 | -1 = light.sunRight ? 1 : -1;
    return { tanEl, dir, hit: sightHit(slice, dir, tanEl, EYE_M) };
  }, [slice, light?.along, light?.sunRight, targetAlt]);

  // Ray-traced answer for the lander: body altitude against the skyline at the body's azimuth.
  const seenSun = now && skyline ? bodyView(now.sun_alt, now.sun_az, skyline, "sun") : null;
  const seenEarth = now && skyline ? bodyView(now.earth_alt, now.earth_az, skyline, "earth") : null;
  const seen = body === "sun" ? seenSun : seenEarth;
  const manualSun = !!override && body === "sun";
  // The Sun counts as shining somewhere near the site when it is above horizontal, or in view from the lander.
  const sunShines = !!now && (now.sun_alt > 0 || (!!seenSun && seenSun.state !== "hidden"));
  const next = skyline && pts.length && !manualSun ? nextCrossing(pts, idx, skyline.elev_deg, body) : null;

  // Height scale: true scale up to 15 km each way. Longer slices get the smallest scale that keeps the relief visible.
  const autoEx = useMemo(() => {
    if (!slice || !sec || sec.length_km <= TRUE_SCALE_MAX_KM) return 1;
    let zmin = Infinity, zmax = -Infinity;
    for (const z of slice.z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    return autoExag(zmax - zmin, W / (2000 * sec.length_km));
  }, [slice, sec]);
  const exag = exagPick ?? autoEx;
  const longView = shownKm > TRUE_SCALE_MAX_KM;
  const pickLength = (km: number) => { setLengthKm(Math.max(2, Math.min(MAX_KM, km))); setExagPick(null); };

  // ---------- geometry → pixels ----------
  const draw = useMemo(() => {
    if (!slice || !shadeNow || !sec || !light) return null;
    const L = sec.length_km * 1000;
    const pxPerM = W / (2 * L);
    const vpm = pxPerM * exag;
    let zmin = Infinity, zmax = -Infinity;
    for (const z of slice.z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    const groundH = Math.max(60, (zmax - zmin) * vpm);
    const H = TOP + groundH + BOTTOM;
    const X = (x: number) => (x + L) * pxPerM;
    const Y = (z: number) => TOP + (zmax - z) * vpm;
    const n = slice.x.length;

    const groundLine = slice.x.map((x, i) => `${X(x).toFixed(1)},${Y(slice.z[i]).toFixed(1)}`);
    const groundFill = `M0,${H} L${groundLine.join(" L")} L${W},${H} Z`;

    const airTop = slice.x.map((x, i) => `${X(x).toFixed(1)},${Math.max(0, Y(shadeNow.top[i])).toFixed(1)}`);
    const air = `M${airTop.join(" L")} L${groundLine.slice().reverse().join(" L")} Z`;

    // sunlit / shaded runs of the ground line
    const runs: { lit: boolean; d: string }[] = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || shadeNow.lit[i] !== shadeNow.lit[start]) {
        runs.push({ lit: shadeNow.lit[start], d: `M${groundLine.slice(start, Math.min(i + 1, n)).join(" L")}` });
        start = i;
      }
    }

    // rays: aimed at the edges that cast shadows (lit point whose down-sun neighbour is dark)
    const rays: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const dir = light.sunRight ? 1 : -1;
    const theta = Math.atan(Number.isFinite(light.tanA) ? light.tanA * exag : light.tanA > 0 ? 1e9 : -1e9);
    if (anyLit) {
      const step = light.sunRight ? -1 : 1; // direction shadows fall
      const casters: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = i + step;
        if (shadeNow.lit[i] && j >= 0 && j < n && !shadeNow.lit[j]) casters.push(i);
      }
      if (!casters.length) for (let q = 1; q <= 3; q++) casters.push(Math.floor((q * n) / 4));
      const len = 170;
      for (const i of casters.slice(0, 4)) {
        const x1 = X(slice.x[i]), y1 = Y(slice.z[i]);
        rays.push({ x1, y1, x2: x1 + dir * len * Math.cos(theta), y2: y1 - len * Math.sin(theta) });
      }
    }

    // The lander's eye, and where the Sun / Earth marker goes.
    const z0 = groundAt(slice, 0) ?? 0;
    const eye = { x: X(0), y: Y(z0 + EYE_M) };
    let sunXY: { x: number; y: number } | null = null;
    let sightLine: { x2: number; y2: number; hit: { x: number; y: number } | null } | null = null;
    let labelAt: { x: number; y: number; anchor: "start" | "end" } | null = null;
    if (sight) {
      // On the sight line, at the true angle (times the height scale when the heights are exaggerated).
      const t = sight.tanEl * exag;
      const xe = sight.dir > 0 ? W - EDGE : EDGE;
      let x = xe, y = eye.y - Math.abs(xe - eye.x) * t;
      let sunk = false;
      if (y < 24) { y = 24; x = eye.x + (sight.dir * (eye.y - 24)) / t; } // leaves through the top
      else if (y > H - 6) { y = H - 6; x = eye.x + (sight.dir * (eye.y - (H - 6))) / t; sunk = true; } // heads into the ground
      sunXY = { x, y };
      sightLine = { x2: x, y2: y, hit: sight.hit ? { x: X(sight.hit.x), y: Y(sight.hit.z) } : null };
      const side = sight.dir > 0 ? -1 : 1; // put the text on the lander's side of the marker
      const anchor = side < 0 ? "end" : "start";
      labelAt = sunk ? { x: sight.dir > 0 ? W - 60 : 60, y: TOP - 14, anchor } // marker is under the ground: keep the text in the sky
        : y <= 40 ? { x: x + side * (DISC + 8), y: y + 5, anchor }
        : { x: x + side * (DISC + 8), y: Math.max(16, y - 16), anchor };
    } else if (light.tanA > 0) {
      // The body shines across the slice: marker at the top, as seen projected into the slice.
      const cx = W / 2, cy = Y((zmin + zmax) / 2);
      const d = (cy - 34) / Math.max(Math.sin(theta), 1e-3);
      const x = Math.min(W - EDGE, Math.max(EDGE, cx + dir * d * Math.cos(theta)));
      sunXY = { x, y: 34 };
      labelAt = x > W / 2 ? { x: x - DISC - 8, y: 39, anchor: "end" } : { x: x + DISC + 8, y: 39, anchor: "start" };
    }

    return { H, X, Y, eye, groundFill, air, runs, rays, sunXY, sightLine, labelAt };
  }, [slice, shadeNow, sec, exag, anyLit, light?.tanA, light?.sunRight, sight]);

  const shadePct = shadeNow ? Math.round((100 * shadeNow.lit.filter((l) => !l).length) / shadeNow.lit.length) : null;
  const maxH = hours ? Math.max(...hours) : 0;
  const totalH = pts.length ? (Date.parse(pts[pts.length - 1].time) - Date.parse(pts[0].time)) / 3.6e6 : 0;
  const dayN = now ? (Date.parse(now.time) - Date.parse(pts[0].time)) / 864e5 : 0;

  // ---------- words ----------
  const skyWords = verdictWords(body, seen, skyline, sky.error);
  const how = skyline?.synthetic ? "Synthetic model, not measured terrain" : "Ray traced through the terrain";
  const nextValue = !skyline ? (sky.error ? "—" : "…") : manualSun ? "—"
    : next ? `${next.rising ? view.rise : view.set} in ${fmtDuration(next.hours)}`
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

  // What the drawing says about the body's angle. The number is always the real one from the ephemeris.
  const angleText = targetAlt == null || !light ? "" : sight
    ? `${view.name} ${aboveBelow(targetAlt)}${exag !== 1 ? ` (drawn steeper: heights ×${exag})` : ""}`
    : `${view.name} ${aboveBelow(targetAlt)}, shining across this slice${light.tanA > 0 ? " (so it looks steeper side-on)" : ""}`;
  // "Below the horizon" banner: only when the body really is out of view (or, with no skyline yet, below horizontal).
  const showDown = targetAlt != null && targetAlt <= 0 && (!seen || seen.state === "hidden");

  // One line under the drawing when the slice and the ray-traced answer need explaining together.
  const hint = (() => {
    if (!seen || !light || !sec || targetAlt == null) return null;
    const d = seen.blockerKm;
    const blocked = seen.state !== "clear";
    const hides = seen.state === "hidden" ? "hides" : "partly hides";
    const side = `${light.off.toFixed(0)}° to the side of this slice`;
    if (blocked && !light.along) {
      return { text: `The terrain that ${hides} ${view.the}${d != null ? ` is ${fmtDist(d * 1000)} away` : " lies"} toward ${compass(targetAz)}, off this slice.`,
        look: true, widen: null as number | null };
    }
    if (blocked && d != null && d > sec.length_km) {
      const want = LENGTH_PRESETS.find((p) => p >= d * 1.05) ?? MAX_KM;
      return { text: d > MAX_KM
          ? `The terrain that ${hides} ${view.the} is ${fmtKm(d)} km away, farther than the longest slice (${MAX_KM} km each way).`
          : `The terrain that ${hides} ${view.the} is ${fmtKm(d)} km away, beyond the end of this slice.`,
        look: false, widen: want > sec.length_km ? want : null };
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

  const loadingText = series.error ? `Could not load the Sun and Earth positions (${series.error}).`
    : !sec && section.error ? `Could not load the terrain slice (${section.error}).`
    : !pts.length ? "Loading Sun and Earth positions…"
    : "Loading the terrain slice… the first read of a site takes a few seconds, or up to half a minute when the terrain is read from NASA.";

  return (
    <div className="panel profile">
      <h3>Cross section {letter}–{letter}′: {body === "sun" ? "sunlight" : "contact with Earth"} along a slice through the site {sec?.synthetic && <small>(synthetic terrain)</small>}</h3>

      <div className="tabs" role="group" aria-label="What to check along the slice" style={{ marginBottom: 8 }}>
        {(Object.keys(VIEW) as Body[]).map((b) => (
          <button key={b} className={body === b ? "active" : ""} aria-pressed={body === b} onClick={() => setBody(b)}>{VIEW[b].tab}</button>
        ))}
      </div>

      <div className="viewpoints">
        <span className="muted small">View the site with{body === "sun" ? " the" : ""}</span>
        <div className="tabs" role="group" aria-label={`Viewpoint relative to ${view.the}`}>
          {VIEWPOINTS.map((v) => (
            <button key={v.key} className={followSun && viewpoint === v.key ? "active" : ""} aria-pressed={followSun && viewpoint === v.key}
              onClick={() => { setViewpoint(v.key); setFollowSun(true); }}>{VIEWPOINT_TEXT[body][v.key].label}</button>
          ))}
        </div>
        {followSun && <span className="muted small">{VIEWPOINT_TEXT[body][vp.key].note}</span>}
      </div>
      {override && (
        <div className="override-note">Manual Sun position ({override.alt}°, {override.az}°) from Mission setup. <button className="link" onClick={() => useApp.getState().setSunOverride(null)}>Use the real Sun</button></div>
      )}

      <div className="profile-state" aria-live="polite">
        {sec || ready ? <span><b>Slice {stateNumber(shown)} of {STATES}</b>, {letter} points to {shown}° ({compass(shown)})</span>
          : <span>Finding where {view.the} is…</span>}
        {stale && !section.error && <span>· loading slice {stateNumber(bearing)}…</span>}
        {stale && section.error && <span>· could not load slice {stateNumber(bearing)} ({section.error})</span>}
        {sec && <span>· Terrain: {sec.source}</span>}
        {sec?.synthetic && sec.note && <span>· {sec.note}</span>}
      </div>

      {draw && slice ? (
        <svg viewBox={`0 0 ${W} ${draw.H}`} width="100%" role="img"
          aria-label={`Terrain slice from ${compass(shown + 180)} to ${compass(shown)}. ${angleText}. ${view.pct}: ${shadePct}%. Lander: ${skyWords.value}.`}>
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
          </defs>
          {draw.rays.map((r, i) => <line key={i} {...r} stroke={view.color} strokeOpacity={0.55} strokeWidth={1.2} />)}
          {/* the marker is drawn before the ground, so higher ground on the slice hides it, as it would in a side view */}
          {draw.sunXY && <circle cx={draw.sunXY.x} cy={draw.sunXY.y} r={DISC} fill={`url(#${gradientId})`} />}
          {showDown && (
            <text x={W / 2} y={44} textAnchor="middle" fill="var(--muted)" fontSize={18}>
              {view.down}
            </text>
          )}
          <path d={draw.groundFill} fill={`url(#${groundId})`} />
          <path d={draw.air} fill="var(--shadow-air)" />
          {draw.runs.map((r, i) => (
            <path key={i} d={r.d} fill="none" stroke={r.lit ? view.color : body === "sun" ? "var(--shade)" : "var(--red)"} strokeWidth={3.5} strokeLinejoin="round" />
          ))}
          {/* sight line from the lander toward the Sun / Earth, at the real angle */}
          {draw.sightLine && (
            <g>
              {draw.sightLine.hit ? (
                <>
                  <line x1={draw.eye.x} y1={draw.eye.y} x2={draw.sightLine.hit.x} y2={draw.sightLine.hit.y} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="7 4" />
                  <line x1={draw.sightLine.hit.x} y1={draw.sightLine.hit.y} x2={draw.sightLine.x2} y2={draw.sightLine.y2} stroke="var(--text)" strokeOpacity={0.3} strokeWidth={1.2} strokeDasharray="2 5" />
                  <circle cx={draw.sightLine.hit.x} cy={draw.sightLine.hit.y} r={5} fill="var(--panel)" stroke="var(--text)" strokeWidth={2} />
                  {sight?.hit && (() => {
                    // keep the note inside the drawing: it runs away from the lander unless that would leave the frame
                    const hx = draw.sightLine.hit!.x;
                    const outward = sight.dir > 0 ? hx < W - 300 : hx > 300;
                    const toRight = sight.dir > 0 ? outward : !outward;
                    return (
                      <text x={hx + (toRight ? 9 : -9)} y={draw.sightLine.hit!.y - 9} textAnchor={toRight ? "start" : "end"}
                        fontSize={13} fill="var(--text)" className="profile-halo">on this slice: meets the ground {fmtDist(sight.hit.distM)} out</text>
                    );
                  })()}
                </>
              ) : (
                <line x1={draw.eye.x} y1={draw.eye.y} x2={draw.sightLine.x2} y2={draw.sightLine.y2} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="7 4" />
              )}
            </g>
          )}
          {draw.labelAt && angleText && (
            <text x={draw.labelAt.x} y={draw.labelAt.y} textAnchor={draw.labelAt.anchor} fontSize={14} fill="var(--text)" className="profile-halo">{angleText}</text>
          )}
          {/* the landing site */}
          <line x1={draw.X(0)} x2={draw.X(0)} y1={TOP - 30} y2={draw.H} stroke="var(--text)" strokeDasharray="3 4" strokeOpacity={0.5} />
          <text x={draw.X(0)} y={TOP - 36} textAnchor="middle" fontSize={14} fill="var(--text)">▼ {letter}</text>
          {/* slice ends, A and A′ */}
          {/* system_arch.md: A′ = away from the Sun, A = toward the Sun (right end = bearing direction) */}
          {[{ x: 1.5, t: `${letter}′`, a: "start" }, { x: W - 1.5, t: letter, a: "end" }].map((e) => (
            <g key={e.t}>
              <line x1={e.x} x2={e.x} y1={TOP - 54} y2={draw.H} stroke="var(--text)" strokeWidth={2} />
              <text x={e.a === "start" ? e.x + 8 : e.x - 8} y={TOP - 40} textAnchor={e.a} fontSize={18} fontWeight={700} fill="var(--text)">{e.t}</text>
            </g>
          ))}
        </svg>
      ) : (
        <div className="profile-loading">{loadingText}</div>
      )}

      {hours && slice && (
        <>
          <svg viewBox={`0 0 ${W} 18`} width="100%" preserveAspectRatio="none" aria-hidden>
            {hours.map((h, i) => (
              <rect key={i} x={(i * W) / hours.length} width={W / hours.length + 0.6} height={18}
                fill={view.color} fillOpacity={maxH ? 0.1 + 0.9 * (h / maxH) : 0.1} />
            ))}
          </svg>
          <div className="profile-axis">
            <span><b>{letter}′</b> · {compass(shown + 180)} · −{shownKm} km</span>
            <span>
              {view.total} over this lunar day: up to {maxH.toFixed(0)} h of {totalH.toFixed(0)} h
              ({totalH ? Math.round((100 * maxH) / totalH) : 0}%) · stronger colour = more
            </span>
            <span>+{shownKm} km · {compass(shown)} · <b>{letter}</b></span>
          </div>
        </>
      )}

      <div className="profile-hint">
        {hint && (
          <>
            <span>{hint.text}</span>
            {hint.widen && <button onClick={() => pickLength(hint.widen!)}>Widen the slice to {hint.widen} km each way</button>}
            {hint.look && <button onClick={() => { setViewpoint("right"); setFollowSun(true); }}>Look toward {view.the}</button>}
          </>
        )}
      </div>

      <div className="profile-legend">
        <span><i className="line sun" style={{ background: view.color }} />{view.lit}</span>
        <span><i className="line shade" style={body === "earth" ? { background: "var(--red)" } : undefined} />{view.dark}</span>
        <span><i className="swatch air" />{view.air}</span>
        {sight && <span><i className="line sight" />Sight line from the lander to {view.the}</span>}
        <span>{exag === 1 ? "Drawn 1:1, no vertical exaggeration" : `Heights exaggerated ×${exag}${longView ? " in this long view" : ""}; printed angles are real`}{sec?.curvature ? " · Moon's curve included" : ""}</span>
      </div>
      <p className="muted small">Sun and Earth symbols are schematic, not to scale. This slice only models blockers along the profile; terrain outside it can also cast shadows.</p>

      <div className="profile-stats">
        <PlanView bearing={shown} sunAz={now ? targetAz : undefined} sunUp={seen ? seen.state !== "hidden" : (targetAlt ?? 0) > 0} color={view.color} />
        {!expert ? (
          <div className="stats">
            <Stat label={body === "sun" ? "Landing spot" : "Call home?"} value={skyWords.value} sub={skyWords.sub} />
            <Stat label={`Next ${body === "sun" ? "sunrise or sunset" : "Earthrise or Earthset"}`} value={nextValue} sub={nextSub} />
            <Stat label="Where the Sun is" value={now ? (sunShines ? `Low in the ${compass(now.sun_az)}` : "Below the horizon") : "…"}
              sub={now ? `${aboveBelow(now.sun_alt)}${now.sun_alt > 0 && now.sun_alt < 3 ? ": barely up, like sunrise" : now.sun_alt <= 0 && sunShines ? ": still in view from this high ground" : ""}` : undefined} />
            <Stat label="Shadows point" value={now && sunShines ? compass(now.sun_az + 180) : "—"} />
            <Stat label={body === "sun" ? "This slice in shadow" : "This slice cut off from Earth"} value={shadePct != null ? `${shadePct}%` : "…"}
              sub="from ground on this slice only" />
            <Stat label="Moment" value={now ? `Day ${dayN.toFixed(1)} of ${LUNAR_DAY_DAYS}` : "…"} sub="one lunar day ≈ 29.5 Earth days" />
          </div>
        ) : (
        <div className="stats">
          <Stat label={body === "sun" ? "Landing spot" : "Earth contact at the lander"} value={skyWords.value} sub={skyWords.sub} />
          <Stat label={`${view.name} above skyline`} value={seen ? signed(seen.margin) : sky.error ? "—" : "…"}
            sub={seen && targetAlt != null ? `${view.name} ${signed(targetAlt)}, skyline ${signed(seen.horizon)} toward ${targetAz.toFixed(0)}°; disc radius ${DISC_RADIUS[body]}°` : sky.error ? "skyline not loaded" : undefined} />
          <Stat label={`Next ${body === "sun" ? "sunrise / sunset" : "Earthrise / Earthset"}`} value={nextValue} sub={nextSub} />
          <Stat label="Sun elevation" value={now ? `${now.sun_alt.toFixed(1)}°` : "…"} sub={override ? "manual override" : "geometric, at the slider time"} />
          <Stat label="Shadow azimuth" value={now && sunShines ? `${((now.sun_az + 180) % 360).toFixed(0)}° (${compass(now.sun_az + 180)})` : "—"} sub={now && now.sun_alt > 0 ? `1 m rock → ${(1 / Math.tan((now.sun_alt * Math.PI) / 180)).toFixed(0)} m shadow` : undefined} />
          <Stat label="Sun azimuth" value={now ? `${now.sun_az.toFixed(0)}° (${compass(now.sun_az)})` : "…"} />
          <Stat label="Apparent angle in slice" value={light ? (Number.isFinite(light.tanA) ? `${light.apparent.toFixed(1)}°` : "square to the slice") : "…"}
            sub={light ? `${view.name} is ${light.off.toFixed(1)}° off the slice line` : undefined} />
          <Stat label={view.pct} value={shadePct != null ? `${shadePct}%` : "…"} sub="from ground on this slice only" />
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
      {skyline && (
        <div className="profile-source">
          Answer for the lander: {skyline.synthetic ? "synthetic terrain model (no measured terrain was available)" : `rays traced in every direction through ${skyline.source}, out to ${skyline.reach_km.toFixed(0)} km or to the edge of the terrain data, from ${skyline.observer_m} m above the ground`}
          {skyline.synthetic && skyline.note ? `. ${skyline.note}` : ""}. The colours on the slice show only shadows cast by ground on this slice.
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

        <label>Slice reach</label>
        <div className="tabs" role="group" aria-label="How far the slice reaches each way from the lander">
          {LENGTH_PRESETS.map((km) => (
            <button key={km} className={lengthKm === km ? "active" : ""} aria-pressed={lengthKm === km} onClick={() => pickLength(km)}>{km} km</button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>each way from the lander</span>
        </div>

        {expert && <>
        <label htmlFor="b">Slice direction</label>
        <div className="ctl">
          <label className="follow">
            <input type="checkbox" checked={followSun} onChange={(e) => { setFollowSun(e.target.checked); setBearing(bearing); }} />
            Follow the {body === "sun" ? "Sun" : "Earth"}
          </label>
          <input id="b" type="range" min={0} max={360 - STATE_STEP} step={STATE_STEP} value={bearing} disabled={followSun}
            onChange={(e) => setBearing(+e.target.value)} />
          <output>{compass(bearing + 180)} to {compass(bearing)}, {bearing}°</output>
        </div>

        <label htmlFor="l">Slice length</label>
        <div className="ctl">
          <input id="l" type="range" min={2} max={MAX_KM} value={lengthKm} onChange={(e) => pickLength(+e.target.value)} />
          <output>{2 * lengthKm} km across</output>
        </div>
        </>}

        {(expert || longView) && <>
        <label>Height scale</label>
        <div className="tabs">
          {EXAG_STEPS.map((e) => (
            <button key={e} className={exag === e ? "active" : ""} aria-pressed={exag === e} onClick={() => setExagPick(e)}>{e === 1 ? "1:1" : `×${e}`}</button>
          ))}
          {exag !== 1 && <span className="muted small" style={{ alignSelf: "center" }}>heights stretched so the relief shows; printed angles are real</span>}
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
    return error ? { value: "—", sub: `The skyline could not be loaded (${error}), so there is no answer for the lander yet.` }
      : { value: "…", sub: "Tracing rays through the terrain…" };
  }
  const the = VIEW[body].the;
  const how = sky.synthetic ? "Synthetic model, not measured terrain" : "Ray traced through the terrain";
  const beside = seen.blockerKm != null && seen.blockerKm < BESIDE_LANDER_KM;
  const far = seen.blockerKm == null ? "below the skyline"
    : beside ? `behind the ground beside the lander, ${fmtDist(seen.blockerKm * 1000)} away. This close, the answer depends on how high the panels or antenna sit (2 m assumed)`
    : `behind terrain ${fmtDist(seen.blockerKm * 1000)} away`;
  const cut = beside ? " (ground beside the lander: depends on mast height, 2 m assumed)" : "";
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
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Top-down compass: the slice as an arrow, the Sun (or Earth) as a dot on its azimuth. */
function PlanView({ bearing, sunAz, sunUp, color = "var(--sun)" }: { bearing: number; sunAz?: number; sunUp: boolean; color?: string }) {
  const p = (az: number, r: number) => ({ x: r * Math.sin((az * Math.PI) / 180), y: -r * Math.cos((az * Math.PI) / 180) });
  const a = p(bearing, 62), b = p(bearing + 180, 62);
  const s = sunAz != null ? p(sunAz, 52) : null;
  return (
    <figure className="planview">
      <svg viewBox="-80 -92 160 172" width={150}>
        <text y={-78} textAnchor="middle" fontSize={13} fill="var(--text)">N</text>
        <circle r={68} fill="none" stroke="var(--line)" />
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
          </marker>
        </defs>
        <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke="var(--text)" strokeWidth={2} markerEnd="url(#arrow)" />
        {s && (
          <>
            <line x1={0} y1={0} x2={s.x} y2={s.y} stroke={color} strokeDasharray="3 3" />
            <circle cx={s.x} cy={s.y} r={7} fill={sunUp ? color : "none"} stroke={color} strokeWidth={2} />
          </>
        )}
      </svg>
      <figcaption>Plan view</figcaption>
    </figure>
  );
}
