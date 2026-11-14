// 2D tab: the south pole map. Owner: MAP.
import { useState } from "react";
import SouthPoleMap from "../components/map/SouthPoleMap";
import ExplainCard from "../components/learn/ExplainCard";
import { explain } from "../content/explanations";
import { go } from "../router";
import { useApp } from "../state/store";

const EXTENTS = [
  { minLat: -84, label: "Pole" },
  { minLat: -80, label: "80°S" },
  { minLat: -65, label: "65°S" },
];

interface Props {
  letters: Record<string, string>;
  onCursor: (p: { lat: number; lon: number } | null) => void;
}

export default function MapView({ letters, onCursor }: Props) {
  const { sites, scores, selectedId, custom, mode } = useApp();
  const [minLat, setMinLat] = useState(-80);

  return (
    <div className="mapview">
      <SouthPoleMap sites={sites} letters={letters} scores={scores} selectedId={selectedId} custom={custom}
        minLat={minLat} onSelect={(id) => go.site(id)} onPick={go.point} onCursor={onCursor} />

      <div className="map-overlay top-left">
        <div className="tabs" role="group" aria-label="Map extent">
          {EXTENTS.map((e) => (
            <button key={e.minLat} className={minLat === e.minLat ? "active" : ""} onClick={() => setMinLat(e.minLat)}>{e.label}</button>
          ))}
        </div>
        <div className="muted small">↑ 0° · toward Earth</div>
      </div>

      <div className="map-overlay bottom-left legend">
        <div className="legend-row">
          <span><i className="sq green" />good</span>
          <span><i className="sq yellow" />workable</span>
          <span><i className="sq red" />risky</span>
          <span><i className="swatch psr" />permanent shadow</span>
        </div>
        {mode === "beginner" && (
          <details>
            <summary>What am I looking at?</summary>
            <ExplainCard text={explain.southPole} />
          </details>
        )}
      </div>
    </div>
  );
}
