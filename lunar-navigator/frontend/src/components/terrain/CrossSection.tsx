// Up to 4 elevation profiles through the site, overlaid on one chart. Owner: SKY3D.
import { useState } from "react";
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { inSection, shade } from "../profile/profileMath";

const COLORS = ["#ffcc4d", "#4da3ff", "#3ecf8e", "#ef5a5a"];
const DIRS = [0, 45, 90, 135];

export default function CrossSection() {
  const loc = useApp((s) => s.location());
  const time = useApp((s) => s.time);
  const [azimuths, setAz] = useState<number[]>([0, 90]);
  const res = useApi(
    () => (loc ? api.crossSection(loc, azimuths.map((a) => ({ azimuth: a, length_km: 10 }))) : null),
    [loc?.lat, loc?.lon, azimuths.join()],
  );

  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [loc?.lat, loc?.lon, time.getTime()]);
  const sunNow = state.data?.sun;

  // Sun ray: on the first profile, the line a sunbeam follows after it grazes the highest ground toward the Sun.
  // Ground under that line is in shadow. (Same maths as the A–A′ slice, see profileMath.ts.)
  const first = res.data?.profiles[0];
  const ray = first && sunNow && sunNow.altitude > 0
    ? shade({ x: first.distance_m, z: first.elevation_m }, inSection(sunNow.altitude, sunNow.azimuth, first.azimuth))
    : null;
  const shadedPct = ray ? Math.round((100 * ray.lit.filter((l) => !l).length) / ray.lit.length) : null;

  // merge profiles into rows keyed by distance for recharts
  const rows = res.data?.profiles[0]?.distance_m.map((d, i) => {
    const row: Record<string, number> = { km: +(d / 1000).toFixed(2) };
    res.data!.profiles.forEach((p) => (row[`az${p.azimuth}`] = p.elevation_m[i]));
    if (ray && !ray.lit[i]) row.ray = +ray.top[i].toFixed(1); // only drawn where it is above the ground
    return row;
  }) ?? [];

  return (
    <div className="panel" style={{ flex: 1, minWidth: 360 }}>
      <h3>Cross sections</h3>
      <div className="tabs">
        {DIRS.map((a) => (
          <button key={a} className={azimuths.includes(a) ? "active" : ""}
            onClick={() => setAz(azimuths.includes(a) ? azimuths.filter((x) => x !== a) : [...azimuths, a])}>
            {a}°
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={rows}>
          <XAxis dataKey="km" unit=" km" stroke="#8b93a3" />
          <YAxis unit=" m" stroke="#8b93a3" />
          <Tooltip />
          <Legend />
          {azimuths.map((a, i) => <Line key={a} dataKey={`az${a}`} name={`${a}°`} stroke={COLORS[i]} dot={false} isAnimationActive={false} />)}
          {ray && first && <Line dataKey="ray" name={`Sun ray on ${first.azimuth}°`} stroke="var(--sun)" strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      {first && sunNow && (
        <div className="muted small">
          {sunNow.altitude > 0
            ? `Dashed line = sun ray along the ${first.azimuth}° profile (Sun ${sunNow.altitude.toFixed(1)}° high). Ground below it is in shadow: ${shadedPct}% of this profile.`
            : "The Sun is below the horizon right now, so there is no sun ray to draw."}
        </div>
      )}
      <ExplainCard text={explain.crossSection} />
    </div>
  );
}
