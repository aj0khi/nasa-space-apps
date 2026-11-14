// Owner: GEO (content) + LEAD.
import { moonVsEarth } from "../../content/explanations";

export default function MoonVsEarth() {
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>Moon vs Earth</h3>
      <table>
        <thead>
          <tr><th></th><th>🌙</th><th>🌍</th></tr>
        </thead>
        <tbody>
          {moonVsEarth.map((r) => (
            <tr key={r.label}><td>{r.label}</td><td>{r.moon}</td><td>{r.earth}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
