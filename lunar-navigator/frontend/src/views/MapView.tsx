// 2D tab: a photographic south pole map and modeled Sun position. Owner: MAP.
import { useState } from "react";
import SouthPoleMap from "../components/map/SouthPoleMap";
import TopoView from "../components/map/TopoView";
import ExplainCard from "../components/learn/ExplainCard";
import { api } from "../api/client";
import { explain } from "../content/explanations";
import { useApi } from "../hooks/useApi";
import { fmtUtc, hourKey, useLatest } from "../hooks/useLatest";
import { fmtLon } from "../lib/geo";
import { go } from "../router";
import { useApp } from "../state/store";

const EXTENTS = [
  { minLat: -84, label: "Pole" },
  { minLat: -80, label: "80°S" },
  { minLat: -70, label: "70°S" },
];

interface Props {
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

export default function MapView({ onCursor }: Props) {
  const { selectedId, custom, mode, time } = useApp();
  const sites = useApp((s) => s.sites());
  const [minLat, setMinLat] = useState(-80);
  const [look, setLook] = useState<"lit" | "topo">("lit");
  const [showRelief, setShowRelief] = useState(true);

  const features = useApi(() => api.features(), [], 0);
  const hour = hourKey(time);
  const illum = useLatest(() => (look === "lit" ? api.illumination(hour, minLat, 512) : null), `${hour}|${minLat}|${look}`);
  const a = illum.data && illum.data.min_lat === minLat ? illum.data : null;

  const lookSwitch = (
    <div className="tabs" role="group" aria-label="Map type">
      <button aria-pressed={look === "lit"} className={look === "lit" ? "active" : ""} onClick={() => setLook("lit")}>Lit map</button>
      <button aria-pressed={look === "topo"} className={look === "topo" ? "active" : ""} onClick={() => setLook("topo")}>Topographic</button>
    </div>
  );
  if (look === "topo") return <TopoView modeSwitch={lookSwitch} />;

  return (
    <div className="mapview">
      <SouthPoleMap sites={sites} features={features.data} illum={a} showRelief={showRelief}
        selectedId={selectedId} custom={custom} minLat={minLat}
        onSelect={(id) => go.site(id)} onPick={go.point} onCursor={onCursor} />

      <div className="map-overlay top-left">
        {lookSwitch}
        <div className="tabs" role="group" aria-label="Map extent">
          {EXTENTS.map((e) => (
            <button key={e.minLat} className={minLat === e.minLat ? "active" : ""} onClick={() => setMinLat(e.minLat)}>{e.label}</button>
          ))}
        </div>
        <div className="tabs" role="group" aria-label="Map appearance">
          <button aria-pressed={showRelief} className={showRelief ? "active" : ""} onClick={() => setShowRelief(true)}>Sunlit relief</button>
          <button aria-pressed={!showRelief} className={!showRelief ? "active" : ""} onClick={() => setShowRelief(false)}>NASA photo</button>
        </div>
        <div className="muted small">↑ 0° · toward Earth</div>
      </div>

      <div className="map-overlay top-mid sunbox">
        <span className="sundot" />
        {a ? (mode === "expert" ? (
          <span>
            Sun over <b>{fmtLon(a.sun.subsolar_lon)}</b> ·{" "}
            <b>{a.sun.elevation_at_pole >= 0 ? "+" : ""}{a.sun.elevation_at_pole.toFixed(1)}°</b> at the pole ·{" "}
            sub-solar lat <b>{a.sun.subsolar_lat.toFixed(2)}°</b> ·{" "}
            {!a.synthetic && a.lit_fraction !== null && <><b>{Math.round(a.lit_fraction * 100)}%</b> of modeled area lit · </>}
            {fmtUtc(a.time)}
          </span>
        ) : (
          <span>
            {a.sun.elevation_at_pole > 0 ? "The Sun skims the horizon" : "The Sun is just below the horizon at the pole"}
            {" "}on the side marked “Sun”. Shadows stretch away from it.
            {!a.synthetic && a.lit_fraction !== null && <> <b>{Math.round(a.lit_fraction * 100)}%</b> of the modeled area is in sunlight.</>}
            {" "}{fmtUtc(a.time)}
          </span>
        )) : <span className="muted">{illum.error ? "Lighting unavailable." : "Lighting the terrain…"}</span>}
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
          Imagery: <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">NASA Moon Trek / LRO WAC</a>.
          Photo lighting is fixed. Sunlit relief models changing shadows using LOLA elevation.
        </div>
        {showRelief && a && !a.synthetic && <div className="muted small">
          LOLA model: {a.pixel_km.toFixed(1)} km pixels, {a.horizon_limit_km} km shadow range;
          {" "}{Math.round(a.coverage_fraction * 100)}% of map modeled. Uncovered areas are blank.
        </div>}
        <div className="muted small">Site ratings are exploratory, not validated landing guidance.</div>
        {showRelief && a?.synthetic && <div className="muted small" role="status">LOLA DEM unavailable; select NASA photo to view the mosaic.</div>}
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
