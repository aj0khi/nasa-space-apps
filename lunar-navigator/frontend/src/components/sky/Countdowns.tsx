// Power & comms at a glance. Owner: SKY3D (metrics) + LEAD (score).
//   A–H sites: the evaluation engine's window + verdict (GET /api/sites/{id}) so it matches the rail
//   custom points: /api/ephemeris/windows + /api/score
import { api } from "../../api/client";
import { explain } from "../../content/explanations";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import ExplainCard from "../learn/ExplainCard";
import { STATUS_UI } from "../rail/LandingList";

function until(iso: string | null, from: Date) {
  if (!iso) return "not in the next 30 days";
  const h = (new Date(iso).getTime() - from.getTime()) / 3.6e6;
  return h > 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`;
}

export default function Countdowns() {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const details = useApp((s) => s.details);
  const engine = loc?.site ? details : null;
  const iso = time.toISOString();
  const custom = loc && !loc.site;
  const w = useApi(() => (custom ? api.windows(loc, iso) : null), [loc?.lat, loc?.lon, custom, iso], 400);
  const score = useApi(() => (custom ? api.score(loc, iso) : null), [loc?.lat, loc?.lon, custom, iso], 400);

  if (engine) {
    const win = engine.window;
    const ui = STATUS_UI[engine.status];
    return (
      <div className="panel" style={{ width: 280 }}>
        <h3>Power & comms</h3>
        <table>
          <tbody>
            {win.currently_sunlit
              ? <tr><td>☀️ Sunlight left</td><td>{win.remaining_sunlit_days} days</td></tr>
              : <tr><td>🌑 Sunlight returns in</td><td>{win.hours_until_sunlight > 0 ? `${win.hours_until_sunlight} h` : "not within 15 days"}</td></tr>}
            <tr><td>📡 Earth contact now</td><td>{engine.visibility.has_earth_comm ? "yes" : "no (relay needed)"}</td></tr>
            <tr><td>Sunlight (30 d)</td><td>{win.sunlit_pct_30d}%</td></tr>
            <tr><td>Earth contact (30 d)</td><td>{win.dte_comm_pct_30d}%</td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <span className={`mark ${ui.cls}`}>{ui.mark} {ui.word}</span> <strong>{engine.suitability_score}/100</strong>
        </div>
        <ExplainCard text={explain.score} />
      </div>
    );
  }

  return (
    <div className="panel" style={{ width: 280 }}>
      <h3>Power & comms</h3>
      {w.data ? (
        <table>
          <tbody>
            {w.data.sun_visible_now
              ? <tr><td>☀️ Sun goes behind the skyline in</td><td>{until(w.data.next_sunset, time)}</td></tr>
              : <tr><td>🌑 In shadow. Sunlight returns in</td><td>{until(w.data.sun_events.find((e) => e.type === "rise")?.time ?? null, time)}</td></tr>}
            <tr><td>🌍 Earthset in</td><td>{until(w.data.next_earthset, time)}</td></tr>
            <tr><td>Sunlight (30 d)</td><td>{(w.data.sunlit_fraction * 100).toFixed(0)}%</td></tr>
            <tr><td>Earth visible</td><td>{(w.data.earth_visible_fraction * 100).toFixed(0)}%</td></tr>
          </tbody>
        </table>
      ) : <div>{loc?.site ? "Loading site evaluation…" : w.loading ? "Calculating…" : w.error}</div>}
      {score.data && (
        <div style={{ marginTop: 8 }}>
          <span className={`badge ${score.data.status}`} /> <strong>{score.data.total}/100</strong>
          <ul style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 16 }}>
            {score.data.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <ExplainCard text={explain.score} />
    </div>
  );
}
