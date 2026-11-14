// 2D tab: the south pole map powered by NASA Moon Trek WMTS tiles + live Sun illumination. Owner: MAP.
import { useState } from "react";
import SouthPoleMap from "../components/map/SouthPoleMap";
import ExplainCard from "../components/learn/ExplainCard";
import { api } from "../api/client";
import { explain } from "../content/explanations";
import { useApi } from "../hooks/useApi";
import { hourKey, useLatest } from "../hooks/useLatest";
import { fmtLon } from "../lib/geo";
import { TREK_SP_LAYERS, TrekLayerId } from "../lib/moontrek";
import { go } from "../router";
import { useApp } from "../state/store";

const EXTENTS = [
  { minLat: -84, label: "Pole" },
  { minLat: -80, label: "80°S" },
  { minLat: -70, label: "70°S" },
];

const TREK_OPTIONS: { id: TrekLayerId; label: string; title: string }[] = [
  { id: "lola_shade", label: "LOLA Relief", title: TREK_SP_LAYERS.lola_shade.title },
  { id: "wac", label: "WAC Photo", title: TREK_SP_LAYERS.wac.title },
  { id: "lola_color", label: "Color Elev", title: TREK_SP_LAYERS.lola_color.title },
  { id: "lola_slope", label: "Slope", title: TREK_SP_LAYERS.lola_slope.title },
  { id: "none", label: "Synthetic", title: "Analytical ray-marched terrain model only" },
];

interface Props {
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

export default function MapView({ onCursor }: Props) {
  const { selectedId, custom, mode, time } = useApp();
  const sites = useApp((s) => s.sites());
  const [minLat, setMinLat] = useState(-80);
  const [trekLayer, setTrekLayer] = useState<TrekLayerId>("lola_shade");
  const [showShadows, setShowShadows] = useState(true);

  const features = useApi(() => api.features(), [], 0);
  const hour = hourKey(time);
  const illum = useLatest(() => api.illumination(hour, minLat), `${hour}|${minLat}`);
  const a = illum.data && illum.data.min_lat === minLat ? illum.data : null;

  const activeSpec = trekLayer !== "none" ? TREK_SP_LAYERS[trekLayer] : null;

  return (
    <div className="mapview">
      <SouthPoleMap
        sites={sites}
        features={features.data}
        illum={a}
        selectedId={selectedId}
        custom={custom}
        minLat={minLat}
        trekLayer={trekLayer}
        showShadows={showShadows}
        onSelect={(id) => go.site(id)}
        onPick={go.point}
        onCursor={onCursor}
      />

      <div className="map-overlay top-left">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs" role="group" aria-label="Map extent">
            {EXTENTS.map((e) => (
              <button key={e.minLat} className={minLat === e.minLat ? "active" : ""} onClick={() => setMinLat(e.minLat)}>
                {e.label}
              </button>
            ))}
          </div>
          <div className="tabs" role="group" aria-label="NASA Moon Trek Basemap">
            {TREK_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                title={opt.title}
                className={trekLayer === opt.id ? "active" : ""}
                onClick={() => setTrekLayer(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {trekLayer !== "none" && (
            <label
              className="tabs"
              style={{ padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}
              title="Overlay real-time solar illumination and shadows on top of NASA Moon Trek imagery"
            >
              <input
                type="checkbox"
                checked={showShadows}
                onChange={(e) => setShowShadows(e.target.checked)}
                style={{ margin: 0 }}
              />
              ☀️ Live Shadows
            </label>
          )}
        </div>
        <div className="muted small">
          ↑ 0° · toward Earth {activeSpec ? `· ${activeSpec.title}` : ""}
        </div>
      </div>

      <div className="map-overlay top-mid sunbox" aria-live="polite">
        <span className="sundot" />
        {a ? (
          <span>
            Sun over <b>{fmtLon(a.sun.subsolar_lon)}</b> ·{" "}
            <b>{a.sun.elevation_at_pole >= 0 ? "+" : ""}{a.sun.elevation_at_pole.toFixed(1)}°</b> at the pole ·{" "}
            <b>{Math.round(a.lit_fraction * 100)}%</b> of this map lit
          </span>
        ) : <span className="muted">Lighting the terrain…</span>}
        {illum.loading && a && <span className="spinner" aria-label="updating" />}
      </div>

      <div className="map-overlay bottom-left legend">
        <div className="legend-row">
          <span><i className="sq green" />GO</span>
          <span><i className="sq yellow" />CAUTION</span>
          <span><i className="sq red" />NO-GO</span>
          <span><i className="sw lit" />sunlit now</span>
          <span><i className="sw dark" />shadow now</span>
          <span><i className="sw psr" />cold-trap crater</span>
        </div>
        <div className="muted small">
          {activeSpec
            ? `Basemap: ${activeSpec.attribution} (${activeSpec.productLabel})`
            : "Terrain is an analytical model; select a NASA Moon Trek layer above for real LRO imagery."}
        </div>
        {mode === "beginner" && (
          <details>
            <summary>What am I looking at?</summary>
            <ExplainCard text={explain.southPole} />
            <ExplainCard text={explain.sunMap} />
          </details>
        )}
      </div>
    </div>
  );
}
