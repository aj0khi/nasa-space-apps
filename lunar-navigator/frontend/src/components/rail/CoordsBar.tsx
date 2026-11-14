// Bottom of the rail: live coordinates under the cursor, or the selected point (+ elevation for A–H). Owner: MAP.
import { fmtLat, fmtLon } from "../../lib/geo";
import { useApp } from "../../state/store";

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
