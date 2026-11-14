// SELECTED SITE: status, operating window (date range), available resources, cautions. Owner: LEAD (text: GEO).
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { scoreStart } from "../../hooks/useScores";
import { fmtLat, fmtLon } from "../../lib/geo";
import { CUSTOM_LETTER } from "../../lib/letters";
import { go } from "../../router";
import { useApp } from "../../state/store";
import type { SeriesPoint, Status, Windows } from "../../types";

const STATUS: Record<Status, { mark: string; word: string }> = {
  green: { mark: "✓", word: "Good" },
  yellow: { mark: "~", word: "Workable" },
  red: { mark: "✗", word: "Risky" },
};

/** Stretches where the Sun is up AND Earth is in view: when a lander has power and can talk home. */
function operatingWindows(series: SeriesPoint[]) {
  const out: { start: string; end: string }[] = [];
  let open: string | null = null;
  for (const p of series) {
    // above the terrain skyline, not just the flat horizon
    const ok = p.sun_alt > p.sun_horizon && p.earth_alt > p.earth_horizon;
    if (ok && !open) open = p.time;
    if (!ok && open) { out.push({ start: open, end: p.time }); open = null; }
  }
  if (open) out.push({ start: open, end: series[series.length - 1].time });
  return out;
}

function cautions(w: Windows, terrainScore: number | undefined, verified: boolean | undefined) {
  const c: string[] = [];
  const maxSun = Math.max(...w.series.map((p) => p.sun_alt));
  const p0 = w.series[0];
  if (p0 && !w.sun_visible_now && p0.sun_alt <= 0) c.push("Lunar night right now. No solar power until sunrise.");
  else if (p0 && !w.sun_visible_now) c.push(`Sun is up (${p0.sun_alt.toFixed(1)}°) but hidden behind terrain ${p0.sun_horizon.toFixed(1)}° high, so this spot is in shadow.`);
  if (w.sunlit_fraction === 0) c.push("No direct sunlight at all in the next 30 days. This could be a permanently shadowed cold trap.");
  else if (w.sunlit_fraction < 0.5) c.push(`In sunlight only ${Math.round(w.sunlit_fraction * 100)}% of the next 30 days.`);
  if (maxSun > 0 && maxSun < 5) c.push(`Sun never rises above ${maxSun.toFixed(1)}°, so shadows are very long and solar panels need to stand upright.`);
  if (w.earth_visible_fraction === 0) c.push("Earth is never in view. You need a relay satellite to communicate.");
  else if (w.earth_visible_fraction < 1) c.push(`Earth is out of view ${Math.round((1 - w.earth_visible_fraction) * 100)}% of the time, so expect communication blackouts.`);
  if (terrainScore != null && terrainScore < 50) c.push("Steep ground at the landing point.");
  if (verified === false) c.push("Coordinates not yet verified by our geography lead.");
  return c;
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export default function SelectedSite({ letter }: { letter?: string }) {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const hour = hourKey(time);
  const start = scoreStart(time).toISOString();

  // windows follow the slider (hourly, keeps up while ▶ plays); score uses the same 6-hour steps as the list
  const w = useLatest(() => (loc ? api.windows(loc, hour, 30, 60) : null), `${key}|${hour}`);
  const score = useApi(() => (loc ? api.score(loc, start) : null), [key, start], 300);

  if (!loc) {
    return (
      <section className="rail-sec">
        <h2>Selected site</h2>
        <p className="muted">Click a marker on the map, pick a letter above, or click any spot on the ground.</p>
      </section>
    );
  }

  const site = loc.site;
  const st = score.data?.status;
  const windows = w.data ? operatingWindows(w.data.series) : [];
  const days = (a: string, b: string) => ((Date.parse(b) - Date.parse(a)) / 864e5).toFixed(1);

  return (
    <section className="rail-sec selected">
      <h2>Selected site</h2>
      <div className="sel-title">
        <span className="letter big">{site ? letter : CUSTOM_LETTER}</span>
        <div>
          <div className="sel-name">{site?.name ?? "Custom point"}</div>
          <div className="muted small">{fmtLat(loc.lat)}, {fmtLon(loc.lon)}</div>
        </div>
      </div>

      <dl className="facts">
        <dt>Right now</dt>
        <dd>
          {w.data?.series[0] ? (() => {
            const p = w.data.series[0];
            return (
              <ul className="plain">
                <li className={w.data.sun_visible_now ? "now-on" : "now-off"}>
                  {w.data.sun_visible_now ? "☀ In sunlight" : p.sun_alt > 0 ? "☾ In shadow (terrain blocks the Sun)" : "☾ Lunar night"}
                  <span className="muted"> · Sun {p.sun_alt.toFixed(1)}°{w.data.terrain_horizon ? `, skyline ${p.sun_horizon.toFixed(1)}°` : ""}</span>
                </li>
                <li className={w.data.earth_visible_now ? "now-on" : "now-off"}>
                  {w.data.earth_visible_now ? "📡 Earth in view" : "📡 No Earth contact"}
                  <span className="muted"> · Earth {p.earth_alt.toFixed(1)}°</span>
                </li>
              </ul>
            );
          })() : "…"}
        </dd>

        <dt>Status <span className="muted small">(landing now, next 14 days)</span></dt>
        <dd>{st ? <span className={`mark ${st}`}>{STATUS[st].mark} {STATUS[st].word}</span> : "…"}
          {score.data && <span className="muted"> · {score.data.total}/100</span>}</dd>

        <dt>Window</dt>
        <dd>
          {!w.data ? "…" : windows.length === 0 ? <span className="muted">No sunlit + Earth-in-view window in the next 30 days</span> : (
            <ul className="plain">
              {windows.slice(0, 2).map((x) => (
                <li key={x.start}>{fmt(x.start)} → {fmt(x.end)} <span className="muted">({days(x.start, x.end)} d)</span></li>
              ))}
            </ul>
          )}
        </dd>

        <dt>Available resources</dt>
        <dd>
          {site ? (
            <ul className="plain">
              <li>Water ice: <strong>{site.resources.water_ice}</strong></li>
              {site.resources.psr_distance_km != null && <li>Permanent shadow ~{site.resources.psr_distance_km} km away</li>}
              {w.data && <li>Sunlight {Math.round(w.data.sunlit_fraction * 100)}% · Earth in view {Math.round(w.data.earth_visible_fraction * 100)}%</li>}
              {site.resources.notes && !site.resources.notes.startsWith("TODO") && <li className="muted">{site.resources.notes}</li>}
            </ul>
          ) : w.data ? `Sunlight ${Math.round(w.data.sunlit_fraction * 100)}% · Earth in view ${Math.round(w.data.earth_visible_fraction * 100)}%` : "…"}
        </dd>

        <dt>Cautions</dt>
        <dd>
          {w.data ? (
            <ul className="plain cautions">
              {cautions(w.data, score.data?.terrain, site?.verified).map((c) => <li key={c}>⚠ {c}</li>)}
            </ul>
          ) : "…"}
        </dd>
      </dl>

      <div className="sel-actions">
        <button onClick={() => go.view("section")}>Cross section</button>
        <button onClick={() => go.view("3d")}>3D</button>
      </div>
    </section>
  );
}
