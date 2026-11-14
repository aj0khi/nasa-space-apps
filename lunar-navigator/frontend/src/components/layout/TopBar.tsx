// Title + beginner/expert switch. (The date now lives in the right rail.) Owner: LEAD.
import { useApp } from "../../state/store";

export default function TopBar() {
  const { mode, setMode } = useApp();
  return (
    <header className="topbar">
      <a href="#/2d" className="brand">🌙 Lunar Landing Site Navigator</a>
      <span className="muted small">South pole</span>
      <div className="tabs" style={{ marginLeft: "auto" }} role="group" aria-label="Detail level">
        <button className={mode === "beginner" ? "active" : ""} onClick={() => setMode("beginner")}>Beginner</button>
        <button className={mode === "expert" ? "active" : ""} onClick={() => setMode("expert")}>Expert</button>
      </div>
    </header>
  );
}
