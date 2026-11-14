// Compare tab: two scenarios side by side, from the evaluation engine's GET /api/compare.
//   "What about another site?"  → Site A vs Site C on the same date
//   "What if the launch slips?" → the same site on two dates
// Owner: LEAD (engine: backend/evaluator.py compare_scenarios).
import { useState } from "react";
import { api } from "../api/client";
import { STATUS_UI } from "../components/rail/LandingList";
import { parseEngineUtc, fmtUtc, sixHourKey, useLatest } from "../hooks/useLatest";
import { useApp } from "../state/store";
import type { SiteDetails } from "../types";

const SLIPS = [0, 1, 3, 7, 14];

export default function CompareView() {
  const { selectedId, time, minDays } = useApp();
  const sites = useApp((s) => s.sites());
  const [a, setA] = useState(selectedId ?? "A");
  const [b, setB] = useState(selectedId && selectedId !== "C" ? "C" : "E");
  const [slipA, setSlipA] = useState(0);
  const [slipB, setSlipB] = useState(0);

  const base = new Date(sixHourKey(time)).getTime();
  const dateA = sixHourKey(new Date(base + slipA * 864e5));
  const dateB = sixHourKey(new Date(base + slipB * 864e5));
  const cmp = useLatest(() => api.compare(a, dateA, b, dateB, minDays), `${a}|${dateA}|${b}|${dateB}|${minDays}`);
  const r = cmp.data;

  const picker = (label: string, site: string, setSite: (s: string) => void, slip: number, setSlip: (n: number) => void) => (
    <div className="cmp-pick">
      <b>{label}</b>
      <select value={site} onChange={(e) => setSite(e.target.value)} aria-label={`${label} site`}>
        {(sites.length ? sites : "ABCDEFGH".split("").map((id) => ({ id, name: "" }))).map((s) => (
          <option key={s.id} value={s.id}>{s.id}{s.name ? ` · ${s.name}` : ""}</option>
        ))}
      </select>
      <select value={slip} onChange={(e) => setSlip(+e.target.value)} aria-label={`${label} date`}>
        {SLIPS.map((d) => <option key={d} value={d}>{d === 0 ? "on the chosen date" : `launch slips +${d} d`}</option>)}
      </select>
    </div>
  );

  return (
    <div className="scrollview">
      <div className="panel">
        <h3>Compare two landing scenarios {cmp.loading && <span className="spinner" />}</h3>
        <div className="cmp-picks">
          {picker("Scenario 1", a, setA, slipA, setSlipA)}
          <span className="muted">vs</span>
          {picker("Scenario 2", b, setB, slipB, setSlipB)}
        </div>
        {cmp.error && <p className="error">Couldn’t compare ({cmp.error}).</p>}
        {r && (
          <div className="cmp-reco">
            <div>
              Recommended: <b>Scenario {r.recommended.scenario}</b> · site {r.recommended.site_id} {r.recommended.site_name} ·{" "}
              {fmtUtc(r.recommended.date_utc)} · suitability {r.recommended.suitability_score}/100
            </div>
            {r.recommended.key_differences.length > 0
              ? <ul>{r.recommended.key_differences.map((k) => <li key={k}>{k}</li>)}</ul>
              : <div className="muted small">No big differences in sunlight, slope or Earth contact.</div>}
          </div>
        )}
      </div>

      {r && (
        <div className="row">
          <ScenarioCard n={1} d={r.scenario_1} best={r.recommended.scenario === 1} />
          <ScenarioCard n={2} d={r.scenario_2} best={r.recommended.scenario === 2} />
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ n, d, best }: { n: number; d: SiteDetails; best: boolean }) {
  const ui = STATUS_UI[d.status];
  const w = d.window;
  return (
    <div className={`panel cmp-card ${best ? "best" : ""}`}>
      <h3>Scenario {n}{best ? " · recommended" : ""}</h3>
      <div className="sel-title">
        <span className="letter big">{d.id}</span>
        <div>
          <div className="sel-name">{d.name}</div>
          <div className="muted small">{fmtUtc(d.query_timestamp_utc)}</div>
        </div>
      </div>
      <table>
        <tbody>
          <tr><td>Status</td><td><span className={`mark ${ui.cls}`}>{ui.mark} {ui.word}</span> · {d.suitability_score}/100</td></tr>
          <tr><td>Sunlight now</td><td>{d.visibility.is_sunlit ? "☀ yes" : "☾ no"} ({d.visibility.sun_margin_deg >= 0 ? "+" : ""}{d.visibility.sun_margin_deg.toFixed(1)}° vs skyline)</td></tr>
          <tr><td>Earth contact now</td><td>{d.visibility.has_earth_comm ? "📡 yes" : "no"}</td></tr>
          <tr><td>Window</td><td>{w.window_label}</td></tr>
          <tr><td>Window dates</td><td className="small">{fmtUtc(parseEngineUtc(w.window_start_utc))} → {fmtUtc(parseEngineUtc(w.window_end_utc))}</td></tr>
          <tr><td>Sunlit / Earth (30 d)</td><td>{w.sunlit_pct_30d}% / {w.dte_comm_pct_30d}%</td></tr>
          <tr><td>Slope</td><td>{d.slope_deg}°</td></tr>
          <tr><td>Ice proximity</td><td>{d.ice_distance_km} km · {d.psr_name} (unverified)</td></tr>
        </tbody>
      </table>
      <ul className="plain cautions" style={{ marginTop: 8 }}>
        {d.cautions.map((c) => <li key={c}>⚠ {c}</li>)}
      </ul>
    </div>
  );
}
