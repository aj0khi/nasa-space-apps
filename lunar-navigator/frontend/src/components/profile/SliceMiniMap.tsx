// Top-down mini-map: the slice line on the terrain, with the Sun's direction and the shadows. Owner: LEAD.
//
// The picture comes from GET /terrain/shadow-map: the real terrain around the site plus, for every pixel, how high
// a body must stand in each direction to be seen from there. Whether a pixel is in shadow is then one comparison,
// so the shadows follow the time slider without asking the server again.
// While the map is loading, or when it cannot be had (no measured terrain, server error), the plain compass the
// panel had before is shown in the same space.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { api } from "../../api/client";
import { compass } from "../../lib/geo";
import { useExpert } from "../learn/ModeGate";
import { bearingOf, fmtPixel, hiddenMask, parseRgb, scaleBarKm, unpack } from "./sliceMiniMapMath";
import type { MiniMap } from "./sliceMiniMapMath";
import "./SliceMiniMap.css";

export interface SliceMiniMapProps {
  loc: { lat: number; lon: number } | null;
  sliceAzimuth: number; // direction the A end of the slice points (deg clockwise from north)
  lengthKm: number; // reach of the slice each way from the lander
  letter: string; // label of the slice ends: A and A′
  body: "sun" | "earth";
  bodyAlt: number | null; // altitude of that body at the lander (deg above the lander's level), null if unknown
  bodyAz: number | null; // its azimuth (deg clockwise from north)
  bodyInView: boolean; // ray-traced answer for the lander
  observerM: number; // eye height used by the ray tracing (m)
  color: string; // CSS colour of the active body
  onPickAzimuth?: (azimuth: number) => void; // the user chose a slice direction on the map
}

const RES = 97; // odd, so the middle pixel sits exactly on the lander
const MIN_KM = 2, MAX_KM = 320; // what the endpoint accepts
const D2R = Math.PI / 180;

type Entry =
  | { state: "loading"; promise: Promise<void> }
  | { state: "ready"; m: MiniMap }
  | { state: "failed"; reason: string; at: number };

// Maps already fetched this session, by site, size and eye height: going back to a size is instant.
const maps = new Map<string, Entry>();

function reasonFor(err: unknown): string {
  const status = /(\d{3})\s*$/.exec(err instanceof Error ? err.message : "")?.[1];
  if (status === "422") return "No measured terrain for this place, so there is no shadow map.";
  if (status === "501") return "The shadow map is not available on this server.";
  if (status === "503") return "The terrain data could not be read, so there is no shadow map.";
  return "The shadow map could not be loaded.";
}

function load(key: string, loc: { lat: number; lon: number }, sizeKm: number, observerM: number): Entry {
  const hit = maps.get(key);
  // a failure is tried again after half a minute, never in a tight loop
  if (hit && !(hit.state === "failed" && Date.now() - hit.at > 30000)) return hit;
  const promise = api.shadowMap(loc, sizeKm, RES, observerM).then(
    (d) => { maps.set(key, { state: "ready", m: unpack(d) }); },
    (e) => { maps.set(key, { state: "failed", reason: reasonFor(e), at: Date.now() }); },
  ).catch(() => { maps.set(key, { state: "failed", reason: "The shadow map could not be read.", at: Date.now() }); });
  const entry: Entry = { state: "loading", promise };
  maps.set(key, entry);
  if (maps.size > 12) {
    const oldest = maps.keys().next();
    if (!oldest.done && oldest.value !== key) maps.delete(oldest.value);
  }
  return entry;
}

/** A point `r` units from the centre toward azimuth `az`, in a drawing where up is north. */
const polar = (az: number, r: number) => ({ x: r * Math.sin(az * D2R), y: -r * Math.cos(az * D2R) });

export default function SliceMiniMap({ loc, sliceAzimuth, lengthKm, letter, body, bodyAlt, bodyAz, bodyInView, observerM, color, onPickAzimuth }: SliceMiniMapProps) {
  const arrowId = useId();
  const expert = useExpert();
  const [, redraw] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const figRef = useRef<HTMLElement>(null);
  const reliefRef = useRef<HTMLCanvasElement>(null);
  const shadeRef = useRef<HTMLCanvasElement>(null);
  const work = useRef<{ hidden: Uint8Array; image: ImageData } | null>(null);

  // The slice exactly spans the map: twice its reach, within what the endpoint accepts.
  const sizeKm = Math.round(Math.min(MAX_KM, Math.max(MIN_KM, 2 * lengthKm)) * 100) / 100;
  const key = loc ? `${loc.lat},${loc.lon},${sizeKm},${RES},${observerM}` : "";
  const entry = key ? maps.get(key) : undefined;
  const m = entry?.state === "ready" ? entry.m : null;

  useEffect(() => {
    if (!key || !loc) return;
    const e = load(key, loc, sizeKm, observerM);
    if (e.state !== "loading") { redraw((n) => n + 1); return; }
    let live = true;
    e.promise.then(() => { if (live) redraw((n) => n + 1); });
    return () => { live = false; };
    // the key holds the site, the size and the eye height
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Relief: drawn once per map. The light is fixed (north-west), it only shows the shape of the ground.
  useLayoutEffect(() => {
    const cv = reliefRef.current;
    if (!cv || !m) return;
    cv.width = cv.height = m.res;
    const image = new ImageData(m.res, m.res);
    image.data.set(m.relief);
    cv.getContext("2d")?.putImageData(image, 0, 0);
  }, [m]);

  // Shadows: the only layer recomputed when the body moves.
  useLayoutEffect(() => {
    const cv = shadeRef.current, fig = figRef.current;
    if (!cv || !m) { if (fig) fig.dataset.centre = ""; return; }
    const t0 = performance.now();
    if (cv.width !== m.res) cv.width = cv.height = m.res;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const n = m.res * m.res;
    if (!work.current || work.current.hidden.length !== n) work.current = { hidden: new Uint8Array(n), image: new ImageData(m.res, m.res) };
    const { hidden, image } = work.current;
    const px = image.data;
    if (bodyAlt == null || bodyAz == null) {
      px.fill(0); // position unknown: no shadow layer at all
      ctx.putImageData(image, 0, 0);
      if (fig) { fig.dataset.centre = ""; fig.dataset.hidden = ""; }
      return;
    }
    const count = hiddenMask(m, bodyAlt, bodyAz, hidden);
    cv.style.color = color; // lets the browser turn "var(--sun)" into numbers
    const [r, g, b] = parseRgb(getComputedStyle(cv).color) ?? [232, 163, 61];
    const relief = m.relief;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (relief[j + 3] === 0) { px[j + 3] = 0; continue; } // no terrain there
      if (hidden[i]) { px[j] = 4; px[j + 1] = 8; px[j + 2] = 20; px[j + 3] = 196; }
      else { px[j] = r; px[j + 1] = g; px[j + 2] = b; px[j + 3] = 40; }
    }
    ctx.putImageData(image, 0, 0);
    if (fig) {
      const mid = (m.res >> 1) * m.res + (m.res >> 1);
      fig.dataset.centre = hidden[mid] ? "hidden" : "seen"; // the pixel under the lander, for checks
      fig.dataset.hidden = (count / n).toFixed(3);
      fig.dataset.drawMs = (performance.now() - t0).toFixed(2);
    }
  }, [m, bodyAlt, bodyAz, color]);

  const bearingFromEvent = (e: MouseEvent<HTMLDivElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const east = e.clientX - box.left - box.width / 2, north = box.height / 2 - (e.clientY - box.top);
    return Math.hypot(east, north) < 4 ? null : bearingOf(east, north);
  };

  // ---------- drawing on top of the map (100 units = half the map) ----------
  const reach = Math.min(100, (lengthKm / (sizeKm / 2)) * 100);
  const a = polar(sliceAzimuth, reach), a2 = polar(sliceAzimuth + 180, reach);
  // the letters sit just inside the ends, beside the line
  // (an end that points at the Sun or Earth mark steps aside, so the letter is not drawn under the mark)
  const nearBody = (az: number) => bodyAz != null && Math.abs(((az - bodyAz + 540) % 360) - 180) < 25;
  const endAt = (az: number) => {
    const near = nearBody(az), along = polar(az, reach - (near ? 17 : 13)), off = polar(sliceAzimuth + 90, near ? 15 : 9);
    return { x: along.x + off.x, y: along.y + off.y + 4 };
  };
  const la = endAt(sliceAzimuth), la2 = endAt(sliceAzimuth + 180);
  const sun = bodyAz != null ? (() => {
    const s = Math.sin(bodyAz * D2R), c = -Math.cos(bodyAz * D2R);
    const edge = 91 / Math.max(Math.abs(s), Math.abs(c)); // where that direction meets the frame
    const tip = { x: s * edge, y: c * edge }, tail = { x: s * (edge - 17), y: c * (edge - 17) };
    const label = { x: s * (edge - 30), y: c * (edge - 30) };
    return { tip, tail, label, deg: bodyAz };
  })() : null;
  const barKm = scaleBarKm(sizeKm);
  const barLen = (barKm / sizeKm) * 200;
  const name = body === "sun" ? "Sun" : "Earth";
  const the = body === "sun" ? "the Sun" : "Earth";
  const hoverEnd = hover != null ? polar(hover, 96) : null;

  // ---------- words ----------
  const pixel = m ? fmtPixel(m.pixelM) : "";
  const step = m ? `${m.map.az_step_deg}°` : "";
  let caption: string;
  let extra: string | null = null;
  if (!loc) caption = "Plan view. Choose a landing site to see the map.";
  else if (!m) {
    caption = !entry || entry.state === "loading"
      ? "Plan view while the map loads: the slice and the direction of " + the + ". The map of real shadows takes up to half a minute the first time."
      : `Plan view only: the slice and the direction of ${the}. ${entry.state === "failed" ? entry.reason : ""}`;
  } else {
    const what = bodyAlt == null || bodyAz == null ? `Top-down view of the real terrain. The ${body === "sun" ? "shadows appear" : "view of Earth appears"} once the position of ${the} is known.`
      : body === "sun" ? `Shadows at this moment, ray traced on the real terrain, seen from ${observerM} m above each point. Dark means the centre of the Sun is hidden there.`
      : `Dark means no line of sight to Earth at this moment from ${observerM} m above that point, ray traced on the real terrain.`;
    caption = `${what} The dot is the lander, filled when it sees ${the}. The grey relief shading is only for shape. Each pixel is ${pixel} wide and directions are taken every ${step}, so narrow ${body === "sun" ? "shadows" : "gaps"} are averaged.`;
    if (m.map.note) caption += ` ${m.map.note}`;
    if (expert) extra = `Map ${m.map.size_km} km across, ${m.res} × ${m.res} pixels of ${pixel}. Horizon per pixel every ${step}, stored to ${m.map.horizon_scale}°, in the lander's level frame. ${m.map.source}.`;
  }
  const status = !loc ? null : m ? null : !entry || entry.state === "loading" ? "loading the map..." : entry.state === "failed" ? "no shadow map here" : null;
  const label = m
    ? `Top-down map ${m.map.size_km} km across, north up. Slice from ${letter}′ toward ${sliceAzimuth}° to ${letter}. ${bodyAz != null ? `${name} toward ${bodyAz.toFixed(0)}°. ` : ""}The lander ${bodyInView ? "sees" : "does not see"} ${the}.`
    : `Plan view, north up. Slice toward ${sliceAzimuth}°.${bodyAz != null ? ` ${name} toward ${bodyAz.toFixed(0)}°.` : ""}`;

  return (
    <figure className={`minimap${expert ? " minimap-expert" : ""}`} ref={figRef} data-state={m ? "ready" : entry?.state === "failed" ? "failed" : "loading"}>
      <div className={`minimap-frame${onPickAzimuth ? " minimap-pick" : ""}`} role="img" aria-label={label}
        onClick={(e) => { const b = bearingFromEvent(e); if (b != null && onPickAzimuth) onPickAzimuth(b); }}
        onMouseMove={(e) => setHover(bearingFromEvent(e))} onMouseLeave={() => setHover(null)}>
        {m ? (
          <>
            <canvas ref={reliefRef} className="minimap-layer" />
            <canvas ref={shadeRef} className="minimap-layer" />
            <svg className="minimap-layer" viewBox="-100 -100 200 200" aria-hidden="true">
              <defs>
                <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
                </marker>
              </defs>
              {/* the slice, A′ to A, with a dark edge so it reads on lit and on dark ground */}
              <line x1={a2.x} y1={a2.y} x2={a.x} y2={a.y} className="minimap-halo" strokeWidth={4.2} />
              <line x1={a2.x} y1={a2.y} x2={a.x} y2={a.y} stroke="var(--text)" strokeWidth={1.8} markerEnd={`url(#${arrowId})`} />
              <text x={la.x} y={la.y} textAnchor="middle" className="minimap-text minimap-end">{letter}</text>
              <text x={la2.x} y={la2.y} textAnchor="middle" className="minimap-text minimap-end">{letter}′</text>
              {/* toward the Sun or Earth */}
              {sun && (
                <g>
                  <line x1={0} y1={0} x2={sun.tail.x} y2={sun.tail.y} stroke={color} strokeWidth={1.2} strokeDasharray="3 3" strokeOpacity={0.9} />
                  <g transform={`translate(${sun.tip.x} ${sun.tip.y}) rotate(${sun.deg})`}>
                    <path d="M0,-8 L6.5,6 L0,2.5 L-6.5,6 z" className="minimap-halo" strokeWidth={3} fill="none" />
                    <path d="M0,-8 L6.5,6 L0,2.5 L-6.5,6 z" fill={color} />
                  </g>
                  <text x={sun.label.x} y={sun.label.y + 4} textAnchor="middle" className="minimap-text" style={{ fill: color }}>{name}</text>
                </g>
              )}
              {/* the lander */}
              <circle r={6.2} className="minimap-halo-fill" />
              <circle r={4.6} fill={bodyInView ? color : "var(--panel)"} stroke={color} strokeWidth={1.8} />
              {/* pointer: where a click would aim the slice */}
              {hoverEnd && onPickAzimuth && <line x1={0} y1={0} x2={hoverEnd.x} y2={hoverEnd.y} stroke="var(--text)" strokeWidth={0.8} strokeOpacity={0.55} />}
              {/* north mark and scale bar */}
              <g transform="translate(-88 -80)">
                <path d="M0,-14 L4.5,-3 L0,-5.5 L-4.5,-3 z" fill="var(--text)" className="minimap-outline" />
                <text y={9} textAnchor="middle" className="minimap-text">N</text>
              </g>
              <g transform="translate(-93 90)">
                <path d={`M0,-3 V0 H${barLen.toFixed(1)} V-3`} className="minimap-halo" strokeWidth={3.6} fill="none" />
                <path d={`M0,-3 V0 H${barLen.toFixed(1)} V-3`} stroke="var(--text)" strokeWidth={1.4} fill="none" />
                <text x={barLen / 2} y={-6} textAnchor="middle" className="minimap-text">{barKm} km</text>
              </g>
            </svg>
          </>
        ) : (
          // The plan-view compass the panel had before the map: kept as the stand-in while loading or without terrain.
          <svg className="minimap-layer" viewBox="-100 -100 200 200" aria-hidden="true">
            <text y={-80} textAnchor="middle" fontSize={13} fill="var(--text)">N</text>
            <circle r={68} fill="none" stroke="var(--line)" />
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
              </marker>
            </defs>
            {(() => {
              const p = polar(sliceAzimuth, 62), q = polar(sliceAzimuth + 180, 62);
              const s = bodyAz != null ? polar(bodyAz, 52) : null;
              const ends = [polar(sliceAzimuth, 76), polar(sliceAzimuth + 180, 76)];
              return (
                <>
                  <line x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke="var(--text)" strokeWidth={2} markerEnd={`url(#${arrowId})`} />
                  {Math.abs(Math.cos(sliceAzimuth * D2R)) < 0.96 && ends.map((t, i) => (
                    <text key={i} x={t.x} y={t.y + 4} textAnchor="middle" fontSize={11} fill="var(--muted)">{i ? `${letter}′` : letter}</text>
                  ))}
                  {s && (
                    <>
                      <line x1={0} y1={0} x2={s.x} y2={s.y} stroke={color} strokeDasharray="3 3" />
                      <circle cx={s.x} cy={s.y} r={7} fill={bodyInView ? color : "none"} stroke={color} strokeWidth={2} />
                    </>
                  )}
                  {hoverEnd && onPickAzimuth && <line x1={0} y1={0} x2={hoverEnd.x * 0.7} y2={hoverEnd.y * 0.7} stroke="var(--text)" strokeWidth={0.8} strokeOpacity={0.45} />}
                </>
              );
            })()}
          </svg>
        )}
        {status && <span className="minimap-status">{status}</span>}
        {hover != null && (
          <span className="minimap-readout">{onPickAzimuth ? `Click: slice toward ${hover}° (${compass(hover)})` : `${hover}° (${compass(hover)})`}</span>
        )}
      </div>
      <figcaption className="minimap-caption">
        {caption}
        {extra && <span className="minimap-extra"> {extra}</span>}
      </figcaption>
    </figure>
  );
}
