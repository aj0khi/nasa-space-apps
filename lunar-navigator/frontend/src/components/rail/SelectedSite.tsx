// SELECTED SITE: status, window (date range), available resources, cautions. Owner: LEAD (text: GEO).
//   A–H sites  → the evaluation engine: GET /api/sites/{id} (backend/evaluator.py), via store.details
//   any other clicked point → lunar-navigator/backend: /api/ephemeris/windows + /api/score
import { useState } from "react";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { fmtUtc, hourKey, parseEngineUtc, sixHourKey, useLatest } from "../../hooks/useLatest";
import { fmtLat, fmtLon } from "../../lib/geo";
import { go } from "../../router";
import { normLon, useApp } from "../../state/store";
import type { HorizonsCheck, SeriesPoint, SiteDetails, Status, Windows } from "../../types";
import { STATUS_UI, sourceLabel } from "./LandingList";

export default function SelectedSite({ loading }: { loading: boolean }) {
  const loc = useApp((s) => s.location());
  const details = useApp((s) => s.details);

  if (!loc) {
    return (
      <section className="rail-sec selected">
        <h2>Selected site</h2>
        <p className="muted">Click a marker on the map, pick a letter above, or click any spot on the ground.</p>
      </section>
    );
  }
  if (loc.site) return <EngineSiteCard d={details} fallbackName={loc.site.name} id={loc.site.id} loading={loading} />;
  return <CustomPointCard lat={loc.lat} lon={loc.lon} />;
}

function Actions() {
  return (
    <div className="sel-actions">
      <button onClick={() => go.view("section")}>Cross section</button>
      <button onClick={() => go.view("3d")}>3D</button>
      <button onClick={() => go.view("compare")}>Compare</button>
    </div>
  );
}

// ------------------------------------------------------------------ A–H (evaluation engine)
function EngineSiteCard({ d, id, fallbackName, loading }: { d: SiteDetails | null; id: string; fallbackName: string; loading: boolean }) {
  const mode = useApp((s) => s.mode);
  const time = useApp((s) => s.time);
  const [check, setCheck] = useState<HorizonsCheck | "loading" | { error: string } | null>(null);

  const header = (
    <>
      <h2>Selected site {loading && <span className="spinner" aria-label="updating" />}</h2>
      <div className="sel-title">
        <span className="letter big">{id}</span>
        <div>
          <div className="sel-name">{d?.name ?? fallbackName}</div>
          {d && <div className="muted small">{d.region} · {d.mission_context}</div>}
        </div>
      </div>
    </>
  );
  if (!d) return <section className="rail-sec selected">{header}<p className="muted">Loading site evaluation…</p><Actions /></section>;

  const ui = STATUS_UI[d.status];
  const w = d.window;
  const v = d.visibility;
  const sun = d.ephemeris.sun;
  const earth = d.ephemeris.earth;
  const runCheck = async () => {
    setCheck("loading");
    try { setCheck(await api.horizonsValidate(d.id, sixHourKey(time))); } catch (e) { setCheck({ error: String(e) }); }
  };

  return (
    <section className="rail-sec selected">
      {header}
      <dl className="facts">
        <dt>Right now <span className="muted small">({d.query_timestamp_utc.slice(5, 16).replace("T", " ")} UTC)</span></dt>
        <dd>
          <ul className="plain">
            <li className={v.is_sunlit ? "now-on" : "now-off"}>
              {v.is_sunlit ? "☀ In sunlight" : "☾ In shadow"}
              <span className="muted"> · Sun {sun.elevation_deg.toFixed(1)}° vs skyline {v.sun_horizon_deg.toFixed(1)}° ({v.sun_margin_deg >= 0 ? "+" : ""}{v.sun_margin_deg.toFixed(1)}°)</span>
            </li>
            {d.ephemeris.relief_dip_deg !== 0 && (
              <li className="muted small">
                Angles include {d.ephemeris.relief_dip_deg > 0 ? "+" : ""}{d.ephemeris.relief_dip_deg}° because the site sits {Math.round(d.coordinates.elevation_m).toLocaleString()} m
                {d.coordinates.elevation_m >= 0 ? " up: from high ground you see past the flat horizon." : " down."}
              </li>
            )}
            <li className={v.has_earth_comm ? "now-on" : "now-off"}>
              {v.has_earth_comm ? "📡 Earth in view" : "📡 No Earth contact"}
              <span className="muted"> · Earth {earth.elevation_deg.toFixed(1)}° vs skyline {v.earth_horizon_deg.toFixed(1)}°</span>
            </li>
          </ul>
        </dd>

        <dt>Status</dt>
        <dd>
          <span className={`mark ${ui.cls}`}>{ui.mark} {ui.word}</span>
          <span className="muted"> · suitability {d.suitability_score}/100</span>
        </dd>

        <dt>Window</dt>
        <dd>
          <div>{w.window_label}</div>
          <div className="muted small">
            {fmtUtc(parseEngineUtc(w.window_start_utc))} → {fmtUtc(parseEngineUtc(w.window_end_utc))}
            {w.currently_sunlit
              ? ` · ${w.remaining_sunlit_days} d of sunlight left (${w.total_window_days} d window)`
              : w.hours_until_sunlight > 0 ? ` · sunlight in ${w.hours_until_sunlight} h` : ""}
          </div>
          <div className="muted small">Next 30 days: sunlit {w.sunlit_pct_30d}% · Earth contact {w.dte_comm_pct_30d}%</div>
        </dd>

        <dt>Available resources</dt>
        <dd>
          <ul className="plain">
            {d.resources.map((r) => <li key={r}>{r}</li>)}
            <li className="muted small">Slope {d.slope_deg}° · roughness {d.roughness_m} m · {d.ice_distance_km} km to {d.psr_name}</li>
          </ul>
        </dd>

        <dt>Cautions</dt>
        <dd>
          <ul className="plain cautions">
            {d.cautions.map((c) => <li key={c}>⚠ {c}</li>)}
          </ul>
        </dd>

        {mode === "expert" && (
          <>
            <dt>Data check</dt>
            <dd>
              <div className="muted small">Sun/Earth from {sourceLabel(d.ephemeris.ephemeris_source).text}
                {d.ephemeris.relief_dip_deg ? ` · +${d.ephemeris.relief_dip_deg}° height correction` : ""}</div>
              <button className="link" onClick={runCheck} disabled={check === "loading"}>
                {check === "loading" ? "Asking NASA JPL Horizons…" : "Verify against NASA JPL Horizons"}
              </button>
              {check && check !== "loading" && ("error" in check
                ? <div className="error small">{check.error}</div>
                : <div className="small">
                    {check.nasa_jpl_horizons.status === "ok" ? "✓ NASA JPL Horizons answered" : "⚠ NASA JPL Horizons unreachable, using offline data"}
                    {check.nasa_jpl_horizons.request_url && <> · <a href={check.nasa_jpl_horizons.request_url} target="_blank" rel="noreferrer">raw table</a></>}
                  </div>)}
            </dd>
          </>
        )}
      </dl>
      <Actions />
    </section>
  );
}

// ------------------------------------------------------------------ any clicked point (our backend)
const OUR_STATUS: Record<Status, { mark: string; word: string }> = {
  green: { mark: "✓", word: "Good" },
  yellow: { mark: "⚠", word: "Workable" },
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

function cautions(w: Windows, terrainScore: number | undefined) {
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
  c.push("Custom point: evaluated with the terrain model, not the A–H engine.");
  return c;
}

function CustomPointCard({ lat, lon }: { lat: number; lon: number }) {
  const time = useApp((s) => s.time);
  const key = `${lat},${lon}`;
  const hour = hourKey(time);
  const start = sixHourKey(time);
  const w = useLatest(() => api.windows({ lat, lon }, hour, 30, 60), `${key}|${hour}`);
  const score = useApi(() => api.score({ lat, lon }, start), [key, start], 300);
  const st = score.data?.status;
  const windows = w.data ? operatingWindows(w.data.series) : [];
  const days = (a: string, b: string) => ((Date.parse(b) - Date.parse(a)) / 864e5).toFixed(1);

  return (
    <section className="rail-sec selected">
      <h2>Selected site</h2>
      <div className="sel-title">
        <span className="letter big">X</span>
        <div>
          <div className="sel-name">Custom point</div>
          <div className="muted small">{fmtLat(lat)}, {fmtLon(normLon(lon))}</div>
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
          })() : w.error ? <span className="error">{w.error}</span> : "…"}
        </dd>

        <dt>Status <span className="muted small">(next 14 days)</span></dt>
        <dd>{st ? <span className={`mark ${st}`}>{OUR_STATUS[st].mark} {OUR_STATUS[st].word}</span> : "…"}
          {score.data && <span className="muted"> · {score.data.total}/100</span>}</dd>

        <dt>Window</dt>
        <dd>
          {!w.data ? "…" : windows.length === 0 ? <span className="muted">No sunlit + Earth-in-view window in the next 30 days</span> : (
            <ul className="plain">
              {windows.slice(0, 2).map((x) => (
                <li key={x.start}>{fmtUtc(x.start)} → {fmtUtc(x.end)} <span className="muted">({days(x.start, x.end)} d)</span></li>
              ))}
            </ul>
          )}
        </dd>

        <dt>Available resources</dt>
        <dd>{w.data ? `Sunlight ${Math.round(w.data.sunlit_fraction * 100)}% · Earth in view ${Math.round(w.data.earth_visible_fraction * 100)}%` : "…"}</dd>

        <dt>Cautions</dt>
        <dd>
          {w.data ? (
            <ul className="plain cautions">
              {cautions(w.data, score.data?.terrain).map((c) => <li key={c}>⚠ {c}</li>)}
            </ul>
          ) : "…"}
        </dd>
      </dl>
      <Actions />
    </section>
  );
}
