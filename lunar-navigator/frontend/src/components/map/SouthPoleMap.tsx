// Main interactive map of the lunar south pole (polar stereographic, top-down). Owner: MAP.
// Integrates live NASA Moon Trek WMTS polar stereographic tiles (LROC WAC optical mosaic, LOLA 30m hillshade,
// LOLA colorized elevation, and LOLA slope) with real-time dynamic solar illumination & shadow ray-casting.
// Scroll to zoom, drag to pan, click a marker to select a site, click the ground to select any point.
import { useId, useMemo, useRef, useState } from "react";
import { project, ringRadius, unproject } from "../../lib/geo";
import { getVisiblePolarTiles, TrekLayerId } from "../../lib/moontrek";
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
  trekLayer?: TrekLayerId;
  showShadows?: boolean;
  onSelect: (id: string) => void;
  onPick: (lat: number, lon: number) => void;
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

const COLOR = { green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)" };
/**
 * Decode the backend's byte grid into a PNG:
 * - When `overlayMode = false`: opaque warm sunlit ground & cold blue shadow.
 * - When `overlayMode = true`: translucent golden sunlight & deep blue-black lunar night tint so the
 *   real NASA Moon Trek satellite tiles underneath remain crisp and visible!
 */
function illumToDataUrl(a: Illumination, overlayMode: boolean): string {
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
    if (b === 255) {
      img.data[k + 3] = 0;
      continue;
    }
    const v = b & 127;
    if (overlayMode) {
      if (b & 128) {
        // Sunlit overlay: warm solar tint proportional to slope incidence
        img.data[k] = 255;
        img.data[k + 1] = 212;
        img.data[k + 2] = 128;
        img.data[k + 3] = Math.round(28 + (v / 127) * 52);
      } else {
        // Shadow overlay: deep lunar night shadow that still lets LOLA/WAC craters show through
        img.data[k] = 5;
        img.data[k + 1] = 10;
        img.data[k + 2] = 24;
        img.data[k + 3] = 165;
      }
    } else {
      if (b & 128) {
        const g = 55 + v * 1.55; // sunlit
        img.data[k] = Math.min(255, g * 1.08);
        img.data[k + 1] = g;
        img.data[k + 2] = g * 0.84;
      } else {
        const g = v * 2.4; // shadow: dim, cold
        img.data[k] = g * 0.55;
        img.data[k + 1] = g * 0.68;
        img.data[k + 2] = 18 + g;
      }
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export default function SouthPoleMap(props: Props) {
  const sunGradient = useId();
  const {
    sites,
    features,
    illum,
    selectedId,
    custom,
    minLat,
    trekLayer = "lola_shade",
    showShadows = false,
    onSelect,
    onPick,
    onCursor,
  } = props;
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

  const hasTrek = trekLayer !== "none";
  const trekTiles = useMemo(
    () => getVisiblePolarTiles(trekLayer, view, outer),
    [trekLayer, view.cx, view.cy, view.half, outer],
  );

  const [failedTiles, setFailedTiles] = useState<string[]>([]);
  const imgUrl = useMemo(
    () => (illum && !illum.synthetic && (!hasTrek || showShadows) ? illumToDataUrl(illum, hasTrek) : null),
    [illum, hasTrek, showShadows],
  );
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
        role="img"
        aria-label={hasTrek ? "Lunar south pole map with NASA Moon Trek imagery and landing-site markers" : "Lunar south pole modeled sunlit relief and landing-site markers"}
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
          <radialGradient id={sunGradient}>
            <stop offset="0%" stopColor="#fffdf3" />
            <stop offset="70%" stopColor="#ffe7a4" />
            <stop offset="100%" stopColor="#e4a953" />
          </radialGradient>
          <clipPath id="south-pole-disc">
            <circle r={outer} />
          </clipPath>
        </defs>

        <rect data-ground="1" x={-outer * 3} y={-outer * 3} width={outer * 6} height={outer * 6} fill="var(--map-bg)" />
        <circle data-ground="1" r={outer} fill="#1b1e26" />
        {/* Live NASA Moon Trek WMTS polar stereographic tiles clipped to the polar circle */}
        {hasTrek && (
          <g clipPath="url(#south-pole-disc)">
            {trekTiles.map((t) => (
              <image
                key={t.key}
                data-ground="1"
                href={t.url}
                x={t.x}
                y={t.y}
                width={t.size + 0.35}
                height={t.size + 0.35}
                preserveAspectRatio="none"
                onLoad={() => setFailedTiles((old) => old.includes(t.key) ? old.filter((key) => key !== t.key) : old)}
                onError={() => setFailedTiles((old) => old.includes(t.key) ? old : [...old, t.key])}
              />
            ))}
          </g>
        )}

        {/* Dynamic solar illumination & shadow layer (translucent overlay when Moon Trek is active) */}
        {imgUrl && illum && (
          <image
            data-ground="1"
            href={imgUrl}
            x={-illum.half_km - illum.pixel_km / 2}
            y={-illum.half_km - illum.pixel_km / 2}
            width={2 * illum.half_km + illum.pixel_km}
            height={2 * illum.half_km + illum.pixel_km}
            preserveAspectRatio="none"
            clipPath="url(#south-pole-disc)"
            pointerEvents="none"
          />
        )}

        {/* Outer ring border */}
        <circle r={outer} fill="none" stroke="#3a4252" strokeWidth={1.2 * u} pointerEvents="none" />

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

        {/* crater outlines & names */}
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

        <g pointerEvents="none" stroke="#fff" strokeOpacity={0.12} fill="none" strokeWidth={0.8 * u}>
          {rings.map((lat) => <circle key={lat} r={ringRadius(lat)} />)}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((lon) => {
            const p = project(minLat, lon);
            return <line key={lon} x1={0} y1={0} x2={p.x} y2={p.y} />;
          })}
        </g>
        <g pointerEvents="none" fill="#c2c8d4" fontSize={7.5 * u} paintOrder="stroke" stroke="#000" strokeWidth={1.6 * u} strokeOpacity={0.65}>
          {rings.map((lat) => <text key={lat} x={2 * u} y={-ringRadius(lat) - 2 * u}>{Math.abs(lat)}°S</text>)}
        </g>

        {/* Sun and Earth on the horizon */}
        {sun && illum && (
          <g transform={`translate(${sun.x},${sun.y})`} pointerEvents="none" opacity={illum.sun.elevation_at_pole > -2 ? 1 : 0.55}>
            <circle r={10 * u} fill={`url(#${sunGradient})`} />
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
      {hasTrek && trekTiles.some((tile) => failedTiles.includes(tile.key)) &&
        <div role="status" className="error">Some Moon Trek imagery tiles could not be loaded.</div>}

      <div className="mapctl">
        <button aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, half: Math.max(8, v.half / 1.4) }))}>＋</button>
        <button aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, half: Math.min(outer * 1.5, v.half * 1.4) }))}>－</button>
        <button aria-label="Reset view" onClick={() => setView(home)}>⟲</button>
      </div>
    </div>
  );
}
