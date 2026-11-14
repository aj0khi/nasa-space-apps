// Sky above the site: center = straight up, edge = horizon, N at top. Owner: SKY3D.
//   A–H sites: Sun/Earth and the 360° terrain skyline come from the evaluation engine (GET /api/sites/{id}),
//              the same numbers its GO / NO-GO decision uses.
//   custom points: Sun/Earth from /api/ephemeris/state (flat horizon).
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";

const R = 100;
const MIN_ALT = -10;
const toXY = (alt: number, az: number) => {
  const r = R * (1 - Math.max(alt, MIN_ALT) / 90); // below horizon drawn just outside the circle
  const a = (az * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
};

export default function SkyDome() {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const mode = useApp((s) => s.mode);
  const details = useApp((s) => s.details);
  const engine = loc?.site ? details : null;
  const ours = useApi(() => (loc && !loc.site ? api.state(loc, time.toISOString()) : null), [loc?.lat, loc?.lon, !!loc?.site, time.getTime()]);

  const sunPos = engine
    ? { alt: engine.ephemeris.sun.elevation_deg, az: engine.ephemeris.sun.azimuth_deg }
    : ours.data && { alt: ours.data.sun.altitude, az: ours.data.sun.azimuth };
  const earthPos = engine
    ? { alt: engine.ephemeris.earth.elevation_deg, az: engine.ephemeris.earth.azimuth_deg }
    : ours.data && { alt: ours.data.earth.altitude, az: ours.data.earth.azimuth };
  const sunLit = engine ? engine.visibility.is_sunlit : (sunPos?.alt ?? 0) > 0;
  const earthUp = engine ? engine.visibility.has_earth_comm : (earthPos?.alt ?? 0) > 0;

  // terrain skyline polygon (ground fills from the skyline out to the edge)
  const skyline = engine?.horizon_angles_deg.map((h, az) => toXY(h, az));
  const skylinePath = skyline && `M${skyline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`;
  const ring = `M0,${-R * (1 - MIN_ALT / 90)}A${R * (1 - MIN_ALT / 90)},${R * (1 - MIN_ALT / 90)} 0 1 0 0.01,${-R * (1 - MIN_ALT / 90)}Z`;

  const sun = sunPos && toXY(sunPos.alt, sunPos.az);
  const earth = earthPos && toXY(earthPos.alt, earthPos.az);

  return (
    <div className="panel" style={{ width: 280 }}>
      <h3>Sky at site</h3>
      <svg viewBox="-125 -125 250 250" width="100%" role="img"
        aria-label={sunPos ? `Sun ${sunPos.alt.toFixed(1)} degrees up at azimuth ${sunPos.az.toFixed(0)}, ${sunLit ? "visible" : "blocked"}` : "loading"}>
        <circle r={R} fill="#0e1830" stroke="#556" />
        {skylinePath && <path d={`${ring} ${skylinePath}`} fill="#4a4c53" fillRule="evenodd" opacity={0.9} />}
        {skylinePath && <path d={skylinePath} fill="none" stroke="#c9ccd3" strokeWidth={1} />}
        {[30, 60].map((alt) => <circle key={alt} r={R * (1 - alt / 90)} fill="none" stroke="#334" strokeDasharray="2 3" />)}
        {["N", "E", "S", "W"].map((l, i) => {
          const p = toXY(-14, i * 90);
          return <text key={l} x={p.x} y={p.y + 4} fill="#889" fontSize="11" textAnchor="middle">{l}</text>;
        })}
        {sun && <text x={sun.x} y={sun.y + 6} fontSize="18" textAnchor="middle" opacity={sunLit ? 1 : 0.35}>☀️</text>}
        {earth && <text x={earth.x} y={earth.y + 6} fontSize="18" textAnchor="middle" opacity={earthUp ? 1 : 0.35}>🌍</text>}
      </svg>
      {engine && (
        <div className="muted small">
          Gray = terrain skyline around site {engine.id}. ☀ {sunLit ? "clears" : "is below"} it by {Math.abs(engine.visibility.sun_margin_deg).toFixed(1)}°
          {" "}· at {engine.query_timestamp_utc.slice(11, 16)} UTC
        </div>
      )}
      {mode === "expert" && sunPos && earthPos && (
        <table>
          <tbody>
            <tr><td>Sun</td><td>alt {sunPos.alt.toFixed(2)}°</td><td>az {sunPos.az.toFixed(1)}°</td></tr>
            <tr><td>Earth</td><td>alt {earthPos.alt.toFixed(2)}°</td><td>az {earthPos.az.toFixed(1)}°</td></tr>
            {ours.data && <tr><td colSpan={3}>Earth lit {(ours.data.earth_phase_illum * 100).toFixed(0)}% · Moon from Earth: {ours.data.moon_phase_name}</td></tr>}
          </tbody>
        </table>
      )}
      <ExplainCard text={explain.skyDome} />
    </div>
  );
}
