// Sky above the site: center = straight up, edge = horizon, N at top. Owner: SKY3D.
//   A–H sites: Sun/Earth and the 360° terrain skyline come from the evaluation engine (GET /api/sites/{id}),
//              the same numbers its GO / NO-GO decision uses.
//   custom points: Sun/Earth from /api/ephemeris/state (flat horizon).
//   Dotted paths: where the Sun and Earth travel over the lunar day that starts at the chosen date.
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";

const R = 100;
const MIN_ALT = -10;
const LUNAR_DAY_DAYS = 29.53;
const toXY = (alt: number, az: number) => {
  const r = R * (1 - Math.max(alt, MIN_ALT) / 90); // below horizon drawn just outside the circle
  const a = (az * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
};

export default function SkyDome() {
  const time = useApp((s) => s.time);
  const baseTime = useApp((s) => s.baseTime);
  const loc = useApp((s) => s.location());
  const mode = useApp((s) => s.mode);
  const details = useApp((s) => s.details);
  const engine = loc?.site ? details : null;
  const ours = useApi(() => (loc && !loc.site ? api.state(loc, time.toISOString()) : null), [loc?.lat, loc?.lon, !!loc?.site, time.getTime()]);
  const win = useApi(() => (loc ? api.windows(loc, baseTime.toISOString(), LUNAR_DAY_DAYS, 120) : null),
    [loc?.lat, loc?.lon, baseTime.getTime()]);

  // The engine raises angles for high sites (you see past the flat horizon from a peak); apply the same
  // shift to the paths so the ☀/🌍 icons sit on them.
  const dip = engine?.ephemeris.relief_dip_deg ?? 0;
  const path = (alt: "sun_alt" | "earth_alt", az: "sun_az" | "earth_az") =>
    (win.data?.series ?? []).map((p) => { const q = toXY(p[alt] + dip, p[az]); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");

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
  const rr = R * (1 - MIN_ALT / 90);
  const ring = `M0,${-rr}A${rr},${rr} 0 1 0 0.01,${-rr}Z`;

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
        {win.data && (
          <>
            <polyline points={path("sun_alt", "sun_az")} fill="none" stroke="var(--sun)" strokeWidth={1.2} strokeDasharray="1 4" strokeLinecap="round" />
            <polyline points={path("earth_alt", "earth_az")} fill="none" stroke="var(--earth)" strokeWidth={1.2} strokeDasharray="1 4" strokeLinecap="round" />
          </>
        )}
        {sun && <circle cx={sun.x} cy={sun.y} r={5} fill="#ffe5aa" stroke="#f8c56d" strokeWidth={1.5} opacity={sunLit ? 1 : 0.35} />}
        {earth && <circle cx={earth.x} cy={earth.y} r={5} fill="#87c4ee" stroke="#4da3ff" strokeWidth={1.5} opacity={earthUp ? 1 : 0.35} />}
      </svg>
      {engine && (
        <div className="muted small">
          Gray = terrain skyline around site {engine.id}. ☀ {sunLit ? "clears" : "is below"} it by {Math.abs(engine.visibility.sun_margin_deg).toFixed(1)}°
          {" "}· at {engine.query_timestamp_utc.slice(11, 16)} UTC
        </div>
      )}
      <div className="muted small">Dotted lines: path of the <span style={{ color: "var(--sun)" }}>Sun</span> and <span style={{ color: "var(--earth)" }}>Earth</span> over this lunar day. Outside the circle = below the horizon.</div>
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
