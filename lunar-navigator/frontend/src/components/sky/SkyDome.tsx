// Sky above the site: center = straight up, edge = horizon, N at top. Owner: SKY3D.
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";

const R = 100;
const LUNAR_DAY_DAYS = 29.53;
const toXY = (alt: number, az: number) => {
  const r = R * (1 - Math.max(alt, -10) / 90); // below horizon drawn just outside the circle
  const a = (az * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
};

export default function SkyDome() {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const mode = useApp((s) => s.mode);
  const { data } = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [loc?.lat, loc?.lon, time.getTime()]);

  // Where the Sun and Earth travel over the lunar day that starts at the chosen date.
  const baseTime = useApp((s) => s.baseTime);
  const win = useApi(() => (loc ? api.windows(loc, baseTime.toISOString(), LUNAR_DAY_DAYS, 120) : null),
    [loc?.lat, loc?.lon, baseTime.getTime()]);
  const path = (alt: "sun_alt" | "earth_alt", az: "sun_az" | "earth_az") =>
    (win.data?.series ?? []).map((p) => { const q = toXY(p[alt], p[az]); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");

  const sun = data && toXY(data.sun.altitude, data.sun.azimuth);
  const earth = data && toXY(data.earth.altitude, data.earth.azimuth);

  return (
    <div className="panel" style={{ width: 280 }}>
      <h3>Sky at site</h3>
      <svg viewBox="-125 -125 250 250" width="100%">
        <circle r={R} fill="#0e1830" stroke="#556" />
        {[30, 60].map((alt) => <circle key={alt} r={R * (1 - alt / 90)} fill="none" stroke="#334" strokeDasharray="2 3" />)}
        {["N", "E", "S", "W"].map((l, i) => {
          const p = toXY(-12, i * 90);
          return <text key={l} x={p.x} y={p.y + 4} fill="#889" fontSize="11" textAnchor="middle">{l}</text>;
        })}
        {win.data && (
          <>
            <polyline points={path("sun_alt", "sun_az")} fill="none" stroke="var(--sun)" strokeWidth={1.2} strokeDasharray="1 4" strokeLinecap="round" />
            <polyline points={path("earth_alt", "earth_az")} fill="none" stroke="var(--earth)" strokeWidth={1.2} strokeDasharray="1 4" strokeLinecap="round" />
          </>
        )}
        {sun && <text x={sun.x} y={sun.y + 6} fontSize="18" textAnchor="middle" opacity={data!.sun.altitude > 0 ? 1 : 0.3}>☀️</text>}
        {earth && <text x={earth.x} y={earth.y + 6} fontSize="18" textAnchor="middle" opacity={data!.earth.altitude > 0 ? 1 : 0.3}>🌍</text>}
      </svg>
      {data && mode === "expert" && (
        <table>
          <tbody>
            <tr><td>Sun</td><td>alt {data.sun.altitude.toFixed(2)}°</td><td>az {data.sun.azimuth.toFixed(1)}°</td></tr>
            <tr><td>Earth</td><td>alt {data.earth.altitude.toFixed(2)}°</td><td>az {data.earth.azimuth.toFixed(1)}°</td></tr>
            <tr><td colSpan={3}>Earth lit {(data.earth_phase_illum * 100).toFixed(0)}% · Moon from Earth: {data.moon_phase_name}</td></tr>
          </tbody>
        </table>
      )}
      <div className="muted small">Dotted lines: path of the <span style={{ color: "var(--sun)" }}>Sun</span> and <span style={{ color: "var(--earth)" }}>Earth</span> over this lunar day. Outside the circle = below the horizon.</div>
      <ExplainCard text={explain.skyDome} />
    </div>
  );
}
