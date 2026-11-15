// 2D tab: the south pole map powered by NASA Moon Trek WMTS tiles + live Sun illumination, plus Topographic view. Owner: MAP.
import { useState } from "react";
import SouthPoleMap from "../components/map/SouthPoleMap";
import TopoView from "../components/map/TopoView";
import ExplainCard from "../components/learn/ExplainCard";
import { api } from "../api/client";
import { explain } from "../content/explanations";
import { useApi } from "../hooks/useApi";
import { fmtUtc, hourKey, useLatest } from "../hooks/useLatest";
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
  { id: "none", label: "Sunlit relief", title: "LOLA-derived modeled terrain lighting" },
];

interface Props {
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

export default function MapView({ onCursor }: Props) {
  const { selectedId, custom, mode, time } = useApp();
  const sites = useApp((s) => s.sites());
  const [minLat, setMinLat] = useState(-80);
  const [look, setLook] = useState<"lit" | "topo">("lit");
  const [trekLayer, setTrekLayer] = useState<TrekLayerId>("lola_shade");
  const [showShadows, setShowShadows] = useState(false);

  const features = useApi(() => api.features(), [], 0);
  const hour = hourKey(time);
  const illum = useLatest(() => (look === "lit" ? api.illumination(hour, minLat, 512) : null), `${hour}|${minLat}|${look}`);
  const a = !illum.error && illum.data && illum.data.min_lat === minLat ? illum.data : null;

  const lookSwitch = (
    <div className="tabs" role="group" aria-label="Map type">
      <button aria-pressed={look === "lit"} className={look === "lit" ? "active" : ""} onClick={() => setLook("lit")}>Lit map</button>
      <button aria-pressed={look === "topo"} className={look === "topo" ? "active" : ""} onClick={() => setLook("topo")}>Topographic</button>
    </div>
  );
  if (look === "topo") return <TopoView modeSwitch={lookSwitch} />;

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
          {lookSwitch}
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
                aria-pressed={trekLayer === opt.id}
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
              title="Overlay estimated terrain shadows on NASA Moon Trek imagery"
            >
              <input
                type="checkbox"
                checked={showShadows}
                onChange={(e) => setShowShadows(e.target.checked)}
                style={{ margin: 0 }}
              />
              Modeled shadows
            </label>
          )}
        </div>
        <div className="muted small">
          ↑ 0° · toward Earth {activeSpec ? `· ${activeSpec.title}` : ""}
        </div>
        <div className="sunbox">
          <span className="sundot" />
          {a ? <span><b>Sun {a.sun.elevation_at_pole >= 0 ? "+" : ""}{a.sun.elevation_at_pole.toFixed(1)}°</b> at pole
            {!a.synthetic && a.lit_fraction !== null && <> · <b>{Math.round(a.lit_fraction * 100)}%</b> modeled area lit</>}
            {" · "}{fmtUtc(a.time)}{mode === "expert" && <> · subsolar {fmtLon(a.sun.subsolar_lon)}, {a.sun.subsolar_lat.toFixed(2)}°</>}
          </span> : <span className="muted">{illum.error ? "Lighting unavailable." : "Lighting the terrain…"}</span>}
          {illum.loading && a && <span className="spinner" aria-label="updating" />}
        </div>
      </div>

      <div className="map-overlay bottom-left legend">
        <div className="legend-row">
          <span><i className="sq green" />GO</span>
          <span><i className="sq yellow" />CAUTION</span>
          <span><i className="sq red" />NO-GO</span>
          {a && !a.synthetic && (trekLayer === "none" || showShadows) && <>
            <span><i className="sw lit" />estimated sunlight</span>
            <span><i className="sw dark" />estimated shadow</span>
          </>}
          <span><i className="sw psr" />cold-trap crater</span>
        </div>
        <div className="muted small">
          {activeSpec
            ? `Basemap: ${activeSpec.attribution} (${activeSpec.productLabel})`
            : "Sunlit relief is modeled from LOLA elevation, not a photograph."}
        </div>
        {a && !a.synthetic && (trekLayer === "none" || showShadows) && <div className="muted small">
          Estimated lighting: {a.pixel_km.toFixed(1)} km pixels, {a.horizon_limit_km} km shadow range;
          {" "}{Math.round(a.coverage_fraction * 100)}% of map modeled. Unknown areas are not shaded.
        </div>}
        {a?.synthetic && (trekLayer === "none" || showShadows) && <div className="muted small" role="status">
          LOLA elevation is unavailable; modeled shadows are not shown. Moon Trek imagery remains available.
        </div>}
        <div className="muted small">Moon Trek image lighting is fixed; its photographed shadows do not move.</div>
        <div className="muted small">Site ratings are exploratory, not validated landing guidance.</div>
        {illum.error && <div className="error" role="status">Terrain lighting unavailable: {illum.error}</div>}
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
