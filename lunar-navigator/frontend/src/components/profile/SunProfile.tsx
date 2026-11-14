// Sunlight & shadow along a slice through the site, across one lunar day. Owner: SKY3D.
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { compass } from "../../lib/geo";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { inSection, nearestIndex, shade, stitch, sunHours } from "./profileMath";

const W = 1000;
const TOP = 120; // room above the terrain for the Sun and its rays
const BOTTOM = 26;
const LUNAR_DAY_DAYS = 29.53;

/** `letter` labels the slice ends (A … A′) and the site in the middle, as in the team sketch. */
export default function SunProfile({ letter = "A" }: { letter?: string }) {
  const { time, setTime, baseTime, setBaseTime } = useApp();
  const details = useApp((s) => s.details); // A–H engine verdict for the selected site (null for custom points)
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";

  const [manualBearing, setBearing] = useState(20);
  const [followSun, setFollowSun] = useState(true); // system_arch.md: A–A′ runs along the Sun's ray
  const [lengthKm, setLengthKm] = useState(8);
  const [exag, setExag] = useState(1);
  const [playing, setPlaying] = useState(false);

  const seasons = useApi(() => api.seasons(new Date().toISOString()), [], 0);
  const series = useApi(() => (loc ? api.windows(loc, baseTime.toISOString(), LUNAR_DAY_DAYS, 60) : null),
    [key, baseTime.getTime()], 0);

  const pts = series.data?.series ?? [];
  const idx = pts.length ? nearestIndex(pts, time) : 0;
  const now = pts[idx];

  // Following the Sun: A′ (away from the Sun) → site → A (toward the Sun). Snapped to 5° so the slice
  // isn't refetched every hour of slider movement.
  const bearing = followSun && now ? (Math.round(now.sun_az / 5) * 5) % 360 : manualBearing;
  const section = useApi(() => (loc ? api.crossSection(loc, [
    { azimuth: (bearing + 180) % 360, length_km: lengthKm },
    { azimuth: bearing, length_km: lengthKm },
  ]) : null), [key, bearing, lengthKm], 120);

  // Play: step through the lunar day (1 sample = 1 hour).
  useEffect(() => {
    if (!playing || !pts.length) return;
    const id = setInterval(() => {
      const i = nearestIndex(pts, useApp.getState().time);
      setTime(new Date(pts[(i + 1) % pts.length].time));
    }, 60);
    return () => clearInterval(id);
  }, [playing, pts, setTime]);

  const slice = useMemo(() => {
    const p = section.data?.profiles;
    return p && p.length === 2 ? stitch(p[0], p[1]) : null;
  }, [section.data]);

  const sun = now ? inSection(now.sun_alt, now.sun_az, bearing) : null;
  const shadeNow = useMemo(() => (slice && sun ? shade(slice, sun) : null), [slice, sun?.tanA, sun?.up, sun?.sunRight]);
  const hours = useMemo(() => (slice && pts.length ? sunHours(slice, pts, bearing) : null), [slice, pts, bearing]);

  // ---------- geometry → pixels ----------
  const draw = useMemo(() => {
    if (!slice || !shadeNow) return null;
    const L = lengthKm * 1000;
    const pxPerM = W / (2 * L);
    const vpm = pxPerM * exag;
    const zmin = Math.min(...slice.z), zmax = Math.max(...slice.z);
    const groundH = Math.max(60, (zmax - zmin) * vpm);
    const H = TOP + groundH + BOTTOM;
    const X = (x: number) => (x + L) * pxPerM;
    const Y = (z: number) => TOP + (zmax - z) * vpm;
    const n = slice.x.length;

    const groundLine = slice.x.map((x, i) => `${X(x).toFixed(1)},${Y(slice.z[i]).toFixed(1)}`);
    const groundFill = `M0,${H} L${groundLine.join(" L")} L${W},${H} Z`;

    const airTop = slice.x.map((x, i) => `${X(x).toFixed(1)},${Y(shadeNow.top[i]).toFixed(1)}`);
    const air = `M${airTop.join(" L")} L${groundLine.slice().reverse().join(" L")} Z`;

    // sunlit / shaded runs of the ground line
    const runs: { lit: boolean; d: string }[] = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || shadeNow.lit[i] !== shadeNow.lit[start]) {
        runs.push({ lit: shadeNow.lit[start], d: `M${groundLine.slice(start, Math.min(i + 1, n)).join(" L")}` });
        start = i;
      }
    }

    // rays: aimed at the edges that cast shadows (lit point whose down-sun neighbour is dark)
    const rays: { x1: number; y1: number; x2: number; y2: number }[] = [];
    let sunXY: { x: number; y: number } | null = null;
    if (sun?.up) {
      const theta = Math.atan(Number.isFinite(sun.tanA) ? sun.tanA * exag : 1e9);
      const dir = sun.sunRight ? 1 : -1;
      const step = sun.sunRight ? -1 : 1; // direction shadows fall
      const casters: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = i + step;
        if (shadeNow.lit[i] && j >= 0 && j < n && !shadeNow.lit[j]) casters.push(i);
      }
      if (!casters.length) for (let q = 1; q <= 3; q++) casters.push(Math.floor((q * n) / 4));
      const len = 170;
      for (const i of casters.slice(0, 4)) {
        const x1 = X(slice.x[i]), y1 = Y(slice.z[i]);
        rays.push({ x1, y1, x2: x1 + dir * len * Math.cos(theta), y2: y1 - len * Math.sin(theta) });
      }
      const cx = W / 2, cy = Y((zmin + zmax) / 2);
      const d = (cy - 34) / Math.max(Math.sin(theta), 1e-3);
      sunXY = { x: Math.min(W - 30, Math.max(30, cx + dir * d * Math.cos(theta))), y: 34 };
    }

    return { H, X, groundFill, air, runs, rays, sunXY };
  }, [slice, shadeNow, lengthKm, exag, sun?.up, sun?.tanA, sun?.sunRight]);

  const shadePct = shadeNow ? Math.round((100 * shadeNow.lit.filter((l) => !l).length) / shadeNow.lit.length) : null;
  const maxH = hours ? Math.max(...hours) : 0;
  const totalH = pts.length ? (Date.parse(pts[pts.length - 1].time) - Date.parse(pts[0].time)) / 3.6e6 : 0;
  const dayN = now ? (Date.parse(now.time) - Date.parse(pts[0].time)) / 864e5 : 0;

  return (
    <div className="panel profile">
      <h3>Cross section {letter}–{letter}′: sunlight along a slice through the site {section.data?.synthetic && <small>(synthetic terrain)</small>}</h3>

      {draw && slice ? (
        <svg viewBox={`0 0 ${W} ${draw.H}`} width="100%" role="img"
          aria-label={`Terrain slice from ${compass(bearing + 180)} to ${compass(bearing)}. ${shadePct}% in shade.`}>
          {draw.rays.map((r, i) => <line key={i} {...r} stroke="var(--sun)" strokeOpacity={0.55} strokeWidth={1.2} />)}
          {draw.sunXY && <circle cx={draw.sunXY.x} cy={draw.sunXY.y} r={17} fill="var(--sun)" />}
          {!sun?.up && (
            <text x={W / 2} y={44} textAnchor="middle" fill="var(--muted)" fontSize={18}>
              🌑 The Sun is below the horizon: lunar night here
            </text>
          )}
          <path d={draw.groundFill} fill="var(--ground)" />
          <path d={draw.air} fill="var(--shadow-air)" />
          {draw.runs.map((r, i) => (
            <path key={i} d={r.d} fill="none" stroke={r.lit ? "var(--sun)" : "var(--shade)"} strokeWidth={3.5} strokeLinejoin="round" />
          ))}
          {/* the landing site */}
          <line x1={draw.X(0)} x2={draw.X(0)} y1={TOP - 30} y2={draw.H} stroke="var(--text)" strokeDasharray="3 4" strokeOpacity={0.5} />
          <text x={draw.X(0)} y={TOP - 36} textAnchor="middle" fontSize={14} fill="var(--text)">▼ {letter}</text>
          {/* slice ends, A and A′ */}
          {/* system_arch.md: A′ = away from the Sun, A = toward the Sun (right end = bearing direction) */}
          {[{ x: 1.5, t: `${letter}′`, a: "start" }, { x: W - 1.5, t: letter, a: "end" }].map((e) => (
            <g key={e.t}>
              <line x1={e.x} x2={e.x} y1={TOP - 54} y2={draw.H} stroke="var(--text)" strokeWidth={2} />
              <text x={e.a === "start" ? e.x + 8 : e.x - 8} y={TOP - 40} textAnchor={e.a} fontSize={18} fontWeight={700} fill="var(--text)">{e.t}</text>
            </g>
          ))}
        </svg>
      ) : (
        <div className="profile-loading">{section.error || series.error || "Loading terrain and Sun positions…"}</div>
      )}

      {hours && slice && (
        <>
          <svg viewBox={`0 0 ${W} 18`} width="100%" preserveAspectRatio="none" aria-hidden>
            {hours.map((h, i) => (
              <rect key={i} x={(i * W) / hours.length} width={W / hours.length + 0.6} height={18}
                fill="var(--sun)" fillOpacity={maxH ? 0.1 + 0.9 * (h / maxH) : 0.1} />
            ))}
          </svg>
          <div className="profile-axis">
            <span><b>{letter}′</b> · {compass(bearing + 180)} · −{lengthKm} km</span>
            <span>
              Direct sun over this lunar day: up to {maxH.toFixed(0)} h of {totalH.toFixed(0)} h
              ({totalH ? Math.round((100 * maxH) / totalH) : 0}%) · stronger colour = more
            </span>
            <span>+{lengthKm} km · {compass(bearing)} · <b>{letter}</b></span>
          </div>
        </>
      )}

      <div className="profile-legend">
        <span><i className="line sun" />Sunlit ground</span>
        <span><i className="line shade" />Shaded ground</span>
        <span><i className="swatch air" />Shadow in the air</span>
        <span>{exag === 1 ? "Drawn 1:1, no vertical exaggeration" : `Heights exaggerated ×${exag}`}</span>
      </div>

      <div className="profile-stats">
        <PlanView bearing={bearing} sunAz={now?.sun_az} sunUp={!!sun?.up} />
        <div className="stats">
          <Stat label="Sun elevation" value={now ? `${now.sun_alt.toFixed(1)}°` : "…"} sub="geometric, at the slider time" />
          <Stat label="Sun azimuth" value={now ? `${now.sun_az.toFixed(0)}° (${compass(now.sun_az)})` : "…"} />
          <Stat label="Apparent angle in slice" value={sun ? (sun.up ? `${sun.apparent.toFixed(1)}°` : "below horizon") : "…"} />
          <Stat label="Slice in shade" value={shadePct != null ? `${shadePct}%` : "…"} />
          {details ? (
            <Stat label="Earth contact" value={details.visibility.has_earth_comm ? "in view · contact ✓" : "blocked · relay needed"}
              sub={`A–H engine, ${details.query_timestamp_utc.slice(11, 16)} UTC (incl. +${details.ephemeris.relief_dip_deg}° for site height)`} />
          ) : (
            <Stat label="Earth" value={now ? (now.earth_alt > now.earth_horizon ? `${now.earth_alt.toFixed(1)}° up · contact ✓` : "below skyline · no contact") : "…"} />
          )}
          <Stat label="Moment" value={now ? `Day ${dayN.toFixed(1)} of ${LUNAR_DAY_DAYS}` : "…"} sub={now ? new Date(now.time).toUTCString().slice(5, 22) + " UTC" : ""} />
        </div>
      </div>

      <div className="controls">
        <label>Lunar season</label>
        <div className="seasons">
          {(seasons.data ?? []).map((s) => {
            const active = Math.abs(Date.parse(s.time) - baseTime.getTime()) < 3.6e6;
            return (
              <button key={s.key} className={active ? "active" : ""} onClick={() => setBaseTime(new Date(s.time))}
                title={`Sun over ${Math.abs(s.subsolar_lat).toFixed(2)}° ${s.subsolar_lat < 0 ? "S" : "N"}`}>
                {s.name}<small>{new Date(s.time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small>
              </button>
            );
          })}
        </div>

        <label htmlFor="t">Time in lunar day</label>
        <div className="ctl">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <input id="t" type="range" min={0} max={Math.max(0, pts.length - 1)} value={idx}
            onChange={(e) => pts.length && setTime(new Date(pts[+e.target.value].time))} />
          <output>Day {dayN.toFixed(1)}</output>
        </div>

        <label htmlFor="b">Slice direction</label>
        <div className="ctl">
          <label className="follow">
            <input type="checkbox" checked={followSun} onChange={(e) => { setFollowSun(e.target.checked); setBearing(bearing); }} />
            Follow the Sun
          </label>
          <input id="b" type="range" min={0} max={359} value={bearing} disabled={followSun}
            onChange={(e) => setBearing(+e.target.value)} />
          <output>{compass(bearing + 180)} to {compass(bearing)}, {bearing}°</output>
        </div>

        <label htmlFor="l">Slice length</label>
        <div className="ctl">
          <input id="l" type="range" min={2} max={15} value={lengthKm} onChange={(e) => setLengthKm(+e.target.value)} />
          <output>{2 * lengthKm} km</output>
        </div>

        <label>Height scale</label>
        <div className="tabs">
          {[1, 2, 5, 10].map((e) => (
            <button key={e} className={exag === e ? "active" : ""} onClick={() => setExag(e)}>{e === 1 ? "1:1" : `×${e}`}</button>
          ))}
        </div>
      </div>

      <ExplainCard text={explain.profile} />
      {/* TODO(SKY3D): Earth line-of-sight shading (same maths with earth_alt / earth_az) for a comms view */}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Top-down compass: the slice as an arrow, the Sun as a dot on its azimuth. */
function PlanView({ bearing, sunAz, sunUp }: { bearing: number; sunAz?: number; sunUp: boolean }) {
  const p = (az: number, r: number) => ({ x: r * Math.sin((az * Math.PI) / 180), y: -r * Math.cos((az * Math.PI) / 180) });
  const a = p(bearing, 62), b = p(bearing + 180, 62);
  const s = sunAz != null ? p(sunAz, 52) : null;
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
            <line x1={0} y1={0} x2={s.x} y2={s.y} stroke="var(--sun)" strokeDasharray="3 3" />
            <circle cx={s.x} cy={s.y} r={7} fill={sunUp ? "var(--sun)" : "none"} stroke="var(--sun)" strokeWidth={2} />
          </>
        )}
      </svg>
      <figcaption>Plan view</figcaption>
    </figure>
  );
}
