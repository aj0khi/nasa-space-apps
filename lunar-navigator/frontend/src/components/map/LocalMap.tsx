// Local 20 km map around the site, with tabs: Sun position / Shadows / Rims. Owner: MAP.
// Real LOLA terrain: lit like the 2D map (per-pixel Sun, shadows from up to 40 km away, slope brightness).
// Synthetic terrain (no DEM here): NASA Moon Trek imagery + modelled terrain, as before.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { destination, fmtLat, fmtLon } from "../../lib/geo";
import { renderSiteTrekCanvas } from "../../lib/moontrek";
import { go } from "../../router";
import { MapTab, useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { drawGrid, drawLitRelief, isEmptyMask, sunEdgePath } from "./gridCanvas";

const SIZE_KM = 20; // must match the default tile size in api.elevation / api.shadow / api.rims
const SCALE_KM = 5;
// Real LOLA terrain is 80 m/px, so 256 cells across 20 km (78 m) shows all of it. Synthetic-terrain shadows
// use the older per-pixel march, which is slow at 256, so they stay at 128 and are smoothed when drawn.
const TERRAIN_RES = 256;
const SHADOW_RES = 128;
const LIGHT_RES = 256;
const DRAW_PX = 768; // canvas pixels across (sharp on high-DPI screens)

const TABS: { key: MapTab; label: string; help: string }[] = [
  { key: "sun", label: "☀️ Sun position", help: explain.sunTab },
  { key: "shadows", label: "🌑 Shadows", help: explain.shadowsTab },
  { key: "rims", label: "⛰️ Rims", help: explain.rimsTab },
];

export default function LocalMap() {
  const { tab, setTab, time } = useApp();
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const canvas = useRef<HTMLCanvasElement>(null);
  const [trekCanvas, setTrekCanvas] = useState<HTMLCanvasElement | null>(null);
  const [trekError, setTrekError] = useState(false);

  const elev = useApi(() => (loc ? api.elevation(loc, SIZE_KM, TERRAIN_RES) : null), [key]);
  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [key, time.getTime()]);
  const sun = state.error ? undefined : state.data?.sun;
  const real = !!elev.data && !elev.error && !elev.data.synthetic;
  const lightTab = tab === "sun" || tab === "shadows";
  const light = useApi(
    () => (loc && sun && real && lightTab ? api.lighting(loc, sun.altitude, sun.azimuth, SIZE_KM, LIGHT_RES) : null),
    [key, real, lightTab, sun?.altitude, sun?.azimuth], 150,
  );
  const shadow = useApi(
    () => (loc && sun && elev.data?.synthetic && tab === "shadows"
      ? api.shadow(loc, sun.altitude, sun.azimuth, SIZE_KM, SHADOW_RES) : null),
    [key, tab, elev.data?.synthetic, sun?.altitude, sun?.azimuth],
  );
  const showLight = real && lightTab && !!light.data && !light.error;
  const rims = useApi(() => (loc && tab === "rims" ? api.rims(loc, SIZE_KM, TERRAIN_RES) : null), [key, tab]);

  // Load real NASA Moon Trek WMTS tile for this 20 km × 20 km region
  useEffect(() => {
    setTrekCanvas(null);
    setTrekError(false);
    if (!loc) {
      setTrekCanvas(null);
      return;
    }
    let cancelled = false;
    renderSiteTrekCanvas(loc.lat, loc.lon, SIZE_KM, "lola_shade", DRAW_PX, 6)
      .then((c) => {
        if (!cancelled) setTrekCanvas(c);
      })
      .catch(() => {
        if (!cancelled) setTrekError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!canvas.current) return;
    if (!elev.data || elev.error) {
      canvas.current.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
      return;
    }
    if (showLight) {
      drawLitRelief(canvas.current, light.data!, DRAW_PX, tab === "shadows" ? "shadows" : "photo");
      return;
    }
    drawGrid(canvas.current, elev.data.grid, elev.data.pixel_m, {
      shadow: tab === "shadows" && !shadow.error ? shadow.data?.mask : undefined,
      rims: tab === "rims" && !rims.error ? rims.data?.mask : undefined,
      // Moon Trek imagery only fills in for modelled terrain: over real LOLA data it adds nothing but its
      // fixed photographed shadows and stripe artefacts near the pole.
      trekCanvas: real ? null : trekCanvas,
      outPx: DRAW_PX,
    });
  }, [elev.data, elev.error, shadow.data, shadow.error, rims.data, rims.error, tab, trekCanvas, real, showLight, light.data]);

  const edge = useMemo(() => (showLight && tab === "shadows" ? sunEdgePath(light.data!) : null), [showLight, tab, light.data]);

  // Pointer → position on the tile. Grid convention (terrain.py): row 0 = north edge, col 0 = west edge, site at the center.
  const [hover, setHover] = useState<{ lat: number; lon: number; km: number } | null>(null);
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!loc) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const east = ((e.clientX - r.left) / r.width - 0.5) * SIZE_KM;
    const north = (0.5 - (e.clientY - r.top) / r.height) * SIZE_KM;
    const km = Math.hypot(east, north);
    return { ...destination(loc.lat, loc.lon, (Math.atan2(east, north) * 180) / Math.PI, km), km };
  };

  const current = TABS.find((t) => t.key === tab)!;
  return (
    <div className="panel" style={{ flex: 1, minWidth: "min(360px, 100%)" }}>
      <h3>
        Site map{" "}
        <small className="muted">
          {real ? "(NASA LOLA terrain, lit for the selected time)" : trekCanvas ? "(NASA Moon Trek imagery + terrain)" : ""}
        </small>
      </h3>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={t.key === tab ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="muted small" role="status">
        {elev.error ? `Terrain unavailable: ${elev.error}` : elev.data
          ? `Elevation: ${elev.data.synthetic ? "synthetic (LOLA DEM unavailable at this site)" : "LOLA DEM"}.`
          : "Loading terrain…"}
        {trekError && !real && " Moon Trek imagery unavailable; showing terrain hillshade."}
        {real && lightTab && light.error && ` Lighting unavailable: ${light.error}`}
        {state.error && ` Sun position unavailable: ${state.error}`}
        {tab === "shadows" && shadow.error && ` Shadows unavailable: ${shadow.error}`}
        {tab === "rims" && rims.error && ` Rims unavailable: ${rims.error}`}
      </div>
      <div style={{ position: "relative", marginTop: 8, cursor: "crosshair" }} title="Click to move the site here"
        onMouseMove={(e) => setHover(at(e))} onMouseLeave={() => setHover(null)}
        onClick={(e) => { const p = at(e); if (p) go.point(p.lat, p.lon); }}>
        <canvas ref={canvas} style={{ width: "100%", display: "block", imageRendering: "auto", aspectRatio: "1" }} />
        {/* the site (lander) sits at the center of the tile */}
        <svg viewBox="-12 -12 24 24" width={26} aria-label="Landing site"
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
          <circle r={8} fill="none" stroke="#000" strokeWidth={4} />
          <circle r={8} fill="none" stroke="#fff" strokeWidth={2} />
          <path d="M-12,0 H-4 M4,0 H12 M0,-12 V-4 M0,4 V12" stroke="#fff" strokeWidth={2} />
        </svg>
        {/* scale bar */}
        <div style={{ position: "absolute", left: 8, bottom: 8, width: `${(100 * SCALE_KM) / SIZE_KM}%`, pointerEvents: "none",
          borderBottom: "3px solid #fff", borderLeft: "3px solid #fff", borderRight: "3px solid #fff", height: 6,
          filter: "drop-shadow(0 0 2px #000)" }}>
          <span style={{ position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "#fff" }}>{SCALE_KM} km</span>
        </div>
        {edge && (
          <svg viewBox={`0 0 ${edge.n - 1} ${edge.n - 1}`} preserveAspectRatio="none" aria-hidden="true"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <path d={edge.d} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={1.2} vectorEffect="non-scaling-stroke"
              strokeLinejoin="round" transform="translate(0.5 0.5)" />
          </svg>
        )}
        {lightTab && sun && <SunMarker az={sun.azimuth} alt={sun.altitude} />}
        <div style={{ position: "absolute", top: 4, left: "50%", fontSize: 12 }}>N</div>
      </div>
      {tab === "shadows" && showLight && (
        <div className="muted small" style={{ marginTop: 6 }}>
          <span style={{ color: "var(--text)" }}>Lit area: {(light.data!.lit_fraction * 100).toFixed(0)}%</span>
          {` · white line = edge of sunlight · shadows include terrain up to ${light.data!.horizon_reach_km.toFixed(0)} km beyond each spot`}
        </div>
      )}
      {tab === "shadows" && !real && !shadow.error && shadow.data?.lit_fraction != null && (
        <div>Lit area: {(shadow.data.lit_fraction * 100).toFixed(0)}%</div>
      )}
      {tab === "rims" && !rims.error && isEmptyMask(rims.data?.mask) && (
        <div className="muted small" style={{ marginTop: 6 }}>No crater rims within 10 km of this spot: it’s open, gently rolling ground.</div>
      )}
      <ExplainCard text={current.help} />
      <div className="muted small">
        {hover ? `${fmtLat(hover.lat)}, ${fmtLon(hover.lon)} · ${hover.km.toFixed(1)} km from the site · click to move the site here`
          : `⊕ = landing site · tile is ${SIZE_KM} km across · hover for coordinates, click to move the site`}
      </div>
    </div>
  );
}

/**
 * The Sun as seen from the site, drawn like the polar map: a glowing disc at the edge of the tile in the Sun's
 * direction (azimuth, clockwise from north), its altitude, and faint parallel rays showing which way light falls
 * across the tile. Shadows are cast away from the Sun. Dimmed when the Sun is below the horizon.
 */
function SunMarker({ az, alt }: { az: number; alt: number }) {
  const grad = `sun${useId().replace(/:/g, "")}`;
  const a = (az * Math.PI) / 180;
  const ux = Math.sin(a), uy = -Math.cos(a); // unit vector toward the Sun (y down = south)
  const R = 42; // disc distance from the site, in a 100-unit tile
  const sx = ux * R, sy = uy * R;
  const up = alt > 0;
  // label sits on the inner side of the disc so it never runs off the tile
  const lx = sx - ux * 11, ly = sy - uy * 11 + 1.6;
  return (
    <svg viewBox="-50 -50 100 100" aria-label={`Sun at azimuth ${az.toFixed(0)}°, altitude ${alt.toFixed(1)}°`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
      <defs>
        <radialGradient id={grad}>
          <stop offset="0%" stopColor="#fffdf3" />
          <stop offset="70%" stopColor="#ffe7a4" />
          <stop offset="100%" stopColor="#e4a953" />
        </radialGradient>
        <radialGradient id={`${grad}-glow`}>
          <stop offset="0%" stopColor="#ffd98a" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#ffd98a" stopOpacity={0} />
        </radialGradient>
      </defs>
      {up && (
        <g stroke="#ffd27a" strokeOpacity={0.3} strokeWidth={0.3} strokeDasharray="1.5 1.5">
          {[-30, -15, 0, 15, 30].map((o) => {
            const px = -uy * o, py = ux * o; // offset perpendicular to the light
            return <line key={o} x1={px + ux * 36} y1={py + uy * 36} x2={px - ux * 8} y2={py - uy * 8} />;
          })}
        </g>
      )}
      <g transform={`translate(${sx} ${sy})`} opacity={up ? 1 : 0.45}>
        <circle r={9} fill={`url(#${grad}-glow)`} />
        <circle r={3.6} fill={`url(#${grad})`} stroke="#000" strokeOpacity={0.5} strokeWidth={0.3} />
      </g>
      <text x={lx} y={ly} fontSize={3.4} fontWeight={600} fill="#ffd27a" textAnchor="middle" paintOrder="stroke"
        stroke="#000" strokeOpacity={0.75} strokeWidth={0.5} strokeLinejoin="round" opacity={up ? 1 : 0.7}>
        Sun {alt >= 0 ? "+" : "−"}{Math.abs(alt).toFixed(1)}°{up ? "" : " (below horizon)"}
      </text>
    </svg>
  );
}
