// Top-down mini-map: the slice line on the terrain, with the Sun's direction and the shadows. Owner: LEAD.
export interface SliceMiniMapProps {
  loc: { lat: number; lon: number } | null;
  sliceAzimuth: number; // direction the A end of the slice points (deg clockwise from north)
  lengthKm: number; // reach of the slice each way from the lander
  letter: string; // label of the slice ends: A and A′
  body: "sun" | "earth";
  bodyAlt: number | null; // altitude of that body at the lander (deg above the lander's level), null if unknown
  bodyAz: number | null; // its azimuth (deg clockwise from north)
  bodyInView: boolean; // ray-traced answer for the lander
  observerM: number; // eye height used by the ray tracing (m)
  color: string; // CSS colour of the active body
  onPickAzimuth?: (azimuth: number) => void; // the user chose a slice direction on the map
}

/** Placeholder until the map is built: the plan-view compass the panel had before. */
export default function SliceMiniMap({ sliceAzimuth, bodyAz, bodyInView, color }: SliceMiniMapProps) {
  const p = (az: number, r: number) => ({ x: r * Math.sin((az * Math.PI) / 180), y: -r * Math.cos((az * Math.PI) / 180) });
  const a = p(sliceAzimuth, 62), b = p(sliceAzimuth + 180, 62);
  const s = bodyAz != null ? p(bodyAz, 52) : null;
  return (
    <figure className="planview">
      <svg viewBox="-80 -92 160 172" width={150}>
        <text y={-78} textAnchor="middle" fontSize={13} fill="var(--text)">N</text>
        <circle r={68} fill="none" stroke="var(--line)" />
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
          </marker>
        </defs>
        <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke="var(--text)" strokeWidth={2} markerEnd="url(#arrow)" />
        {s && (
          <>
            <line x1={0} y1={0} x2={s.x} y2={s.y} stroke={color} strokeDasharray="3 3" />
            <circle cx={s.x} cy={s.y} r={7} fill={bodyInView ? color : "none"} stroke={color} strokeWidth={2} />
          </>
        )}
      </svg>
      <figcaption>Plan view</figcaption>
    </figure>
  );
}
