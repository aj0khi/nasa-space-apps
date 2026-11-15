// DATE: three boxes (day / month / year) and a slider through one lunar day. Owner: LEAD.
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import { BeginnerOnly, ExpertOnly } from "../learn/ModeGate";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LUNAR_DAY_H = 29.53 * 24;

export default function DatePanel() {
  const { baseTime, setBaseTime, time, setTime } = useApp();
  const [playing, setPlaying] = useState(false);
  const offsetH = (time.getTime() - baseTime.getTime()) / 3.6e6;

  const setPart = (part: "d" | "m" | "y", v: number) => {
    if (!Number.isFinite(v)) return;
    const d = new Date(baseTime);
    if (part === "d") d.setUTCDate(Math.min(31, Math.max(1, v)));
    if (part === "m") d.setUTCMonth(v);
    if (part === "y") d.setUTCFullYear(Math.min(2049, Math.max(1900, v))); // DE421 kernel range
    setBaseTime(d);
  };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { time: t, baseTime: b } = useApp.getState();
      const next = t.getTime() + 3 * 3.6e6; // 3 hours per tick
      setTime(new Date(next - b.getTime() > LUNAR_DAY_H * 3.6e6 ? b.getTime() : next));
    }, 80);
    return () => clearInterval(id);
  }, [playing, setTime]);

  return (
    <section className="rail-sec">
      <h2>Date</h2>
      <div className="dateboxes">
        <label><span>Day</span>
          <input type="number" min={1} max={31} value={baseTime.getUTCDate()} onChange={(e) => setPart("d", +e.target.value)} />
        </label>
        <label><span>Month</span>
          <select value={baseTime.getUTCMonth()} onChange={(e) => setPart("m", +e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </label>
        <label><span>Year</span>
          <input type="number" min={1900} max={2049} value={baseTime.getUTCFullYear()} onChange={(e) => setPart("y", +e.target.value)} />
        </label>
      </div>

      <div className="scrub">
        <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play through the lunar day"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input type="range" min={0} max={LUNAR_DAY_H} step={1} value={offsetH} aria-label="Time within the lunar day"
          onChange={(e) => setTime(new Date(baseTime.getTime() + +e.target.value * 3.6e6))} />
      </div>
      <div className="scrub-label">
        <span>◂ day {(offsetH / 24).toFixed(1)} of 29.5 ▸</span>
        <span>{time.toUTCString().slice(5, 22)} UTC</span>
      </div>
      <button className="link" onClick={() => setBaseTime(new Date())}>Reset to now</button>
      <DatePresets />
      <BeginnerOnly><MoonPhases /></BeginnerOnly>
      <ExpertOnly>
        <div className="ms-row">
          <label><span>Time (UTC)</span>
            <input type="time" value={time.toISOString().slice(11, 16)} onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isFinite(h) || !Number.isFinite(m)) return;
              const d = new Date(time); d.setUTCHours(h, m, 0, 0); setTime(d);
            }} />
          </label>
          <label><span>Hours into lunar day</span>
            <input type="number" min={0} max={Math.round(LUNAR_DAY_H)} step={1} value={Math.round(offsetH)}
              onChange={(e) => { const h = Number(e.target.value); if (Number.isFinite(h)) setTime(new Date(baseTime.getTime() + Math.max(0, Math.min(LUNAR_DAY_H, h)) * 3.6e6)); }} />
          </label>
        </div>
      </ExpertOnly>
    </section>
  );
}

/** One-click dates: today, a week out, and the Moon's next seasons (when the Sun is highest / lowest at the pole). */
function DatePresets() {
  const { baseTime, setBaseTime } = useApp();
  const seasons = useApi(() => api.seasons(new Date().toISOString()), [], 0);
  const now = Date.now();
  const presets = [
    { key: "now", label: "Today", t: new Date(now) },
    { key: "week", label: "+1 week", t: new Date(now + 7 * 864e5) },
    { key: "month", label: "+1 month", t: new Date(now + 29.53 * 864e5) },
    ...(seasons.data ?? []).map((s) => ({ key: s.key, label: s.name, t: new Date(s.time) })),
  ];
  return (
    <div className="presets" role="group" aria-label="Date presets">
      {presets.map((p) => (
        <button key={p.key} className={Math.abs(p.t.getTime() - baseTime.getTime()) < 3.6e6 ? "active" : ""}
          title={p.t.toUTCString()} onClick={() => setBaseTime(p.t)}>{p.label}</button>
      ))}
    </div>
  );
}

// Moon phases as easy reference dates for beginners (as seen from Earth). Mean phases from the average synodic
// month, anchored on the new Moon of 6 Jan 2000 (Meeus): good to within about half a day, fine for picking a date.
const SYNODIC_MS = 29.530588861 * 864e5;
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);
const PHASES = [
  { q: 0, name: "New Moon", icon: "🌑", hint: "Earth sees the Moon's dark side: the Sun is behind the Moon, over its far side." },
  { q: 0.25, name: "First quarter", icon: "🌓", hint: "Half lit from Earth: the Sun is off to the Moon's east." },
  { q: 0.5, name: "Full Moon", icon: "🌕", hint: "Fully lit from Earth: the Sun is behind Earth, over the Moon's Earth-facing side." },
  { q: 0.75, name: "Last quarter", icon: "🌗", hint: "Half lit from Earth: the Sun is off to the Moon's west." },
];

/** The next time each phase happens after `from`, soonest first. */
export function nextMoonPhases(from: number) {
  const cycles = (from - NEW_MOON_2000) / SYNODIC_MS;
  return PHASES.map((p) => {
    const k = Math.floor(cycles - p.q) + 1; // first whole cycle whose phase-q moment is after `from`
    return { ...p, t: new Date(NEW_MOON_2000 + (k + p.q) * SYNODIC_MS) };
  }).sort((a, b) => a.t.getTime() - b.t.getTime());
}

function MoonPhases() {
  const { baseTime, setBaseTime } = useApp();
  const phases = nextMoonPhases(Date.now());
  const fmt = (t: Date) => t.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="moonphases">
      <span className="moonphases-label">Next Moon phases</span>
      <div className="moonphases-row" role="group" aria-label="Jump to a Moon phase">
        {phases.map((p) => (
          <button key={p.name} className={Math.abs(p.t.getTime() - baseTime.getTime()) < 12 * 3.6e6 ? "active" : ""}
            title={`${p.name}, ${p.t.toUTCString().slice(5, 22)} UTC (approximate). ${p.hint}`}
            aria-label={`${p.name}, ${fmt(p.t)}`} onClick={() => setBaseTime(p.t)}>
            <span className="moonphase-icon" aria-hidden="true">{p.icon}</span>
            <span className="moonphase-name">{p.name}</span>
            <span className="moonphase-date">{fmt(p.t)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
