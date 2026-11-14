// IDEAL LANDING LOCATIONS: every lettered site with ✓ / ~ / ✗ for the chosen date. Owner: MAP.
import { shortName } from "../../lib/letters";
import { useApp } from "../../state/store";
import type { Site, Status } from "../../types";

const MARK: Record<Status, string> = { green: "✓", yellow: "~", red: "✗" };
const WORD: Record<Status, string> = { green: "good", yellow: "workable", red: "risky" };

interface Props { sites: Site[]; letters: Record<string, string>; onSelect: (id: string) => void }

export default function LandingList({ sites, letters, onSelect }: Props) {
  const { scores, selectedId, now } = useApp();
  const ordered = sites.filter((s) => letters[s.id]).sort((a, b) => letters[a.id].localeCompare(letters[b.id]));

  return (
    <section className="rail-sec">
      <h2>Ideal landing locations</h2>
      <ul className="landlist">
        {ordered.map((s) => {
          const st = scores[s.id]?.status;
          const n = now[s.id];
          const light = n ? (n.sun_visible ? "in sunlight now" : "in shadow now") : "";
          return (
            <li key={s.id}>
              <button className={s.id === selectedId ? "sel" : ""} onClick={() => onSelect(s.id)}
                aria-label={`${letters[s.id]}, ${s.name}, ${st ? WORD[st] : "loading"}${light ? `, ${light}` : ""}`} title={s.name}>
                <span className="letter">{letters[s.id]}</span>
                <span className={`mark ${st ?? ""}`}>{st ? MARK[st] : "…"}</span>
                <span className={`lightnow ${n ? (n.sun_visible ? "on" : "off") : ""}`} aria-hidden>{n ? (n.sun_visible ? "☀" : "☾") : ""}</span>
                <span className="lname">{shortName(s)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="landkey">✓ good · ~ workable · ✗ risky to land now (next 14 days) · ☀ lit / ☾ shadow right now</div>
    </section>
  );
}
