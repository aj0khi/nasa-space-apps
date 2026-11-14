// Main interactive map of the lunar south pole (polar stereographic, top-down). Owner: MAP.
// Scroll to zoom, drag to pan, click a marker to select a site, click the ground to select any point.
import { useMemo, useRef, useState } from "react";
import { CRATERS } from "../../content/southPoleFeatures";
import { project, ringRadius, unproject } from "../../lib/geo";
import type { Score, Site } from "../../types";

interface Props {
  sites: Site[];
  letters: Record<string, string>;
  scores: Record<string, Score>;
  selectedId: string | null;
  custom: { lat: number; lon: number } | null;
  minLat: number; // outer edge of the map, e.g. -80
  onSelect: (id: string) => void;
  onPick: (lat: number, lon: number) => void;
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

const STATUS_COLOR = { green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)" };

export default function SouthPoleMap({ sites, letters, scores, selectedId, custom, minLat, onSelect, onPick, onCursor }: Props) {
  const outer = ringRadius(minLat);
  const home = { cx: 0, cy: 0, half: outer * 1.04 };
  const [view, setView] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const lastMin = useRef(minLat);
  if (lastMin.current !== minLat) {
    lastMin.current = minLat;
    setView(home);
  }

  const u = view.half / 300; // one "screen unit" in km, keeps labels/markers a constant size on screen

  const toKm = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const s = (2 * view.half) / Math.min(r.width, r.height);
    return { x: view.cx + (clientX - r.left - r.width / 2) * s, y: view.cy + (clientY - r.top - r.height / 2) * s };
  };

  const rings = useMemo(() => [-89, -88, -87, -86, -85, -84, -82, -80, -75, -70, -65].filter((l) => l <= minLat), [minLat]);
  const shown = sites.filter((s) => s.lat <= minLat && letters[s.id]);

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
        <defs>
          <radialGradient id="ground" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6e6f74" />
            <stop offset="100%" stopColor="#3b3c41" />
          </radialGradient>
          <radialGradient id="psr" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#05070d" />
            <stop offset="72%" stopColor="#151a26" />
            <stop offset="100%" stopColor="#9a9a9d" />
          </radialGradient>
          <radialGradient id="crater" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b3c42" />
            <stop offset="85%" stopColor="#4b4c52" />
            <stop offset="100%" stopColor="#a3a3a6" />
          </radialGradient>
        </defs>

        <rect data-ground="1" x={-outer * 3} y={-outer * 3} width={outer * 6} height={outer * 6} fill="var(--map-bg)" />
        <circle data-ground="1" r={outer} fill="url(#ground)" />

        {CRATERS.filter((c) => c.lat <= minLat).map((c) => {
          const p = project(c.lat, c.lon);
          return (
            <g key={c.name} pointerEvents="none">
              <circle cx={p.x} cy={p.y} r={c.diameter_km / 2} fill={c.psr ? "url(#psr)" : "url(#crater)"} />
              <circle cx={p.x} cy={p.y} r={c.diameter_km / 2} fill="none" stroke="#d6d6d9" strokeOpacity={0.55} strokeWidth={1.2 * u} />
              <text x={p.x} y={p.y + c.diameter_km / 2 + 9 * u} fontSize={8.5 * u} fill="#c9ccd3" textAnchor="middle">{c.name}</text>
            </g>
          );
        })}

        <g pointerEvents="none" stroke="#fff" strokeOpacity={0.1} fill="none" strokeWidth={0.8 * u}>
          {rings.map((lat) => <circle key={lat} r={ringRadius(lat)} />)}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((lon) => {
            const p = project(minLat, lon);
            return <line key={lon} x1={0} y1={0} x2={p.x} y2={p.y} />;
          })}
        </g>
        <g pointerEvents="none" fill="#9aa1ad" fontSize={7.5 * u}>
          {rings.map((lat) => <text key={lat} x={2 * u} y={-ringRadius(lat) - 2 * u}>{Math.abs(lat)}°S</text>)}
        </g>

        {/* sites: square crosshair markers with their letter */}
        {shown.map((s) => {
          const p = project(s.lat, s.lon);
          const st = scores[s.id]?.status;
          const col = st ? STATUS_COLOR[st] : "#bbb";
          const sel = s.id === selectedId;
          const h = 6 * u;
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`} className="marker"
              onPointerUp={(e) => { if (!drag.current?.moved) { e.stopPropagation(); drag.current = null; onSelect(s.id); } }}>
              <title>{`${letters[s.id]}: ${s.name}`}</title>
              {sel && <circle r={13 * u} fill="none" stroke="#fff" strokeWidth={1.6 * u} />}
              <rect x={-h} y={-h} width={2 * h} height={2 * h} fill="rgba(11,13,18,0.75)" stroke={col} strokeWidth={1.8 * u} />
              <path d={`M${-h},0H${h}M0,${-h}V${h}`} stroke={col} strokeWidth={1.2 * u} />
              <text x={h + 3 * u} y={-h + 1 * u} fontSize={11 * u} fontWeight={700} fill="#fff"
                paintOrder="stroke" stroke="#000" strokeWidth={2.5 * u}>{letters[s.id]}</text>
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
