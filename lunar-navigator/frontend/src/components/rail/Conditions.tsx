// LANDING CONDITIONS: a pilot-style briefing for the selected site at the slider time. Owner: Visualization.
// Sun/Earth + terrain skyline: lunar-navigator/backend /api/ephemeris/windows · solar storms: NOAA SWPC (live).
import { api } from "../../api/client";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { useSpaceWeather } from "../../hooks/useSpaceWeather";
import { landingConditions, worst, type Level } from "../../lib/conditions";
import { useApp } from "../../state/store";
import { useExpert } from "../learn/ModeGate";

const LEVEL_UI: Record<Level, { mark: string; word: string; cls: string }> = {
  ok: { mark: "✓", word: "Good to land", cls: "green" },
  caution: { mark: "⚠", word: "Land with care", cls: "yellow" },
  hazard: { mark: "✗", word: "Not a good time", cls: "red" },
};

export default function Conditions() {
  const loc = useApp((s) => s.location());
  const time = useApp((s) => s.time);
  const override = useApp((s) => s.sunOverride);
  const expert = useExpert();
  const hour = hourKey(time);
  const key = loc ? `${loc.lat},${loc.lon}|${hour}` : "";
  const w = useLatest(() => (loc ? api.windows(loc, hour, 1, 60) : null), key);
  const sw = useSpaceWeather(time);

  if (!loc) return null;
  const p = w.data?.series[0];
  const list = p ? landingConditions({
    sunAlt: override?.alt ?? p.sun_alt,
    sunAz: override?.az ?? p.sun_az,
    sunSkyline: override ? undefined : p.sun_horizon,
    earthAlt: p.earth_alt,
    earthSkyline: p.earth_horizon,
    spaceWeather: sw.data,
  }) : [];
  const overall = list.length ? LEVEL_UI[worst(list)] : null;

  return (
    <section className="rail-sec conditions">
      <h2>Landing conditions {w.loading && <span className="spinner" aria-label="updating" />}</h2>
      {!p ? <p className="muted">{w.error ?? "Checking the sky…"}</p> : (
        <>
          <div className={`mark ${overall!.cls}`}>{overall!.mark} {overall!.word}</div>
          {override && <div className="muted small">Using your manual Sun position ({override.alt}°, {override.az}°).</div>}
          <ul className="plain cond-list">
            {list.map((c) => (
              <li key={c.key} className={`cond ${c.level}`}>
                <span className="cond-label">{LEVEL_UI[c.level].mark} {c.label}</span>
                <span className={expert ? "small" : ""}>{expert ? c.expert : c.beginner}</span>
              </li>
            ))}
          </ul>
          {!expert && <p className="muted small">The Moon has no air, so no wind or rain. These are the things that affect a landing instead.</p>}
          {expert && sw.error && <div className="muted small">NOAA space weather unavailable: {sw.error}</div>}
          {expert && <div className="muted small">Solar storms: NOAA SWPC scales, live. Temperature: flat-ground radiative estimate.</div>}
        </>
      )}
    </section>
  );
}
