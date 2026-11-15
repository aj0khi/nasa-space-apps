// Power & comms at a glance. Owner: SKY3D (metrics) + LEAD (score).
//   A–H sites: the evaluation engine's window + verdict (GET /api/sites/{id}) so it matches the rail
//   custom points: /api/ephemeris/windows + /api/score
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { fmtUtc, sixHourKey } from "../../hooks/useLatest";
import { useApp } from "../../state/store";
import type { TimelineStep } from "../../types";
import ExplainCard from "../learn/ExplainCard";
import { STATUS_UI } from "../rail/LandingList";

function until(iso: string | null, from: Date) {
  if (!iso) return "not in the next 30 days";
  const h = (new Date(iso).getTime() - from.getTime()) / 3.6e6;
  if (!Number.isFinite(h) || h < 0) return "unavailable: invalid event time";
  return h > 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`;
}

function nextEngineChange(timeline: TimelineStep[], field: "is_sunlit" | "has_earth_comm", current: boolean) {
  const future = timeline.filter((step) => step.offset_hours > 0);
  const next = future.find((step) => step[field] !== current);
  if (next) {
    const h = next.offset_hours;
    return h > 48 ? `about ${(h / 24).toFixed(1)} days` : `about ${h} h`;
  }
  const last = future[future.length - 1];
  return last ? `not within the next ${(last.offset_hours / 24).toFixed(0)} days` : "timeline unavailable";
}

export default function Countdowns({ detailsError }: { detailsError: string | null }) {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const details = useApp((s) => s.details);
  const engine = loc?.site && details?.id === loc.site.id && details.query_timestamp_utc === sixHourKey(time) ? details : null;
  const iso = time.toISOString();
  const custom = loc && !loc.site;
  const w = useApi(() => (custom ? api.windows(loc, iso).then((data) => ({ data, lat: loc.lat, lon: loc.lon })) : null), [loc?.lat, loc?.lon, custom, iso], 400);
  const score = useApi(() => (custom ? api.score(loc, iso).then((data) => ({ data, lat: loc.lat, lon: loc.lon, iso })) : null), [loc?.lat, loc?.lon, custom, iso], 400);

  if (engine) {
    const win = engine.window;
    const ui = STATUS_UI[engine.status];
    return (
      <div className="panel" style={{ width: 280 }}>
        <h3>Power & comms</h3>
        <table>
          <tbody>
            {win.currently_sunlit
              ? <tr><td>☀️ Sunset in</td><td>{nextEngineChange(win.timeline_6h, "is_sunlit", true)}</td></tr>
              : <tr><td>🌑 Sunlight returns in</td><td>{nextEngineChange(win.timeline_6h, "is_sunlit", false)}</td></tr>}
            <tr><td>📡 Earth contact now</td><td>{engine.visibility.has_earth_comm ? "yes" : "no (relay needed)"}</td></tr>
            {engine.visibility.has_earth_comm
              ? <tr><td>🌍 Earthset in</td><td>{nextEngineChange(win.timeline_6h, "has_earth_comm", true)}</td></tr>
              : <tr><td>🌍 Earth visible in</td><td>{nextEngineChange(win.timeline_6h, "has_earth_comm", false)}</td></tr>}
            <tr><td>Sunlight (30 d)</td><td>{win.sunlit_pct_30d}%</td></tr>
            <tr><td>Earth contact (30 d)</td><td>{win.dte_comm_pct_30d}%</td></tr>
          </tbody>
        </table>
        <div className="muted small">Estimates use 6-hour samples, looking up to 15 days ahead from {fmtUtc(engine.query_timestamp_utc)}.</div>
        <div style={{ marginTop: 8 }}>
          <span className={`mark ${ui.cls}`}>{ui.mark} {ui.word}</span> <strong>{engine.suitability_score}/100</strong>
        </div>
        <ExplainCard text={explain.score} />
      </div>
    );
  }

  const sampleTime = w.data?.data.series[0]?.time;
  const currentWindows = custom && w.data?.lat === loc.lat && w.data.lon === loc.lon && sampleTime && Date.parse(sampleTime) === Date.parse(iso) ? w.data.data : null;
  const currentScore = custom && score.data?.lat === loc.lat && score.data.lon === loc.lon && score.data.iso === iso ? score.data.data : null;

  return (
    <div className="panel" style={{ width: 280 }}>
      <h3>Power & comms</h3>
      {currentWindows ? (
        <table>
          <tbody>
            {currentWindows.sun_visible_now
              ? <tr><td>☀️ Sunset in</td><td>{until(currentWindows.next_sunset, time)}</td></tr>
              : <tr><td>🌑 Sunlight returns in</td><td>{until(currentWindows.sun_events.find((e) => e.type === "rise")?.time ?? null, time)}</td></tr>}
            <tr><td>📡 Earth contact now</td><td>{currentWindows.earth_visible_now ? "yes" : "no (relay needed)"}</td></tr>
            {currentWindows.earth_visible_now
              ? <tr><td>🌍 Earthset in</td><td>{until(currentWindows.next_earthset, time)}</td></tr>
              : <tr><td>🌍 Earth visible in</td><td>{until(currentWindows.earth_events.find((e) => e.type === "rise")?.time ?? null, time)}</td></tr>}
            <tr><td>Sunlight (30 d)</td><td>{(currentWindows.sunlit_fraction * 100).toFixed(0)}%</td></tr>
            <tr><td>Earth visible (30 d)</td><td>{(currentWindows.earth_visible_fraction * 100).toFixed(0)}%</td></tr>
          </tbody>
        </table>
      ) : loc?.site ? (detailsError
        ? <div className="error" role="status">Couldn’t update site evaluation: {detailsError}</div>
        : <div>Updating site evaluation…</div>)
        : w.error ? <div className="error" role="status">Couldn’t calculate visibility windows: {w.error}</div>
          : w.data && !sampleTime ? <div className="error" role="status">Visibility windows contain no time samples.</div>
            : <div>Calculating visibility windows…</div>}
      {currentWindows && <div className="muted small">Estimated events use the custom-point horizon model and look up to 30 days ahead.</div>}
      {currentScore && (
        <div style={{ marginTop: 8 }}>
          <span className={`badge ${currentScore.status}`} /> <strong>{currentScore.total}/100</strong>
          <ul style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 16 }}>
            {currentScore.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <ExplainCard text={explain.score} />
    </div>
  );
}
