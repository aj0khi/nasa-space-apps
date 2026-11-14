// 2D tab: the south pole map, lit by the Sun at the time on the date slider. Owner: MAP.
import { useState } from "react";
import SouthPoleMap from "../components/map/SouthPoleMap";
import ExplainCard from "../components/learn/ExplainCard";
import { api } from "../api/client";
import { explain } from "../content/explanations";
import { useApi } from "../hooks/useApi";
import { hourKey, useLatest } from "../hooks/useLatest";
import { fmtLon } from "../lib/geo";
import { go } from "../router";
import { useApp } from "../state/store";

const EXTENTS = [
  { minLat: -84, label: "Pole" },
  { minLat: -80, label: "80°S" },
  { minLat: -70, label: "70°S" },
];

interface Props {
  letters: Record<string, string>;
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

export default function MapView({ letters, onCursor }: Props) {
  const { sites, scores, now, selectedId, custom, mode, time } = useApp();
  const [minLat, setMinLat] = useState(-80);

  const features = useApi(() => api.features(), [], 0);
  const hour = hourKey(time);
  const illum = useLatest(() => api.illumination(hour, minLat), `${hour}|${minLat}`);
  const a = illum.data && illum.data.min_lat === minLat ? illum.data : null;

  return (
    <div className="mapview">
      <SouthPoleMap sites={sites} letters={letters} scores={scores} now={now} features={features.data} illum={a}
        selectedId={selectedId} custom={custom} minLat={minLat}
        onSelect={(id) => go.site(id)} onPick={go.point} onCursor={onCursor} />

      <div className="map-overlay top-left">
        <div className="tabs" role="group" aria-label="Map extent">
          {EXTENTS.map((e) => (
            <button key={e.minLat} className={minLat === e.minLat ? "active" : ""} onClick={() => setMinLat(e.minLat)}>{e.label}</button>
          ))}
        </div>
        <div className="muted small">↑ 0° · toward Earth</div>
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
          <span><i className="sq green" />good</span>
          <span><i className="sq yellow" />workable</span>
          <span><i className="sq red" />risky</span>
          <span><i className="sw lit" />sunlit now</span>
          <span><i className="sw dark" />shadow now</span>
          <span><i className="sw psr" />cold-trap crater</span>
        </div>
        {a?.synthetic && <div className="muted small">Terrain is a synthetic model until LOLA data is loaded.</div>}
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
