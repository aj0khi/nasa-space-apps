// Bottom of the rail: live coordinates under the cursor, or the selected point (+ elevation for A–H). Owner: MAP.
import { useEffect, useState } from "react";
import { fmtLat, fmtLon } from "../../lib/geo";
import { go } from "../../router";
import { useApp } from "../../state/store";

const MIN_LAT = -90;

export default function CoordsBar({ cursor }: { cursor: { lat: number; lon: number } | null }) {
  const loc = useApp((s) => s.location());
  const p = cursor ?? loc;
  const elev = !cursor ? loc?.site?.coordinates.elevation_m : undefined;
  return (
    <section className="rail-sec coords" aria-live="off">
      <span className="muted">{cursor ? "Cursor" : loc?.site ? `Site ${loc.site.id}` : "Selected"}</span>
      <span className="coord-val">
        {p ? `${fmtLat(p.lat)}  ${fmtLon(p.lon)}` : "—"}
        {elev != null && <span className="muted"> | {elev >= 0 ? "+" : ""}{Math.round(elev).toLocaleString()} m</span>}
      </span>
    </section>
  );
}

/** Expert: jump straight to a latitude / longitude instead of clicking the map. South-pole coverage only. */
export function GoToPoint() {
  const loc = useApp((s) => s.location());
  const [lat, setLat] = useState(loc ? loc.lat.toFixed(3) : "-89.500");
  const [lon, setLon] = useState(loc ? loc.lon.toFixed(3) : "0.000");
  useEffect(() => { if (loc) { setLat(loc.lat.toFixed(3)); setLon(loc.lon.toFixed(3)); } }, [loc?.lat, loc?.lon]);
  const la = Number(lat), lo = Number(lon);
  const err = !Number.isFinite(la) || la < MIN_LAT || la > -60 ? `Latitude must be between ${MIN_LAT}° and -60° (south pole region).`
    : !Number.isFinite(lo) || lo < -180 || lo > 180 ? "Longitude must be between -180° and 180°." : null;
  return (
    <section className="rail-sec goto">
      <h2>Go to coordinates</h2>
      <form className="goto-form" onSubmit={(e) => { e.preventDefault(); if (!err) go.point(la, lo); }}>
        <label><span>Latitude (°)</span>
          <input type="number" inputMode="decimal" step="any" min={MIN_LAT} max={-60} value={lat} onChange={(e) => setLat(e.target.value)} aria-invalid={!!err && err.startsWith("Lat")} />
        </label>
        <label><span>Longitude (°)</span>
          <input type="number" inputMode="decimal" step="any" min={-180} max={180} value={lon} onChange={(e) => setLon(e.target.value)} aria-invalid={!!err && err.startsWith("Lon")} />
        </label>
        <button type="submit" disabled={!!err}>Go</button>
      </form>
      <p className="goto-hint muted small">{err ?? "South is negative, east is positive. Heights come from LOLA only south of -80°."}</p>
    </section>
  );
}
