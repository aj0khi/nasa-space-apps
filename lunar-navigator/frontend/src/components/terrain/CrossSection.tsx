// Up to 4 elevation profiles through the site, overlaid on one chart. Owner: SKY3D.
import { useState } from "react";
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";

const COLORS = ["#ffcc4d", "#4da3ff", "#3ecf8e", "#ef5a5a"];
const DIRS = [0, 45, 90, 135];

export default function CrossSection() {
  const loc = useApp((s) => s.location());
  const [azimuths, setAz] = useState<number[]>([0, 90]);
  const res = useApi(
    () => (loc ? api.crossSection(loc, azimuths.map((a) => ({ azimuth: a, length_km: 10 }))) : null),
    [loc?.lat, loc?.lon, azimuths.join()],
  );

  // merge profiles into rows keyed by distance for recharts
  const rows = res.data?.profiles[0]?.distance_m.map((d, i) => {
    const row: Record<string, number> = { km: +(d / 1000).toFixed(2) };
    res.data!.profiles.forEach((p) => (row[`az${p.azimuth}`] = p.elevation_m[i]));
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
          {azimuths.map((a, i) => <Line key={a} dataKey={`az${a}`} name={`${a}°`} stroke={COLORS[i]} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
      <ExplainCard text={explain.crossSection} />
      {/* TODO(SKY3D): draw the sun ray at the current sun altitude to show where shadows start */}
    </div>
  );
}
