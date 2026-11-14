// Main interactive map of the lunar south pole (polar stereographic, top-down). Owner: MAP.
// The ground is a shaded-relief image lit by the real Sun at the chosen time (from /api/illumination/polar).
// Scroll to zoom, drag to pan, click a marker to select a site, click the ground to select any point.
import { useMemo, useRef, useState } from "react";
import { project, ringRadius, unproject } from "../../lib/geo";
import { STATUS_UI } from "../rail/LandingList";
import { normLon } from "../../state/store";
import type { EvalSite, Features, Illumination } from "../../types";

interface Props {
  sites: EvalSite[]; // A–H from the evaluation engine (GET /api/sites): status + lit right now
  features: Features | null;
  illum: Illumination | null;
  selectedId: string | null;
  custom: { lat: number; lon: number } | null;
  minLat: number; // outer edge of the map, e.g. -80
  onSelect: (id: string) => void;
  onPick: (lat: number, lon: number) => void;
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

const COLOR = { green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)" };

/** Decode the backend's byte grid into a PNG: warm for sunlit ground, cold blue for shadow. */
function illumToDataUrl(a: Illumination): string {
  const bin = atob(a.data);
  const n = a.res;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const b = bin.charCodeAt(i);
    const k = i * 4;
    if (b === 255) { img.data[k + 3] = 0; continue; }
    const v = b & 127;
    if (b & 128) {
      const g = 55 + v * 1.55; // sunlit
      img.data[k] = Math.min(255, g * 1.08); img.data[k + 1] = g; img.data[k + 2] = g * 0.84;
    } else {
      const g = v * 2.4; // shadow: dim, cold
      img.data[k] = g * 0.55; img.data[k + 1] = g * 0.68; img.data[k + 2] = 18 + g;
    }
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export default function SouthPoleMap(props: Props) {
  const { sites, features, illum, selectedId, custom, minLat, onSelect, onPick, onCursor } = props;
  const outer = ringRadius(minLat);
  const home = { cx: 0, cy: 0, half: outer * 1.16 };
  const [view, setView] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const lastMin = useRef(minLat);
  if (lastMin.current !== minLat) {
    lastMin.current = minLat;
    setView(home);
  }

  const imgUrl = useMemo(() => (illum ? illumToDataUrl(illum) : null), [illum]);
  const u = view.half / 300; // one "screen unit" in km, keeps labels/markers a constant size on screen

  const toKm = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const s = (2 * view.half) / Math.min(r.width, r.height);
    return { x: view.cx + (clientX - r.left - r.width / 2) * s, y: view.cy + (clientY - r.top - r.height / 2) * s };
  };

  const rings = useMemo(() => [-89, -88, -87, -86, -85, -84, -82, -80, -75, -70, -65].filter((l) => l <= minLat), [minLat]);
  const shown = sites.filter((s) => s.coordinates.lat <= minLat);

  // Sun & Earth sit on the horizon around the pole, in the direction of their sub-points
  const body = (lon: number, extra: number) => {
    const a = (lon * Math.PI) / 180;
    const r = outer + extra;
    return { x: r * Math.sin(a), y: -r * Math.cos(a), a };
  };
  const sun = illum && body(illum.sun.subsolar_lon, 30 * u);
  const earth = illum && body(illum.earth.sub_lon, 30 * u);

  return (
    <div className="polemap">
      <svg
        ref={svg}
        viewBox={`${view.cx - view.half} ${view.cy - view.half} ${2 * view.half} ${2 * view.half}`}
        onWheel={(e) => {
          const p = toKm(e.clientX, e.clientY);
          const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
          const half = Math.min(outer * 1.5, Math.max(8, view.half * f));
          const k = half / view.half;
          setView({ half, cx: p.x - (p.x - view.cx) * k, cy: p.y - (p.y - view.cy) * k });
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false }; }}
        onPointerMove={(e) => {
          const p = toKm(e.clientX, e.clientY);
          const ll = unproject(p.x, p.y);
          onCursor(ll.lat <= minLat ? ll : null);
          const d = drag.current;
          if (!d) return;
          const r = svg.current!.getBoundingClientRect();
          const s = (2 * view.half) / Math.min(r.width, r.height);
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.x) * s, cy: d.cy - (e.clientY - d.y) * s }));
        }}
        onPointerLeave={() => { drag.current = null; onCursor(null); }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && (e.target as Element).getAttribute("data-ground")) {
            const p = toKm(e.clientX, e.clientY);
            const ll = unproject(p.x, p.y);
            if (ll.lat <= minLat) onPick(ll.lat, ll.lon);
          }
        }}
      >
        <rect data-ground="1" x={-outer * 3} y={-outer * 3} width={outer * 6} height={outer * 6} fill="var(--map-bg)" />
        <circle data-ground="1" r={outer} fill="#1b1e26" />
        {imgUrl && illum && (
          <image data-ground="1" href={imgUrl} x={-illum.half_km} y={-illum.half_km}
            width={2 * illum.half_km} height={2 * illum.half_km} preserveAspectRatio="none" />
        )}

        {/* sunlight direction: faint parallel rays crossing the map from the Sun's side */}
        {sun && (
          <g pointerEvents="none" stroke="var(--sun)" strokeOpacity={0.22} strokeWidth={1 * u}>
            {[-0.6, -0.3, 0, 0.3, 0.6].map((o) => {
              const px = -Math.cos(sun.a) * o * outer, py = -Math.sin(sun.a) * o * outer; // offset across
              const sx = Math.sin(sun.a) * outer * 1.02, sy = -Math.cos(sun.a) * outer * 1.02;
              return <line key={o} x1={px + sx} y1={py + sy} x2={px + sx * 0.72} y2={py + sy * 0.72} />;
            })}
          </g>
        )}

        {/* crater outlines & names (terrain itself is in the image) */}
        {features?.craters.filter((c) => c.lat <= minLat).map((c) => {
          const p = project(c.lat, c.lon);
          return (
            <g key={c.name} pointerEvents="none">
              <circle cx={p.x} cy={p.y} r={c.diameter_km / 2} fill="none" stroke="#fff" strokeOpacity={0.35}
                strokeWidth={1 * u} strokeDasharray={c.psr ? `${3 * u} ${2.5 * u}` : undefined} />
              <text x={p.x} y={p.y + c.diameter_km / 2 + 9 * u} fontSize={8.5 * u} fill="#d5d8de" textAnchor="middle"
                paintOrder="stroke" stroke="#000" strokeWidth={2 * u} strokeOpacity={0.6}>{c.name}</text>
            </g>
          );
        })}

        <g pointerEvents="none" stroke="#fff" strokeOpacity={0.08} fill="none" strokeWidth={0.8 * u}>
          {rings.map((lat) => <circle key={lat} r={ringRadius(lat)} />)}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((lon) => {
            const p = project(minLat, lon);
            return <line key={lon} x1={0} y1={0} x2={p.x} y2={p.y} />;
          })}
        </g>
        <g pointerEvents="none" fill="#9aa1ad" fontSize={7.5 * u}>
          {rings.map((lat) => <text key={lat} x={2 * u} y={-ringRadius(lat) - 2 * u}>{Math.abs(lat)}°S</text>)}
        </g>

        {/* Sun and Earth on the horizon */}
        {sun && illum && (
          <g transform={`translate(${sun.x},${sun.y})`} pointerEvents="none" opacity={illum.sun.elevation_at_pole > -2 ? 1 : 0.55}>
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={Math.cos(a) * 13 * u} y1={Math.sin(a) * 13 * u} x2={Math.cos(a) * 18 * u} y2={Math.sin(a) * 18 * u}
                stroke="var(--sun)" strokeWidth={2 * u} strokeLinecap="round" />;
            })}
            <circle r={10 * u} fill="var(--sun)" />
            <text y={30 * u} fontSize={9 * u} fill="var(--sun)" textAnchor="middle" paintOrder="stroke" stroke="#000" strokeWidth={2 * u}>
              Sun {illum.sun.elevation_at_pole >= 0 ? "+" : ""}{illum.sun.elevation_at_pole.toFixed(1)}°
            </text>
          </g>
        )}
        {earth && illum && (
          <g transform={`translate(${earth.x},${earth.y})`} pointerEvents="none">
            <circle r={7 * u} fill="var(--earth)" stroke="#cfe3ff" strokeWidth={1 * u} />
            <text y={19 * u} fontSize={8 * u} fill="var(--earth)" textAnchor="middle" paintOrder="stroke" stroke="#000" strokeWidth={2 * u}>
              Earth
            </text>
          </g>
        )}

        {/* sites: square crosshair markers with their letter; filled with sunlight when lit right now */}
        {shown.map((s) => {
          const p = project(s.coordinates.lat, normLon(s.coordinates.lon));
          const ui = STATUS_UI[s.status];
          const col = COLOR[ui.cls];
          const lit = s.is_sunlit;
          const sel = s.id === selectedId;
          const h = 6 * u;
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`} className="marker"
              onPointerUp={(e) => { if (!drag.current?.moved) { e.stopPropagation(); drag.current = null; onSelect(s.id); } }}>
              <title>{`${s.id}: ${s.name} · ${ui.word} · ${lit ? "in sunlight" : "in shadow"} · ${s.has_earth_comm ? "Earth in view" : "no Earth contact"}`}</title>
              {lit && <circle r={12 * u} fill="var(--sun)" opacity={0.28} />}
              {sel && <circle r={14 * u} fill="none" stroke="#fff" strokeWidth={1.6 * u} />}
              <rect x={-h} y={-h} width={2 * h} height={2 * h} fill={lit ? "rgba(232,163,61,0.55)" : "rgba(8,10,16,0.85)"}
                stroke={col} strokeWidth={1.8 * u} />
              <path d={`M${-h},0H${h}M0,${-h}V${h}`} stroke={col} strokeWidth={1.2 * u} />
              <text x={h + 3 * u} y={-h + 1 * u} fontSize={11 * u} fontWeight={700} fill="#fff"
                paintOrder="stroke" stroke="#000" strokeWidth={2.5 * u}>{s.id}</text>
            </g>
          );
        })}

        {custom && (() => {
          const p = project(custom.lat, custom.lon);
          const h = 6 * u;
          return (
            <g transform={`translate(${p.x},${p.y})`} pointerEvents="none">
              <circle r={13 * u} fill="none" stroke="#fff" strokeWidth={1.6 * u} />
              <path d={`M${-h},${-h}L${h},${h}M${-h},${h}L${h},${-h}`} stroke="#fff" strokeWidth={2 * u} />
            </g>
          );
        })()}
      </svg>

      <div className="mapctl">
        <button aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, half: Math.max(8, v.half / 1.4) }))}>＋</button>
        <button aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, half: Math.min(outer * 1.5, v.half * 1.4) }))}>－</button>
        <button aria-label="Reset view" onClick={() => setView(home)}>⟲</button>
      </div>
    </div>
  );
}
