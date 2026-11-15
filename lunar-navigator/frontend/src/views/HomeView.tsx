// SouthPoint homepage: spinning Moon hero, then a Beginner / Expert quick guide, then into the navigator.
import { lazy, Suspense, useEffect, useState } from "react";
import Logo from "../components/home/Logo";
import { useApp } from "../state/store";

const MoonGlobe = lazy(() => import("../components/home/MoonGlobe"));

type Track = "beginner" | "expert";

const GUIDE: Record<Track, { intro: string; steps: { title: string; body: string; where: string }[] }> = {
  beginner: {
    intro: "New to the Moon? Four steps, no maths. Every panel explains itself in plain language.",
    steps: [
      { title: "Pick a date", where: "Right rail · Date", body: "Type a day, month and year, or drag the slider to walk through one lunar day (about 29.5 Earth days). The light on the map follows the date." },
      { title: "Read the map", where: "2D tab", body: "You’re looking down on the Moon’s south pole. Bright ground is in sunlight, dark ground is in shadow. The letters A–H mark candidate landing sites." },
      { title: "Check the verdict", where: "Right rail · Ideal landing", body: "Each site gets GO ✓, CAUTION ⚠ or NO-GO ✗ for your date, based on sunlight, slope and whether Earth is in view for radio contact." },
      { title: "Look closer", where: "Cross section · 3D tabs", body: "Click a site (or anywhere on the map) to see why it got its verdict, then slice through the terrain or fly around it in 3D." },
    ],
  },
  expert: {
    intro: "Switch on Expert and every number is shown: angles, sources, and the what-if controls.",
    steps: [
      { title: "Set up the mission", where: "Right rail · Mission setup", body: "Choose launch site, departure date and vehicle. Arrival time, landing point and Sun geometry are computed, and you can override any of them by hand." },
      { title: "Sun & Earth geometry", where: "Conditions · Countdowns", body: "Ephemerides come from NASA JPL Horizons (DE441) live, falling back to DE421 offline. See Sun elevation/azimuth plus countdowns to the next sunset and loss of Earth line-of-sight." },
      { title: "Terrain & illumination", where: "2D · Cross section · 3D", body: "Swap Moon Trek layers (LROC WAC, LOLA shade, colour relief, slope). Cross sections run along the Sun azimuth so horizon shadowing is explicit; 3D renders the LOLA DEM." },
      { title: "Compare scenarios", where: "Compare tab", body: "Two sites on the same date, or one site with the launch slipping 1–14 days. Set the minimum sunlit days to tighten the GO/NO-GO criteria." },
    ],
  },
};

function enter(track: Track) {
  useApp.getState().setMode(track);
  location.hash = "#/2d";
}

export default function HomeView() {
  const [track, setTrack] = useState<Track>(() => useApp.getState().mode as Track);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const utc = clock.toISOString().slice(0, 19).replace("T", " ");
  const guide = GUIDE[track];

  return (
    <div className="ms">
      <header className="ms-header">
        <a className="ms-brand" href="#/home" aria-label="SouthPoint home"><Logo height={44} /></a>
        <nav className="ms-nav" aria-label="Main">
          <a href="#guide" onClick={(e) => { e.preventDefault(); document.getElementById("guide")?.scrollIntoView({ behavior: "smooth" }); }}>Guide</a>
          <a href="#/2d">Navigator</a>
          <a href="#/compare">Compare</a>
        </nav>
        <span className="ms-mono ms-clock">{utc} UTC</span>
      </header>

      <section className="ms-hero">
        <div className="ms-grid-bg" aria-hidden="true" />
        <div className="ms-ruler" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} className={i % 5 === 0 ? "long" : ""} />)}</div>
        <span className="ms-coords ms-mono" aria-hidden="true">−89.54° S · 0.00° E · SHACKLETON</span>

        <div className="ms-hero-top ms-mono" aria-hidden="true">
          <span>NASA SPACE APPS 2026</span>
          <span>LUNAR SOUTH POLE</span>
          <span>“SOUTHPOINT”</span>
        </div>

        <div className="ms-title">
          <p className="ms-sub">Lunar landing site navigator</p>
          <h1>SOUTHPOINT</h1>
          <p className="ms-tagline">Land where the sun stays.</p>
        </div>

        <div className="ms-hud" aria-hidden="true">
          <span className="ms-bracket tl" /><span className="ms-bracket tr" />
          <span className="ms-live ms-mono"><b />LIVE</span>
          <span className="ms-dots l"><i /><i /></span><span className="ms-dots r"><i /><i /></span>
        </div>

        <Suspense fallback={<div className="ms-moon ms-moon-fallback" />}>
          <MoonGlobe className="ms-moon" />
        </Suspense>
        <div className="ms-moon-glow" aria-hidden="true" />

        <div className="ms-hero-foot">
          <div>
            <h2 className="ms-mono">Find light</h2>
            <p>Track sunlight and shadow at the south pole for any date.</p>
          </div>
          <div className="ms-hero-cta">
            <a className="ms-btn" href="#/2d"><span>Launch navigator</span></a>
            <a className="ms-btn ghost" href="#guide" onClick={(e) => { e.preventDefault(); document.getElementById("guide")?.scrollIntoView({ behavior: "smooth" }); }}><span>How it works ↓</span></a>
          </div>
          <div>
            <h2 className="ms-mono">Rate the site</h2>
            <p>GO / CAUTION / NO-GO from sun, slope and Earth contact.</p>
          </div>
        </div>
      </section>

      <section className="ms-guide" id="guide" aria-labelledby="guide-title">
        <div className="ms-guide-head">
          <p className="ms-mono ms-eyebrow">// Quick guide</p>
          <h2 id="guide-title">How to use SouthPoint</h2>
          <div className="ms-track" role="tablist" aria-label="Guide level">
            {(["beginner", "expert"] as Track[]).map((t) => (
              <button key={t} role="tab" aria-selected={track === t} className={track === t ? "on" : ""} onClick={() => setTrack(t)}>
                {t === "beginner" ? "Beginner" : "Expert"}
              </button>
            ))}
          </div>
          <p className="ms-guide-intro">{guide.intro}</p>
        </div>

        <ol className="ms-steps" key={track}>
          {guide.steps.map((s, i) => (
            <li key={s.title} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="ms-step-n ms-mono">0{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className="ms-where ms-mono">{s.where}</span>
            </li>
          ))}
        </ol>

        <div className="ms-enter">
          <div>
            <h3>Ready for descent?</h3>
            <p>You can switch between Beginner and Expert any time from the top bar.</p>
          </div>
          <button className="ms-btn" onClick={() => enter(track)}>
            <span>Enter as {track === "beginner" ? "Beginner" : "Expert"} →</span>
          </button>
        </div>
      </section>

      <footer className="ms-footer ms-mono">
        <span>SOUTHPOINT · Exploratory tool, not validated landing guidance</span>
        <span>Imagery: NASA / GSFC / ASU LROC · NASA Moon Trek</span>
      </footer>
    </div>
  );
}
