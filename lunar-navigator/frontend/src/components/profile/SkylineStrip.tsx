// 360° skyline strip: the terrain skyline in every compass direction, with the Sun's and Earth's paths. Owner: LEAD.
//
// Stand at the lander and turn through a full circle. Left to right is the compass direction (north round to
// north); up and down is the angle above or below the lander's level. The grey shape is the ray-traced skyline
// (GET /terrain/skyline). On top are the paths of the Sun and of Earth over the lunar day the slider runs through.
// A body is in view where the centre of its disc is above the skyline at its azimuth: the same rule, the same
// skyline and the same interpolation as the panel's verdict (bodyView, nextCrossing in profileMath.ts).
//
// The cross-section slice explains one direction at true scale. This strip shows every direction and the whole
// lunar day at once, which piece of terrain causes each sunset, and lets the user aim the slice by clicking.
//
// Speed: everything except the two "now" markers and the two readout lines is memoised on things that do not
// change while the slider plays (skyline, series, body, slice direction, mode). The height never changes.
import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { compass } from "../../lib/geo";
import type { SeriesPoint, Skyline } from "../../types";
import { useExpert } from "../learn/ModeGate";
import { DISC_RADIUS, STATES, skylineAt, skylineDistAt, snap16 } from "./profileMath";
import type { Body } from "./profileMath";
import {
  BESIDE_LANDER_KM, angleRange, besideFlags, buildTrack, edgeFlags, flagAt, niceStep, norm360, skylineExtremes, stretches,
} from "./skylineStripMath";
import type { Stretch, Track, TrackEvent } from "./skylineStripMath";
import "./SkylineStrip.css";

export interface SkylineStripProps {
  skyline: Skyline | null; // ray-traced skyline at the lander (null while loading)
  series: SeriesPoint[]; // the lunar-day series the time slider moves through
  index: number; // current sample of `series`
  body: "sun" | "earth"; // which body the panel is looking at
  sliceAzimuth: number; // direction the A end of the slice points (deg clockwise from north)
  letter: string; // label of the slice ends: A and A′
  onPickAzimuth?: (azimuth: number) => void; // the user chose a direction on the strip
  onPickTime?: (index: number) => void; // the user chose a moment on a body's path
}

// ---------- layout (viewBox units; the viewBox is 1000 wide like the main drawing) ----------
const W = 1000;
const H = 204;
const PL = 40; // room for the angle labels
const PR = 12;
const PT = 20; // room for the slice letters
const PB = 26; // room for the compass labels
const PW = W - PL - PR;
const PH = H - PT - PB;
const RIGHT = W - PR;
const BOTTOM = H - PB;
const X_PER_DEG = PW / 360;
const X = (az: number) => PL + az * X_PER_DEG;

const MIN_TRUE_DISC = 2.2; // a disc is drawn to scale when its true radius is at least this many units
const MARKER_R = 3.2; // otherwise it is a marker of this radius
const HIT_PX = 10; // how near (screen px) the pointer must be to a path to pick a moment instead of a direction
const MAX_LABELS = 8; // rise / set labels on the drawing
const MAX_JUMPS = 6; // rise / set buttons under it
const COLOR: Record<Body, string> = { sun: "var(--sun)", earth: "var(--earth)" };
const WORDS = {
  sun: { name: "Sun", the: "the Sun", The: "The Sun", its: "the Sun's", line: "orange line" },
  earth: { name: "Earth", the: "Earth", The: "Earth", its: "Earth's", line: "blue loop" },
} as const;

const f1 = (v: number) => v.toFixed(1);
const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : km.toFixed(0));
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${fmtKm(m / 1000)} km`);
const signed = (d: number, digits = 1) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(digits)}°`;
const level = (d: number, digits = 1) => `${Math.abs(d).toFixed(digits)}° ${d >= 0 ? "above" : "below"} level`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const dir = (az: number) => `${norm360(Math.round(az)).toFixed(0)}° (${compass(az)})`;

interface Model {
  sky: Skyline;
  lo: number;
  hi: number;
  yPer: number; // viewBox units per degree of angle
  stretch: number; // how many times an angle is drawn larger than a direction
  Y: (alt: number) => number;
  ticks: number[];
  tracks: Record<Body, Track> | null;
  px: Record<Body, { x: Float32Array; y: Float32Array }> | null; // where every sample sits, for picking
  besideFlag: boolean[];
  edgeFlag: boolean[];
  beside: Stretch[];
  edge: Stretch[];
  ext: ReturnType<typeof skylineExtremes>;
  discR: Record<Body, number>; // radius drawn
  discTrue: Record<Body, boolean>; // drawn to its true angular size on the angle scale
}

function buildModel(sky: Skyline, series: SeriesPoint[]): Model {
  const { lo, hi } = angleRange(sky, series, DISC_RADIUS);
  const yPer = PH / (hi - lo);
  const Y = (alt: number) => PT + (hi - alt) * yPer;
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.abs(t) < 1e-9 ? 0 : t);
  const tracks = series.length ? { sun: buildTrack(series, sky.elev_deg, "sun"), earth: buildTrack(series, sky.elev_deg, "earth") } : null;
  const px = tracks ? {
    sun: { x: Float32Array.from(tracks.sun.az, X), y: Float32Array.from(tracks.sun.alt, Y) },
    earth: { x: Float32Array.from(tracks.earth.az, X), y: Float32Array.from(tracks.earth.alt, Y) },
  } : null;
  const besideFlag = besideFlags(sky), edgeFlag = sky.synthetic ? sky.elev_deg.map(() => false) : edgeFlags(sky);
  const trueR = { sun: DISC_RADIUS.sun * yPer, earth: DISC_RADIUS.earth * yPer };
  const discTrue = { sun: trueR.sun >= MIN_TRUE_DISC, earth: trueR.earth >= MIN_TRUE_DISC };
  return {
    sky, lo, hi, yPer, stretch: yPer / X_PER_DEG, Y, ticks, tracks, px, besideFlag, edgeFlag,
    beside: stretches(besideFlag), edge: stretches(edgeFlag), ext: skylineExtremes(sky.elev_deg),
    discR: { sun: discTrue.sun ? trueR.sun : MARKER_R, earth: discTrue.earth ? trueR.earth : MARKER_R }, discTrue,
  };
}

/** The skyline between two azimuths as "x,y" points: the ends, and every whole degree between them. */
function skylinePoints(elev: number[], Y: (alt: number) => number, from: number, to: number, lift = 0): string[] {
  const out: string[] = [];
  const put = (az: number) => out.push(`${X(az).toFixed(1)},${(Y(skylineAt(elev, az)) - lift).toFixed(1)}`);
  put(from);
  for (let a = Math.floor(from) + 1; a < to; a++) put(a);
  put(to);
  return out;
}

const runsPath = (t: Track, visible: boolean, Y: (alt: number) => number) =>
  t.runs.filter((r) => r.visible === visible && r.az.length > 1)
    .map((r) => `M${r.az.map((a, i) => `${X(a).toFixed(1)},${Y(r.alt[i]).toFixed(1)}`).join(" L")}`).join(" ");

interface Placed { e: TrackEvent; x: number; y: number; text: string; label: { x: number; y: number; anchor: "start" | "end" } | null }

/** Where each rise / set label goes: beside its tick, wherever it fits without covering another one. */
function placeEvents(events: TrackEvent[], Y: (alt: number) => number): Placed[] {
  const boxes: [number, number, number, number][] = events.map((e) => [X(e.az) - 3, Y(e.alt) - 7, X(e.az) + 3, Y(e.alt) + 7]);
  const spots: { dx: number; dy: number; anchor: "start" | "end" }[] = [];
  for (const dy of [-9, 17, -22, 30, -35]) spots.push({ dx: 6, dy, anchor: "start" }, { dx: -6, dy, anchor: "end" });
  let labelled = 0;
  return events.map((e, k) => {
    const x = X(e.az), y = Y(e.alt);
    const text = `${e.rising ? "rises" : "sets"} day ${f1(e.day)}`;
    const w = text.length * 5.7 + 4;
    let label: Placed["label"] = null;
    if (labelled < MAX_LABELS) {
      for (const s of spots) {
        const tx = x + s.dx, ty = y + s.dy;
        const x0 = s.anchor === "start" ? tx : tx - w, x1 = x0 + w, y0 = ty - 10, y1 = ty + 3;
        if (x0 < PL + 1 || x1 > RIGHT - 1 || y0 < PT + 1 || y1 > BOTTOM - 1) continue;
        if (boxes.some((b, i) => i !== k && x0 < b[2] + 2 && x1 > b[0] - 2 && y0 < b[3] + 1 && y1 > b[1] - 1)) continue;
        boxes.push([x0, y0, x1, y1]);
        label = { x: tx, y: ty, anchor: s.anchor };
        labelled++;
        break;
      }
    }
    return { e, x, y, text, label };
  });
}

interface Hover { az: number; hit: { body: Body; index: number } | null; key: boolean }

export default function SkylineStrip({ skyline, series, index, body, sliceAzimuth, letter, onPickAzimuth, onPickTime }: SkylineStripProps) {
  const expert = useExpert();
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // The panel passes new callbacks on every render: keep them out of the memoised layers.
  const pickAz = useRef(onPickAzimuth);
  pickAz.current = onPickAzimuth;
  const pickTime = useRef(onPickTime);
  pickTime.current = onPickTime;

  const model = useMemo(() => (skyline && skyline.elev_deg.length ? buildModel(skyline, series) : null), [skyline, series]);
  const other: Body = body === "sun" ? "earth" : "sun";
  const w = WORDS[body];

  // ---------- layers that do not depend on the slider ----------

  const axes = useMemo(() => {
    const majors = [0, 90, 180, 270, 360];
    const minors = [45, 135, 225, 315];
    return (
      <g>
        <rect x={PL} y={PT} width={PW} height={PH} className="skystrip-sky" />
        {[90, 180, 270].map((a) => <line key={a} x1={X(a)} x2={X(a)} y1={PT} y2={BOTTOM} className="skystrip-grid" />)}
        {model && model.ticks.filter((t) => t !== 0).map((t) => (
          <line key={t} x1={PL} x2={RIGHT} y1={model.Y(t)} y2={model.Y(t)} className="skystrip-grid" />
        ))}
        {model && model.ticks.map((t) => (
          <text key={t} x={PL - 5} y={model.Y(t) + 3.5} textAnchor="end" className="skystrip-tick">{t === 0 ? "0°" : signed(t, Number.isInteger(t) ? 0 : 1)}</text>
        ))}
        {majors.map((a) => (
          <g key={a}>
            <line x1={X(a)} x2={X(a)} y1={BOTTOM} y2={BOTTOM + 5} className="skystrip-axis" />
            <text x={a === 360 && expert ? W - 1 : X(a)} y={BOTTOM + 17} textAnchor={a === 360 && expert ? "end" : "middle"} className="skystrip-compass">
              {compass(a)}{expert && <tspan className="skystrip-compass-deg"> {a}°</tspan>}
            </text>
          </g>
        ))}
        {minors.map((a) => (
          <g key={a}>
            <line x1={X(a)} x2={X(a)} y1={BOTTOM} y2={BOTTOM + 3} className="skystrip-axis" />
            <text x={X(a)} y={BOTTOM + 16} textAnchor="middle" className="skystrip-compass is-minor">{compass(a)}{expert ? ` ${a}°` : ""}</text>
          </g>
        ))}
        <line x1={PL} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} className="skystrip-axis" />
      </g>
    );
  }, [model, expert]);

  const ground = useMemo(() => {
    if (!model) return null;
    const { sky, Y } = model;
    const line = skylinePoints(sky.elev_deg, Y, 0, 360);
    return (
      <g>
        <path d={`M${X(0)},${BOTTOM} L${line.join(" L")} L${X(360)},${BOTTOM} Z`} className="skystrip-ground" />
        <path d={`M${line.join(" L")}`} className="skystrip-skyline" />
        {/* ground beside the lander: the skyline here moves with the height of the eye */}
        {model.beside.map((s) => {
          const pts = skylinePoints(sky.elev_deg, Y, s.from, s.to);
          return (
            <g key={`b${s.from}`}>
              <path d={`M${X(s.from).toFixed(1)},${BOTTOM} L${pts.join(" L")} L${X(s.to).toFixed(1)},${BOTTOM} Z`} className="skystrip-beside" />
              <path d={`M${pts.join(" L")}`} className="skystrip-beside-line" />
            </g>
          );
        })}
        {/* the terrain data ends early: the real skyline could be higher than drawn */}
        {model.edge.map((s) => {
          const low = skylinePoints(sky.elev_deg, Y, s.from, s.to);
          const high = skylinePoints(sky.elev_deg, Y, s.from, s.to, 13).map((p) => {
            const [x, y] = p.split(",");
            return `${x},${Math.max(PT, +y).toFixed(1)}`;
          });
          return (
            <g key={`e${s.from}`}>
              <path d={`M${low.join(" L")} L${high.reverse().join(" L")} Z`} className="skystrip-edge" />
              <path d={`M${low.join(" L")}`} className="skystrip-edge-line" />
            </g>
          );
        })}
        {model.lo < 0 && model.hi > 0 && (() => {
          // the label goes at whichever end, and on whichever side of the line, keeps it clearest of the skyline
          const spanDeg = 52 / X_PER_DEG, halfDeg = 7 / model.yPer;
          let best = { right: true, above: true, clear: -1 };
          for (const right of [true, false]) for (const above of [true, false]) {
            const mid = above ? halfDeg : -halfDeg;
            let clear = Infinity;
            for (let a = 0; a <= spanDeg; a += 2) clear = Math.min(clear, Math.abs(skylineAt(sky.elev_deg, right ? 360 - a : a) - mid));
            if (clear > best.clear + 1e-9) best = { right, above, clear };
          }
          return (
            <>
              <line x1={PL} x2={RIGHT} y1={Y(0)} y2={Y(0)} className="skystrip-level" />
              <text x={best.right ? RIGHT - 4 : PL + 4} y={Y(0) + (best.above ? -4 : 12)} textAnchor={best.right ? "end" : "start"}
                className="skystrip-level-label skystrip-halo">level, 0°</text>
            </>
          );
        })()}
      </g>
    );
  }, [model]);

  const tracks = useMemo(() => {
    if (!model || !model.tracks) return null;
    const { Y } = model;
    const arrows: ReactNode[] = [];
    const t = model.tracks[body], p = model.px![body], n = t.az.length;
    // a few arrowheads on the active path show which way the body moves
    for (const q of [1 / 8, 3 / 8, 5 / 8, 7 / 8]) {
      const i = Math.floor(q * (n - 1)), j = Math.min(n - 1, i + 4);
      const dx = p.x[j] - p.x[i], dy = p.y[j] - p.y[i];
      if (j === i || Math.abs(dx) > PW / 2 || Math.hypot(dx, dy) < 0.5) continue;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      arrows.push(<path key={q} d="M-4,-3.6 L4,0 L-4,3.6 Z" transform={`translate(${p.x[i].toFixed(1)},${p.y[i].toFixed(1)}) rotate(${ang.toFixed(0)})`}
        fill={COLOR[body]} opacity={t.margin[i] > 0 ? 1 : 0.55} />);
    }
    return (
      <g>
        {[other, body].map((b) => (
          <g key={b} className={`skystrip-track${b === body ? " is-active" : ""}`} stroke={COLOR[b]} data-body={b}>
            <path d={runsPath(model.tracks![b], false, Y)} className="is-hidden" data-part="hidden" />
            <path d={runsPath(model.tracks![b], true, Y)} className="is-seen" data-part="seen" />
          </g>
        ))}
        {arrows}
      </g>
    );
  }, [model, body, other]);

  const placed = useMemo(() => (model && model.tracks ? placeEvents(model.tracks[body].events, model.Y) : []), [model, body]);
  const eventMarks = useMemo(() => (
    <g>
      {placed.map((p, i) => (
        <g key={i} className="skystrip-event" data-day={p.e.day.toFixed(2)} data-rising={p.e.rising}>
          <line x1={p.x} x2={p.x} y1={p.y - 6} y2={p.y + 6} />
          {p.label && <text x={p.label.x} y={p.label.y} textAnchor={p.label.anchor} className="skystrip-halo">{p.text}</text>}
        </g>
      ))}
    </g>
  ), [placed]);

  const slice = useMemo(() => {
    const a = norm360(sliceAzimuth), b = norm360(sliceAzimuth + 180);
    const mark = (az: number, text: string, cls: string) => (
      <g key={text + az} className={`skystrip-slice ${cls}`}>
        <line x1={X(az)} x2={X(az)} y1={PT - 3} y2={BOTTOM} />
        <text x={X(az)} y={PT - 6} textAnchor="middle">{text}</text>
      </g>
    );
    return (
      <g data-slice-az={a}>
        {mark(a, letter, "is-a")}
        {a === 0 && mark(360, letter, "is-a")}
        {mark(b, `${letter}′`, "is-prime")}
        {b === 0 && mark(360, `${letter}′`, "is-prime")}
      </g>
    );
  }, [sliceAzimuth, letter]);

  // ---------- pointer and keyboard ----------

  const locate = (clientX: number, clientY: number): Hover | null => {
    const svg = svgRef.current;
    if (!svg || !model) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width) return null;
    const k = W / r.width;
    const x = (clientX - r.left) * k, y = (clientY - r.top) * k;
    const az = Math.round(Math.min(360, Math.max(0, (x - PL) / X_PER_DEG)) * 10) / 10;
    let hit: Hover["hit"] = null;
    if (model.px) {
      const lim = HIT_PX * k;
      let best = lim * lim;
      for (const b of [body, other]) {
        const p = model.px[b];
        const bias = b === body ? 1 : 1.6; // the active path wins when both are about as near
        for (let i = 0; i < p.x.length; i++) {
          const dx = p.x[i] - x, dy = p.y[i] - y;
          const d2 = (dx * dx + dy * dy) * bias;
          if (d2 < best) { best = d2; hit = { body: b, index: i }; }
        }
      }
    }
    return { az, hit, key: false };
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const h = locate(e.clientX, e.clientY);
    setHover((old) => (h && old && !old.key && old.az === h.az && old.hit?.body === h.hit?.body && old.hit?.index === h.hit?.index ? old : h));
  };
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const h = locate(e.clientX, e.clientY);
    if (!h) return;
    if (h.hit) pickTime.current?.(h.hit.index);
    else pickAz.current?.(h.az >= 360 ? 0 : h.az);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!model) return;
    const cur = hover?.key ? hover.az : norm360(Math.round(sliceAzimuth));
    let next: number;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": next = cur + (e.shiftKey ? 10 : 1); break;
      case "ArrowLeft": case "ArrowDown": next = cur - (e.shiftKey ? 10 : 1); break;
      case "PageUp": next = cur + 45; break;
      case "PageDown": next = cur - 45; break;
      case "Home": next = 0; break;
      case "End": next = 359; break;
      case "Enter": case " ":
        e.preventDefault();
        pickAz.current?.(cur);
        setHover({ az: cur, hit: null, key: true });
        return;
      default: return;
    }
    e.preventDefault();
    setHover({ az: norm360(Math.round(next)), hit: null, key: true });
  };

  // ---------- words that do not depend on the slider ----------

  const facts = useMemo(() => {
    if (!model || !model.tracks) return null;
    const t = model.tracks;
    const whole = (b: Body) => (t[b].samplesInView === t[b].az.length ? "all" : t[b].samplesInView === 0 ? "none" : "some");
    const main = (b: Body) => {
      const W2 = WORDS[b];
      if (whole(b) === "all") return `${W2.The} stays above the skyline for all ${Math.round(t[b].totalHours)} hours of this lunar day`;
      if (whole(b) === "none") return `${W2.The} never clears the skyline in this lunar day`;
      return `${W2.The} is in view for ${Math.round(t[b].hoursInView)} of ${Math.round(t[b].totalHours)} hours of this lunar day`;
    };
    return { main, whole };
  }, [model]);

  const ariaLabel = !model ? "Skyline all around the lander: waiting for the skyline."
    : !facts ? "Skyline all around the lander. The Sun and Earth positions are not loaded yet."
    : `Skyline all around the lander${model.sky.synthetic ? " (from an invented model, not measured terrain)" : ""}. ${facts.main(body)}. ${facts.main(other)}. Arrow keys choose a direction, Enter aims the slice there.`;

  // One row under the drawing, always there: the rise and set moments as buttons (the keyboard's way to a moment),
  // each with the terrain that causes it.
  const jumps = useMemo(() => {
    if (!model) return <div className="skystrip-jumps"><span>Rise and set times appear here when the skyline is ready.</span></div>;
    if (!model.tracks) return <div className="skystrip-jumps"><span>Rise and set times appear here when the Sun and Earth positions are loaded.</span></div>;
    const tr = model.tracks[body], ev = tr.events, W2 = WORDS[body];
    if (!ev.length) {
      return (
        <div className="skystrip-jumps">
          <span>{tr.samplesInView > 0 ? `${W2.The} does not set in this lunar day: its path stays above the ground all the way.`
            : `${W2.The} does not rise in this lunar day: its path stays behind the ground all the way.`}</span>
        </div>
      );
    }
    return (
      <div className="skystrip-jumps">
        <span>Go to:</span>
        {ev.slice(0, MAX_JUMPS).map((e, i) => {
          const d = skylineDistAt(model.sky.dist_km, e.az);
          const what = d == null ? "the skyline" : d < BESIDE_LANDER_KM ? `the ground beside the lander, ${fmtDist(d * 1000)} away,` : `terrain ${fmtDist(d * 1000)} away`;
          return (
            <span key={i} className="skystrip-jump">
              <button type="button" onClick={() => pickTime.current?.(e.index)}>
                {W2.name} {e.rising ? "rises" : "sets"}, day {f1(e.day)}
              </button>
              {" "}{e.rising ? "over" : "behind"} {what} toward {expert ? dir(e.az) : compass(e.az)}
            </span>
          );
        })}
        {ev.length > MAX_JUMPS && <span>and {ev.length - MAX_JUMPS} more {ev.length - MAX_JUMPS === 1 ? "crossing" : "crossings"} of the skyline (ticks on the drawing)</span>}
      </div>
    );
  }, [model, body, expert]);

  const legend = useMemo(() => {
    const eye = model ? model.sky.observer_m : 2;
    return (
      <div className="skystrip-legend">
        <span><i className="skystrip-key" style={{ borderColor: "var(--sun)" }} />Sun's path</span>
        <span><i className="skystrip-key" style={{ borderColor: "var(--earth)" }} />Earth's path</span>
        <span><i className="skystrip-key is-dashed" />dashed: hidden behind the ground</span>
        <span><i className="skystrip-dot" /><i className="skystrip-dot is-hollow" />now: in view, hidden</span>
        <span><i className="skystrip-key is-slice" />{letter}, {letter}′: the two ends of the slice</span>
        <span><i className="skystrip-box is-beside" />lighter, dotted: the skyline is the ground beside the lander (under {BESIDE_LANDER_KM * 1000} m away), so it depends on how high the panels or antenna sit ({eye} m assumed){model && !model.beside.length ? "; none at this site" : ""}</span>
        {/* always laid out, so the strip keeps its height when the skyline arrives; shown only where it applies */}
        <span aria-hidden={!(model && model.edge.length > 0)} style={model && model.edge.length > 0 ? undefined : { visibility: "hidden" }}>
          <i className="skystrip-box is-edge" />the terrain data ends early in these directions (it stops at 80°S): the real skyline could be higher
        </span>
      </div>
    );
  }, [model, letter]);

  // The same sentences in every state, so the caption keeps its height when the skyline arrives.
  const caption = useMemo(() => {
    const st = model ? (model.stretch >= 10 ? model.stretch.toFixed(0) : model.stretch.toFixed(1)) : "…";
    const discs = !model ? "The Sun's and Earth's discs are drawn at their real size on the angle scale where that is large enough to see."
      : model.discTrue.sun && model.discTrue.earth ? `The Sun's and Earth's discs are drawn at their real size on the angle scale (radius ${DISC_RADIUS.sun}° and ${DISC_RADIUS.earth}°).`
      : model.discTrue.earth ? `Earth's disc is drawn at its real size on the angle scale (radius ${DISC_RADIUS.earth}°); the Sun's (${DISC_RADIUS.sun}°) would be too small to see, so its marker is enlarged.`
      : "The Sun and Earth markers are symbols: their real discs would be too small to see at this scale.";
    return (
      <p className="skystrip-caption">
        Left to right is every compass direction, north round to north. Up and down is the angle above or below the lander's level,
        stretched {st} times compared with the directions, so slopes look that much steeper than they are. {discs}
      </p>
    );
  }, [model]);

  const teach = useMemo(() => {
    if (body === "sun") {
      return "Grey is the ground the lander sees in each direction, and the orange line is the Sun's path over this lunar day. Where the orange line is above the grey ground, the lander is in sunlight; where it dips behind the ground, the lander is in the dark.";
    }
    return "Grey is the ground the lander sees in each direction, and the blue loop is Earth's path over this lunar day. Where the blue line is above the grey ground, the lander can talk to Earth directly; where it dips behind the ground, it needs a relay.";
  }, [body]);

  const numbers = useMemo(() => {
    if (!expert) return null;
    const t = model?.tracks ?? null;
    const hours = (b: Body) => (t ? `${WORDS[b].name} in view ${Math.round(t[b].hoursInView)} of ${Math.round(t[b].totalHours)} h (${pct(t[b].hoursInView, t[b].totalHours)}%)`
      : `${WORDS[b].name} in view … of … h`);
    return (
      <>
        <span>{hours("sun")}</span>
        <span>{hours("earth")}</span>
        {model ? <span>skyline from {signed(model.ext.min, 2)} toward {dir(model.ext.minAz)} to {signed(model.ext.max, 2)} toward {dir(model.ext.maxAz)}</span>
          : <span>skyline from …° toward …° to …° toward …°</span>}
        {model ? <span>angle scale {signed(model.lo)} to {signed(model.hi)}, stretched ×{model.stretch.toFixed(1)}</span> : <span>angle scale …° to …°, stretched ×…</span>}
        <span>ground beside the lander sets the skyline in {model ? model.besideFlag.filter(Boolean).length : "…"} of {model ? model.besideFlag.length : 360} directions</span>
        <span>terrain data ends early in {model ? model.edgeFlag.filter(Boolean).length : "…"} of {model ? model.edgeFlag.length : 360} directions</span>
        <span>eye {model ? model.sky.observer_m : "…"} m above the ground</span>
      </>
    );
  }, [expert, model]);

  // ---------- the two things that follow the slider: the "now" markers and the readout ----------

  const t = model?.tracks ?? null;
  const i = t && index >= 0 && index < t.sun.az.length ? index : -1;
  const markers = t && model && i >= 0 ? [other, body].map((b) => {
    const az = t[b].az[i], alt = t[b].alt[i], m = t[b].margin[i];
    const cx = X(az), cy = model.Y(alt), r = model.discR[b], seen = m > 0, active = b === body;
    const disc = (x: number, k: string) => (
      <circle key={k} cx={x} cy={cy} r={r} fill={seen ? COLOR[b] : "var(--panel)"} stroke={seen ? "var(--panel)" : COLOR[b]}
        strokeWidth={seen ? 1 : 1.8} />
    );
    return (
      <g key={b} className={`skystrip-now${active ? " is-active" : ""}`} data-body={b} data-seen={seen}>
        {active && <line x1={cx} x2={cx} y1={cy} y2={model.Y(alt - m)} stroke={COLOR[b]} />}
        {active && r < 6 && <circle cx={cx} cy={cy} r={r + 4} className="skystrip-now-ring" />}
        {disc(cx, "c")}
        {cx - r < PL && disc(cx + PW, "w")}
        {cx + r > RIGHT && disc(cx - PW, "w")}
      </g>
    );
  }) : null;

  // Next rise or set of the active body after the slider time. The text only changes when one is passed.
  const nextEvent = t && i >= 0 ? t[body].events.find((e) => e.day > t[body].day[i]) ?? null : null;

  let line1: string, line2: string;
  const hit = hover?.hit && t ? hover.hit : null;
  if (!model) {
    line1 = "Waiting for the skyline: rays are traced through the terrain in every direction around the lander.";
    line2 = "";
  } else if (hover) {
    const az = hit && t ? t[hit.body].az[hit.index] : hover.az;
    line1 = directionText(model, az, expert);
    if (hit && t) {
      const tr = t[hit.body], m = tr.margin[hit.index], hw = WORDS[hit.body];
      line2 = expert
        ? `${hw.name} on day ${f1(tr.day[hit.index])}: ${level(tr.alt[hit.index], 2)}, ${m > 0 ? "in view" : "hidden"} (${Math.abs(m).toFixed(2)}° ${m > 0 ? "above" : "below"} the skyline). Click to go to that moment.`
        : `${hw.name} on day ${f1(tr.day[hit.index])}: ${level(tr.alt[hit.index])}, ${m > 0 ? "in view" : "hidden behind the ground"}. Click to go to that moment.`;
    } else {
      const to = snap16(hover.az);
      line2 = `${hover.key ? "Press Enter" : "Click"} to aim the slice this way: ${letter} would point to ${to}° (${compass(to)}), the nearest of its ${STATES} directions.`;
    }
  } else if (!t || i < 0) {
    line1 = "The Sun and Earth positions are not loaded yet, so only the ground is drawn.";
    line2 = "Point at the strip to read a direction. Click to aim the slice there.";
  } else {
    const tr = t[body], m = tr.margin[i], az = tr.az[i];
    const d = skylineDistAt(model.sky.dist_km, az);
    const by = d == null ? "" : d < BESIDE_LANDER_KM ? `the ground beside the lander, ${fmtDist(d * 1000)} away` : `terrain ${fmtDist(d * 1000)} away`;
    line1 = expert
      ? `Now, day ${f1(tr.day[i])}: ${w.the} is toward ${dir(az)}, ${level(tr.alt[i], 2)} and ${Math.abs(m).toFixed(2)}° ${m > 0 ? "above" : "below"} the skyline${by ? ` (set by ${by})` : ""}.`
      : `Now, day ${f1(tr.day[i])}: ${w.the} is toward ${compass(az)} and ${m > 0 ? "above the ground there, so it is in view" : `hidden${by ? ` behind ${by}` : " behind the ground"}`}.`;
    line2 = "Point at the strip to read a direction. Click the ground or the sky to aim the slice there; click a path to go to that moment.";
  }

  const valueAz = norm360(Math.round(hover?.key ? hover.az : sliceAzimuth));
  const valueText = useMemo(() => (model ? directionText(model, valueAz, true) : undefined), [model, valueAz]);

  // hover marks: a hairline for a direction, a ring for a moment on a path
  let hoverMark: ReactNode = null;
  if (model && hover) {
    if (hit && model.px) {
      const p = model.px[hit.body];
      hoverMark = <circle cx={p.x[hit.index]} cy={p.y[hit.index]} r={7} className="skystrip-hover-ring" stroke={COLOR[hit.body]} />;
    } else {
      const hx = X(hover.az), hy = model.Y(skylineAt(model.sky.elev_deg, hover.az));
      hoverMark = (
        <g className="skystrip-hover-dir">
          <line x1={hx} x2={hx} y1={PT} y2={BOTTOM} />
          <circle cx={hx} cy={hy} r={3} />
        </g>
      );
    }
  }

  return (
    <div className="skystrip-root" data-state={!model ? "loading" : !t ? "no-series" : "ready"}>
      <div className="skystrip-head">
        <h4 className="skystrip-title">Skyline all around the lander</h4>
        <span className="skystrip-sub">the view from the lander, turned through a full circle</span>
        {model?.sky.synthetic && <span className="skystrip-flag">Invented model, not measured terrain</span>}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" className={`skystrip-svg${hit ? " is-time" : ""}`}
        role="slider" aria-orientation="horizontal" aria-label={ariaLabel} aria-busy={!model}
        aria-valuemin={0} aria-valuemax={359} aria-valuenow={valueAz} aria-valuetext={valueText}
        tabIndex={model ? 0 : -1} data-lo={model?.lo} data-hi={model?.hi}
        onPointerMove={onMove} onPointerLeave={() => setHover((h) => (h && h.key ? h : null))} onClick={onClick}
        onKeyDown={onKey} onBlur={() => setHover(null)}>
        <defs>
          <clipPath id={clipId}><rect x={PL} y={PT} width={PW} height={PH} /></clipPath>
        </defs>
        {axes}
        {ground}
        {slice}
        {tracks}
        {eventMarks}
        {!model && <text x={PL + PW / 2} y={PT + PH / 2 + 4} textAnchor="middle" className="skystrip-wait">Tracing the skyline around the lander…</text>}
        {model && !t && <text x={PL + PW / 2} y={PT + 14} textAnchor="middle" className="skystrip-wait skystrip-halo">Sun and Earth paths appear when their positions are loaded</text>}
        <g clipPath={`url(#${clipId})`}>{markers}</g>
        {hoverMark}
      </svg>

      <div className="skystrip-readout">
        <div className="skystrip-readout-main">{line1}</div>
        <div className="skystrip-readout-how">{line2}</div>
      </div>

      {legend}
      <p className="skystrip-words">{teach}</p>
      <p className="skystrip-fact">
        {facts ? `${facts.main(body)}.` : !model ? "The hours in view are counted when the skyline is ready." : "The hours in view are counted when the Sun and Earth positions are loaded."}
      </p>
      {model?.sky.synthetic && (
        <p className="skystrip-fact skystrip-flag">
          This skyline is from an invented model ({model.sky.source}), not from measured terrain.{model.sky.note ? ` ${model.sky.note}` : ""}
        </p>
      )}
      {jumps}
      {expert && (
        <div className="skystrip-numbers" style={{ minHeight: 49 }}>
          {numbers}
          <span>{!t || i < 0 ? `next ${w.name} rise or set: …`
            : nextEvent ? `next: ${w.name} ${nextEvent.rising ? "rises" : "sets"} on day ${nextEvent.day.toFixed(2)}`
            : `no ${w.name} rise or set after this moment in the slider's range`}</span>
        </div>
      )}
      {/* always laid out in expert mode, two lines high, so nothing moves when the skyline arrives */}
      {expert && (
        <p className="skystrip-caption" style={{ minHeight: 35 }}>
          {!model ? "Whether the terrain data ends early in any direction is checked when the skyline is ready."
            : model.sky.synthetic ? ""
            : model.edge.length > 0 ? (model.sky.note ?? "The terrain data ends early in some directions: the real skyline could be higher there.")
            : "Terrain data: no direction is cut short in a way that could raise the skyline, judged against the highest ground in the file."}
        </p>
      )}
      {caption}
    </div>
  );
}

/** "Toward 135° (SE): the skyline is 0.42° above level, set by terrain 3.2 km away." */
function directionText(model: Model, az: number, expert: boolean): string {
  const { sky } = model;
  const e = skylineAt(sky.elev_deg, az);
  const d = skylineDistAt(sky.dist_km, az);
  const by = d == null ? (sky.synthetic ? " (invented model, not measured terrain)" : "")
    : d < BESIDE_LANDER_KM ? `, set by the ground beside the lander ${fmtDist(d * 1000)} away, so it depends on mast height`
    : `, set by terrain ${fmtDist(d * 1000)} away`;
  let edge = "";
  if (flagAt(model.edgeFlag, az)) {
    const reach = sky.seen_km ? skylineDistAt(sky.seen_km, az) : null;
    edge = ` The terrain data ends ${reach != null ? `${fmtDist(reach * 1000)} out` : "early"} this way, so the real skyline could be higher.`;
  }
  return `Toward ${dir(az)}: the skyline is ${level(e, expert ? 2 : 1)}${by}.${edge}`;
}
