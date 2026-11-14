// Bottom of the rail: live coordinates under the cursor, or the selected point. Owner: MAP.
import { fmtLat, fmtLon } from "../../lib/geo";
import { useApp } from "../../state/store";

export default function CoordsBar({ cursor }: { cursor: { lat: number; lon: number } | null }) {
  const loc = useApp((s) => s.location());
  const p = cursor ?? loc;
  return (
    <section className="rail-sec coords" aria-live="off">
      <span className="muted">{cursor ? "Cursor" : "Selected"}</span>
      <span className="coord-val">{p ? `${fmtLat(p.lat)}  ${fmtLon(p.lon)}` : "—"}</span>
    </section>
  );
}
