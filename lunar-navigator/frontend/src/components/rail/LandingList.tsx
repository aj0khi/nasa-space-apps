// IDEAL LANDING LOCATIONS: A–H with GO ✓ / CAUTION ⚠ / NO-GO ✗ from the evaluation engine (GET /api/sites).
// Owner: MAP. Data: backend/evaluator.py.
import { useApp } from "../../state/store";
import type { EvalStatus } from "../../types";

export const STATUS_UI: Record<EvalStatus, { mark: string; word: string; cls: "green" | "yellow" | "red" }> = {
  GO: { mark: "✓", word: "GO", cls: "green" },
  CAUTION: { mark: "⚠", word: "CAUTION", cls: "yellow" },
  NO_GO: { mark: "✗", word: "NO-GO", cls: "red" },
};

/** "NASA JPL Horizons Live REST API (DE441)" → short label + whether it is live */
export function sourceLabel(src: string | undefined) {
  if (!src) return { text: "…", live: false };
  if (src.includes("Horizons Live")) return { text: "NASA JPL Horizons · live", live: true };
  if (src.includes("Skyfield")) return { text: "NASA JPL DE421 · offline", live: false };
  return { text: "approximate formula · offline", live: false };
}

interface Props { loading: boolean; error: string | null; onSelect: (id: string) => void }

export default function LandingList({ loading, error, onSelect }: Props) {
  const { evaluation, selectedId, minDays, setMinDays } = useApp();
  const sites = evaluation?.sites ?? [];
  const src = sourceLabel(evaluation?.ephemeris_source);

  return (
    <section className="rail-sec">
      <h2>Ideal landing locations {loading && <span className="spinner" aria-label="updating" />}</h2>

      {error && !evaluation && <p className="error">Couldn’t load site statuses ({error}). Is the backend running on port 8000?</p>}

      {evaluation && (
        <div className="landsummary">
          <span><b>{evaluation.summary.viable_sites_count}</b> of {evaluation.summary.total_sites} viable</span>
          <span>Best: <b>{evaluation.summary.recommended_backup_site}</b> {evaluation.summary.recommended_backup_name}</span>
        </div>
      )}

      <ul className="landlist">
        {sites.map((s) => {
          const ui = STATUS_UI[s.status];
          return (
            <li key={s.id}>
              <button className={s.id === selectedId ? "sel" : ""} onClick={() => onSelect(s.id)}
                title={`${s.name}: ${ui.word}, ${s.window_label}`}
                aria-label={`${s.id}, ${s.name}, ${ui.word}, ${s.is_sunlit ? "in sunlight" : "in shadow"}, ${s.has_earth_comm ? "Earth in view" : "no Earth contact"}`}>
                <span className="letter">{s.id}</span>
                <span className={`mark ${ui.cls}`}>{ui.mark}</span>
                <span className={`lightnow ${s.is_sunlit ? "on" : "off"}`} aria-hidden>{s.is_sunlit ? "☀" : "☾"}</span>
                <span className="lname">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="landopts">
        <label>
          Mission needs{" "}
          <select value={minDays} onChange={(e) => setMinDays(+e.target.value)} aria-label="Minimum days of continuous sunlight">
            {[1, 3, 5, 7, 10].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>{" "}
          of sunlight
        </label>
      </div>
      <div className="landkey">
        ✓ GO · ⚠ CAUTION · ✗ NO-GO · ☀ lit / ☾ shadow now
        {evaluation && <> · checked at {evaluation.query_timestamp_utc.slice(11, 16)} UTC</>}
      </div>
      <div className={`source ${src.live ? "live" : ""}`}>Sun &amp; Earth: {src.text}</div>
    </section>
  );
}
