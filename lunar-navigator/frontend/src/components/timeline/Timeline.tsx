// Sun & Earth altitude vs the terrain skyline, with sunlit stretches shaded. Click to jump in time. Owner: SKY3D.
//   A–H sites: the evaluation engine's 30-day timeline (−15 d … +15 d, 6-hour steps) from GET /api/sites/{id}
//   custom points: /api/ephemeris/windows (30 days ahead)
import { useMemo } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";

interface Row { t: number; sun: number; skyline: number; earth: number; lit: boolean }

export default function Timeline() {
  const { baseTime, time, setTime } = useApp();
  const loc = useApp((s) => s.location());
  const details = useApp((s) => s.details);
  const engine = loc?.site ? details : null;
  const w = useApi(() => (loc && !loc.site ? api.windows(loc, baseTime.toISOString(), 30) : null),
    [loc?.lat, loc?.lon, !!loc?.site, baseTime.getTime()]);

  const rows: Row[] = useMemo(() => {
    if (engine) {
      return engine.window.timeline_6h.map((s) => ({
        t: Date.parse(s.timestamp_utc), sun: s.sun_alt_deg, skyline: s.sun_horizon_deg, earth: s.earth_alt_deg, lit: s.is_sunlit,
      }));
    }
    return (w.data?.series ?? []).map((p) => ({
      t: Date.parse(p.time), sun: p.sun_alt, skyline: p.sun_horizon, earth: p.earth_alt, lit: p.sun_alt > p.sun_horizon,
    }));
  }, [engine, w.data]);

  // contiguous sunlit stretches → shaded bands
  const bands = useMemo(() => {
    const out: { x1: number; x2: number }[] = [];
    let start: number | null = null;
    rows.forEach((r, i) => {
      if (r.lit && start == null) start = r.t;
      if ((!r.lit || i === rows.length - 1) && start != null) { out.push({ x1: start, x2: r.t }); start = null; }
    });
    return out;
  }, [rows]);

  return (
    <div className="panel">
      <h3>
        Sunlight timeline{" "}
        <span className="muted small" style={{ textTransform: "none", letterSpacing: 0 }}>
          {engine ? `site ${engine.id} · ±15 days · 6-hour steps (A–H engine)` : "next 30 days"}
        </span>
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={rows} onClick={(e) => e?.activeLabel && setTime(new Date(+e.activeLabel))}>
          <CartesianGrid stroke="#262c38" />
          {bands.map((b) => <ReferenceArea key={b.x1} x1={b.x1} x2={b.x2} fill="var(--sun)" fillOpacity={0.12} stroke="none" />)}
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
            tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} stroke="#8b93a3" />
          <YAxis unit="°" stroke="#8b93a3" width={44} />
          <Tooltip labelFormatter={(t) => new Date(t as number).toUTCString().slice(5, 22) + " UTC"}
            formatter={(v: number) => `${v.toFixed(2)}°`} contentStyle={{ background: "#151922", border: "1px solid #2a3140" }} />
          <Legend />
          <ReferenceLine y={0} stroke="#8b93a3" strokeDasharray="2 3" />
          <ReferenceLine x={time.getTime()} stroke="#fff" />
          <Line dataKey="sun" name="Sun" stroke="var(--sun)" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="skyline" name="Skyline toward Sun" stroke="#c9ccd3" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line dataKey="earth" name="Earth" stroke="var(--earth)" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="muted small">Shaded = in sunlight (Sun above the skyline). White line = time on the slider.</div>
    </div>
  );
}
