// Split view: crater floor (shadows) next to rims at the same instant. Owner: MAP.
import { useEffect, useRef, useState } from "react";
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

  // Same spot highlighted on both halves (fractions 0..1 of the tile, so it survives resizing).
  const [cross, setCross] = useState<{ fx: number; fy: number } | null>(null);
  const SIZE_KM = 20;
  const half = (ref: React.RefObject<HTMLCanvasElement>, caption: string) => (
    <figure style={{ flex: 1, margin: 0 }}>
      <div style={{ position: "relative", cursor: "crosshair" }} onMouseLeave={() => setCross(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCross({ fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
        }}>
        <canvas ref={ref} style={{ width: "100%", display: "block" }} />
        {cross && (
          <>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${cross.fx * 100}%`, borderLeft: "1px solid var(--sun)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: `${cross.fy * 100}%`, borderTop: "1px solid var(--sun)", pointerEvents: "none" }} />
          </>
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
  const cell = (m?: number[][] | null) => {
    if (!m || !cross) return null;
    const row = Math.min(m.length - 1, Math.max(0, Math.floor(cross.fy * m.length)));
    const col = Math.min(m[0].length - 1, Math.max(0, Math.floor(cross.fx * m[0].length)));
    return m[row][col];
  };
  const lit = cell(shadow.data?.mask), rim = cell(rims.data?.mask), z = cell(elev.data?.grid);

  return (
    <div className="panel" style={{ flex: 1, minWidth: 320 }}>
      <h3>Craters vs rims</h3>
      <div style={{ display: "flex", gap: 8 }}>
        {half(left, "Light & shadow")}
        {half(right, "Rims")}
      </div>
      <div className="muted small" aria-live="polite">
        {cross
          ? `${((cross.fx - 0.5) * SIZE_KM).toFixed(1)} km east, ${((0.5 - cross.fy) * SIZE_KM).toFixed(1)} km north of the site`
            + (z != null ? ` · ${z.toFixed(0)} m` : "")
            + (lit != null ? ` · ${lit ? "sunlit" : "in shadow"}` : "")
            + (rim != null ? ` · ${rim ? "on a rim" : "not a rim"}` : "")
          : "Hover either map: the crosshair marks the same spot on both."}
      </div>
    </div>
  );
}
