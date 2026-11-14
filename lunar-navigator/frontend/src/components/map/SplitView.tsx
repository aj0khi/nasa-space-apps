// Split view: crater floor (shadows) next to rims at the same instant. Owner: MAP.
import { useEffect, useRef } from "react";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import { drawGrid } from "./gridCanvas";

export default function SplitView() {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const left = useRef<HTMLCanvasElement>(null);
  const right = useRef<HTMLCanvasElement>(null);

  const elev = useApi(() => (loc ? api.elevation(loc, 20, 96) : null), [key]);
  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [key, time.getTime()], 300);
  const sun = state.data?.sun;
  const shadow = useApi(() => (loc && sun ? api.shadow(loc, sun.altitude, sun.azimuth, 20, 96) : null),
    [key, sun?.altitude, sun?.azimuth], 300);
  const rims = useApi(() => (loc ? api.rims(loc, 20, 96) : null), [key]);

  useEffect(() => {
    if (!elev.data) return;
    if (left.current) drawGrid(left.current, elev.data.grid, elev.data.pixel_m, { shadow: shadow.data?.mask });
    if (right.current) drawGrid(right.current, elev.data.grid, elev.data.pixel_m, { rims: rims.data?.mask });
  }, [elev.data, shadow.data, rims.data]);

  return (
    <div className="panel" style={{ flex: 1, minWidth: 320 }}>
      <h3>Craters vs rims</h3>
      <div style={{ display: "flex", gap: 8 }}>
        <figure style={{ flex: 1, margin: 0 }}><canvas ref={left} style={{ width: "100%" }} /><figcaption>Light & shadow</figcaption></figure>
        <figure style={{ flex: 1, margin: 0 }}><canvas ref={right} style={{ width: "100%" }} /><figcaption>Rims</figcaption></figure>
      </div>
      {/* TODO(MAP): sync hover crosshair between the two halves */}
    </div>
  );
}
