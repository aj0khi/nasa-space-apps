// Local 20 km map around the site, with tabs: Sun position / Shadows / Rims. Owner: MAP.
import { useEffect, useRef } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { MapTab, useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { drawGrid } from "./gridCanvas";

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

  const elev = useApi(() => (loc ? api.elevation(loc) : null), [key]);
  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [key, time.getTime()]);
  const sun = state.data?.sun;
  const shadow = useApi(
    () => (loc && sun && tab === "shadows" ? api.shadow(loc, sun.altitude, sun.azimuth) : null),
    [key, tab, sun?.altitude, sun?.azimuth],
  );
  const rims = useApi(() => (loc && tab === "rims" ? api.rims(loc) : null), [key, tab]);

  useEffect(() => {
    if (!canvas.current || !elev.data) return;
    drawGrid(canvas.current, elev.data.grid, elev.data.pixel_m, {
      shadow: tab === "shadows" ? shadow.data?.mask : undefined,
      rims: tab === "rims" ? rims.data?.mask : undefined,
    });
  }, [elev.data, shadow.data, rims.data, tab]);

  const current = TABS.find((t) => t.key === tab)!;
  return (
    <div className="panel" style={{ flex: 1, minWidth: 360 }}>
      <h3>Site map {elev.data?.synthetic && <small>(synthetic terrain)</small>}</h3>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={t.key === tab ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div style={{ position: "relative", marginTop: 8 }}>
        <canvas ref={canvas} style={{ width: "100%", imageRendering: "pixelated", aspectRatio: "1" }} />
        {tab === "sun" && sun && <SunArrow az={sun.azimuth} alt={sun.altitude} />}
        <div style={{ position: "absolute", top: 4, left: "50%", fontSize: 12 }}>N</div>
      </div>
      {tab === "shadows" && shadow.data?.lit_fraction != null && (
        <div>Lit area: {(shadow.data.lit_fraction * 100).toFixed(0)}%</div>
      )}
      <ExplainCard text={current.help} />
      {/* TODO(MAP): scale bar, lander marker at center, click-to-set-custom-site, global Moon view (Moon Trek tiles) */}
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
