// Local 20 km map around the site, with tabs: Sun position / Shadows / Rims + NASA Moon Trek imagery. Owner: MAP.
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { destination, fmtLat, fmtLon } from "../../lib/geo";
import { renderSiteTrekCanvas } from "../../lib/moontrek";
import { go } from "../../router";
import { MapTab, useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { drawGrid } from "./gridCanvas";

const SIZE_KM = 20; // must match the default tile size in api.elevation / api.shadow / api.rims
const SCALE_KM = 5;

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

  const elev = useApi(() => (loc ? api.elevation(loc) : null), [key]);
  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [key, time.getTime()]);
  const sun = state.data?.sun;
  const shadow = useApi(
    () => (loc && sun && tab === "shadows" ? api.shadow(loc, sun.altitude, sun.azimuth) : null),
    [key, tab, sun?.altitude, sun?.azimuth],
  );
  const rims = useApi(() => (loc && tab === "rims" ? api.rims(loc) : null), [key, tab]);

  // Load real NASA Moon Trek WMTS tile for this 20 km × 20 km region
  useEffect(() => {
    if (!loc) {
      setTrekCanvas(null);
      return;
    }
    let cancelled = false;
    renderSiteTrekCanvas(loc.lat, loc.lon, SIZE_KM, "lola_shade", 256)
      .then((c) => {
        if (!cancelled) setTrekCanvas(c);
      })
      .catch(() => {
        if (!cancelled) setTrekCanvas(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!canvas.current || !elev.data) return;
    drawGrid(canvas.current, elev.data.grid, elev.data.pixel_m, {
      shadow: tab === "shadows" ? shadow.data?.mask : undefined,
      rims: tab === "rims" ? rims.data?.mask : undefined,
      trekCanvas,
    });
  }, [elev.data, shadow.data, rims.data, tab, trekCanvas]);

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
    <div className="panel" style={{ flex: 1, minWidth: 360 }}>
      <h3>
        Site map{" "}
        <small className="muted">
          {trekCanvas ? "(NASA Moon Trek LOLA/WAC + terrain)" : elev.data?.synthetic ? "(synthetic terrain)" : ""}
        </small>
      </h3>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={t.key === tab ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
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
        {tab === "sun" && sun && <SunArrow az={sun.azimuth} alt={sun.altitude} />}
        <div style={{ position: "absolute", top: 4, left: "50%", fontSize: 12 }}>N</div>
      </div>
      {tab === "shadows" && shadow.data?.lit_fraction != null && (
        <div>Lit area: {(shadow.data.lit_fraction * 100).toFixed(0)}%</div>
      )}
      <ExplainCard text={current.help} />
      <div className="muted small">
        {hover ? `${fmtLat(hover.lat)}, ${fmtLon(hover.lon)} · ${hover.km.toFixed(1)} km from the site · click to move the site here`
          : `⊕ = landing site · tile is ${SIZE_KM} km across · hover for coordinates, click to move the site`}
      </div>
    </div>
  );
}

function SunArrow({ az, alt }: { az: number; alt: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <div style={{ transform: `rotate(${az}deg)`, height: "80%", display: "flex", alignItems: "flex-start" }}>
        <span style={{ fontSize: 24, opacity: alt > 0 ? 1 : 0.3 }}>☀️</span>
      </div>
    </div>
  );
}
