// Sun & Earth altitude over 30 days + play button that animates `time`. Owner: SKY3D.
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";

export default function Timeline() {
  const { baseTime, time, setTime } = useApp();
  const loc = useApp((s) => s.location());
  const [playing, setPlaying] = useState(false);
  const w = useApi(() => (loc ? api.windows(loc, baseTime.toISOString(), 30) : null), [loc?.lat, loc?.lon, baseTime.getTime()]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const t = useApp.getState().time;
      const next = new Date(t.getTime() + 6 * 3.6e6); // 6 h per tick
      setTime(next.getTime() - baseTime.getTime() > 29.53 * 864e5 ? baseTime : next);
    }, 200);
    return () => clearInterval(id);
  }, [playing, baseTime, setTime]);

  const data = (w.data?.series ?? []).map((p) => ({ ...p, t: new Date(p.time).getTime() }));

  // Operating windows: stretches where the Sun is up (power) AND Earth is in view (direct contact).
  const windows: { x1: number; x2: number }[] = [];
  let open: number | null = null;
  data.forEach((p, i) => {
    const ok = p.sun_alt > 0 && p.earth_alt > 0;
    if (ok && open == null) open = p.t;
    if (open != null && (!ok || i === data.length - 1)) { windows.push({ x1: open, x2: p.t }); open = null; }
  });
  const span = data.length ? data[data.length - 1].t - data[0].t : 0;
  const openMs = windows.reduce((s, b) => s + (b.x2 - b.x1), 0);

  return (
    <div className="panel">
      <h3>Lunar day timeline <button onClick={() => setPlaying(!playing)}>{playing ? "⏸" : "▶️"}</button></h3>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} onClick={(e) => e?.activeLabel && setTime(new Date(+e.activeLabel))}>
          <CartesianGrid stroke="#262c38" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
            tickFormatter={(t) => new Date(t).toLocaleDateString()} stroke="#8b93a3" />
          <YAxis unit="°" stroke="#8b93a3" />
          <Tooltip labelFormatter={(t) => new Date(t as number).toUTCString()} />
          {windows.map((b) => <ReferenceArea key={b.x1} x1={b.x1} x2={b.x2} fill="var(--green)" fillOpacity={0.16} stroke="none" />)}
          <ReferenceLine y={0} stroke="#8b93a3" label="horizon" />
          <ReferenceLine x={time.getTime()} stroke="#fff" />
          <Line dataKey="sun_alt" name="Sun altitude" stroke="var(--sun)" dot={false} />
          <Line dataKey="earth_alt" name="Earth altitude" stroke="var(--earth)" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="muted small">
        <i className="swatch" style={{ background: "rgba(62, 207, 142, 0.35)" }} />
        Green = operating window (Sun up and Earth in view){span > 0 && `: ${(openMs / 864e5).toFixed(1)} of ${(span / 864e5).toFixed(0)} days (${Math.round((100 * openMs) / span)}%)`}.
        {" "}Flat horizon; crater walls can shorten these.
      </div>
    </div>
  );
}
