// DATE: three boxes (day / month / year) and a slider through one lunar day. Owner: LEAD.
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";
import { ExpertOnly } from "../learn/ModeGate";

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
