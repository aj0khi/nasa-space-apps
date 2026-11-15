// POWER · HEAT & COLD · TALKING TO EARTH for the selected site, over the next 30 days from the slider time.
// Owner: Visualization. Data: /api/ephemeris/windows (Sun + Earth with the terrain skyline, hourly) and
// /api/ephemeris/state (Earth distance). Maths: lib/siteSystems.ts. Power is Expert-only; heat and comms show in
// both modes, worded for each.
import { useState } from "react";
import { api } from "../../api/client";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { comms, DEFAULT_POWER, fmtHours, powerBudget, thermal, type Mount, type PowerInputs } from "../../lib/siteSystems";
import type { Level } from "../../lib/conditions";
import { useApp } from "../../state/store";
import { useExpert } from "../learn/ModeGate";

const MARK: Record<Level, string> = { ok: "✓", caution: "⚠", hazard: "✗" };
const pct = (f: number) => `${Math.round(f * 100)}%`;
const c0 = (t: number) => `${Math.round(t)} °C`;

function Item({ level, label, children }: { level?: Level; label: string; children: React.ReactNode }) {
  return (
    <li className={`cond ${level ?? ""}`}>
      <span className="cond-label">{level ? `${MARK[level]} ` : ""}{label}</span>
      <span>{children}</span>
    </li>
  );
}

export default function SiteSystems() {
  const loc = useApp((s) => s.location());
  const time = useApp((s) => s.time);
  const expert = useExpert();
  const hour = hourKey(time);
  const key = loc ? `${loc.lat},${loc.lon}|${hour}` : "";
  const w = useLatest(() => (loc ? api.windows(loc, hour, 30, 60) : null), key);
  const st = useLatest(() => (loc ? api.state(loc, hour) : null), key);
  const [pw, setPw] = useState<PowerInputs>(DEFAULT_POWER);
  if (!loc) return null;
  const series = w.data?.series;
  const loading = <p className="muted">{w.error ?? "Working out the next 30 days…"}</p>;

  return (
    <>
      {expert && (
        <section className="rail-sec systems">
          <h2>Power {w.loading && <span className="spinner" aria-label="updating" />}</h2>
          <PowerInputsForm v={pw} onChange={setPw} />
          {series ? <PowerResult series={series} v={pw} /> : loading}
        </section>
      )}
      <section className="rail-sec systems">
        <h2>{expert ? "Thermal" : "Heat & cold"}</h2>
        {series ? <Thermal series={series} expert={expert} /> : loading}
      </section>
      <section className="rail-sec systems">
        <h2>{expert ? "Communications" : "Talking to Earth"}</h2>
        {series ? <Comms series={series} distanceKm={st.data?.earth.distance_km} expert={expert} /> : loading}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- power (Expert)
function PowerInputsForm({ v, onChange }: { v: PowerInputs; onChange: (v: PowerInputs) => void }) {
  const num = (k: keyof PowerInputs, scale = 1) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const x = Number(e.target.value);
    if (Number.isFinite(x) && x >= 0) onChange({ ...v, [k]: x / scale });
  };
  return (
    <div className="ms-grid systems-grid">
      <label><span>Panel area (m²)</span><input type="number" min={0} step={0.5} value={v.areaM2} onChange={num("areaM2")} /></label>
      <label><span>Efficiency (%)</span><input type="number" min={1} max={60} step={1} value={Math.round(v.efficiency * 100)} onChange={num("efficiency", 100)} /></label>
      <label className="span2"><span>Panels</span>
        <select value={v.mount} onChange={(e) => onChange({ ...v, mount: e.target.value as Mount })}>
          <option value="vertical">Vertical, turning to face the Sun</option>
          <option value="flat">Flat on the deck</option>
        </select>
      </label>
      <label><span>Night load (W)</span><input type="number" min={0} step={10} value={v.nightLoadW} onChange={num("nightLoadW")} /></label>
      <label><span>Battery (kWh)</span><input type="number" min={0} step={0.5} value={v.batteryKWh} onChange={num("batteryKWh")} /></label>
    </div>
  );
}

function PowerResult({ series, v }: { series: Parameters<typeof powerBudget>[0]; v: PowerInputs }) {
  const p = powerBudget(series, v);
  const darkTxt = `${fmtHours(p.dark.hours)}${p.dark.open ? "+" : ""}`;
  const battLevel: Level = p.neverLit ? "hazard" : p.survives ? "ok" : "hazard";
  const balLevel: Level = p.positive ? "ok" : p.avgW > 0 ? "caution" : "hazard";
  return (
    <ul className="plain cond-list small">
      <Item label="Now">{p.nowW > 0 ? `${Math.round(p.nowW)} W from the panels.` : "0 W: no direct sunlight on the panels."}</Item>
      <Item level={balLevel} label="Next 30 days">
        {p.neverLit ? "No direct sunlight at all: solar power is not an option here."
          : `Average ${Math.round(p.avgW)} W, peak ${Math.round(p.peakW)} W, ${p.energyKWh.toFixed(1)} kWh in total. `
            + (p.positive ? `Covers the ${v.nightLoadW} W baseline on average.` : `Below the ${v.nightLoadW} W baseline on average: a net energy deficit.`)}
      </Item>
      <Item level={battLevel} label="Longest dark spell">
        {p.neverLit ? `Dark for the whole window; a ${v.batteryKWh} kWh battery lasts ${fmtHours(p.lastsH)} at ${v.nightLoadW} W.`
          : `${darkTxt}. At ${v.nightLoadW} W that needs ${p.needKWh.toFixed(1)} kWh; the ${v.batteryKWh} kWh battery lasts ${fmtHours(p.lastsH)}: `
            + (p.survives ? "survives it." : `runs flat ${fmtHours(p.dark.hours - p.lastsH)} before sunlight returns.`)}
      </Item>
      <li className="muted">
        Panels make S₀·η·A·{v.mount === "vertical" ? "cos" : "sin"}(Sun elevation) when the Sun clears the LOLA skyline (S₀ = 1361 W/m²).
        At the pole the Sun stays within ~1.6° of the horizon, so vertical panels get almost the full flux while flat ones get ~3%.
        Ignores earthshine, dust, panel self-shadowing and temperature derating. Night load should include survival heaters.
        {p.dark.open && " “+” = the dark spell runs past the 30-day window."}
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- heat & cold (both)
function Thermal({ series, expert }: { series: Parameters<typeof thermal>[0]; expert: boolean }) {
  const t = thermal(series);
  const dark = `${fmtHours(t.dark.hours)}${t.dark.open ? "+" : ""}`;
  const level: Level = t.neverLit || t.dark.hours >= 96 ? "hazard" : t.dark.hours >= 24 || !t.litNow ? "caution" : "ok";
  if (!expert) {
    return (
      <ul className="plain cond-list">
        <Item level={t.litNow ? "ok" : "caution"} label="Right now">
          {t.litNow
            ? `The Sun is very low, so the ground only warms to about ${c0(t.groundNowC)}. But the lander's side facing the Sun gets the full sunshine and heats to about +${Math.round(t.sunFacingC)} °C, while anything in shade is about ${c0(t.coldC)}. The lander has to stop one side overheating and the other freezing.`
            : `It's dark here, and the ground is about ${c0(t.coldC)}: colder than anywhere on Earth.`}
        </Item>
        <Item level={level} label="Surviving the dark">
          {t.neverLit
            ? "No sunlight here in the next 30 days. Only a lander that brings its own heat (like a small nuclear heater) could survive."
            : `The longest dark spell in the next 30 days is ${dark}. Batteries stop working well below about −20 °C, so heaters must run that whole time, and that drains the battery.`}
        </Item>
        <li className="muted small">Most landers so far, like India's Chandrayaan-3, shut down for good when night fell. China's Chang'e 3 and 4 survived many nights using small nuclear heaters.</li>
      </ul>
    );
  }
  return (
    <ul className="plain cond-list small">
      <Item label="Temperatures">
        Flat ground ≈ {c0(t.groundNowC)} now ({t.litNow ? "sunlit" : "shadow"}), ≤ {c0(t.hottestC)} at the highest Sun in the next 30 days; a bare surface square-on to the Sun ≈ +{Math.round(t.sunFacingC)} °C; shadow ≈ {c0(t.coldC)} (90 K);
        permanently shadowed floors ≈ −230 °C (~40 K). Sun-facing and shaded faces of one lander can differ by 150 K or more.
      </Item>
      <Item label="Hardware limits">
        Li-ion charge 0…45 °C, discharge −20…60 °C. Industrial electronics −40…85 °C, space-grade −55…125 °C. Everything outside those bands needs heaters, insulation or radiators.
      </Item>
      <Item level={level} label="Night survival">
        {t.neverLit ? "No direct sunlight in 30 days: needs a non-solar heat and power source (RHUs or an RTG)."
          : `Longest dark spell ${dark}: survival heaters on throughout (count them in the Power night load).`}
        {" "}Options: radioisotope heater units (~1 W each, Pu-238, as on Chang'e 3/4), MLI blankets, variable-conductance heat pipes.
      </Item>
      <Item label="Cycling & dust">
        Repeated hot–cold cycles fatigue solder joints and stiffen lubricants; radiators must face cold sky and stay clear of dust lofted near the terminator and by the landing plume.
      </Item>
    </ul>
  );
}

// ---------------------------------------------------------------- talking to Earth (both)
function Comms({ series, distanceKm, expert }: { series: Parameters<typeof comms>[0]; distanceKm?: number; expert: boolean }) {
  const c = comms(series, distanceKm);
  const gap = `${fmtHours(c.hidden.hours)}${c.hidden.open ? "+" : ""}`;
  const level: Level = c.autonomy === "full" ? "hazard" : c.autonomy === "long" ? "caution" : "ok";
  if (!expert) {
    const self = {
      full: "Earth never comes into view here, so the lander needs a relay satellite orbiting the Moon, or must work completely on its own.",
      long: `During gaps of a day or more (the longest is ${gap}) the lander must run itself, saving its data until Earth comes back, or use a relay satellite.`,
      short: `Only short gaps (the longest is ${gap}): it can save its data and wait for Earth to come back.`,
      landing: "Earth stays in view, so it can call home any time.",
    }[c.autonomy];
    return (
      <ul className="plain cond-list">
        <Item label="Radio delay">
          Radio takes about {c.oneWayS.toFixed(1)} seconds to reach Earth ({c.roundTripS.toFixed(1)} s there and back), so nobody can steer the landing live: the lander finds a safe spot and touches down by itself.
        </Item>
        <Item level={c.upNow ? "ok" : "hazard"} label="Earth in view">
          {c.upNow ? "Earth is in view right now." : "Earth is hidden right now."} Over the next 30 days it is in view {pct(c.visibleFrac)} of the time.
        </Item>
        <Item level={level} label="On its own">{self}</Item>
        <li className="muted small">On Earth, big dish antennas in California, Spain and Australia take turns listening as Earth spins.</li>
      </ul>
    );
  }
  const auto = {
    full: "continuous: relay-only or fully autonomous operations.",
    long: `≥ ${gap} unattended: onboard fault protection, data storage and pre-loaded command sequences.`,
    short: `store-and-forward through outages up to ${gap}.`,
    landing: "descent and landing only.",
  }[c.autonomy];
  return (
    <ul className="plain cond-list small">
      <Item label="Light time">
        Earth range {c.distanceKm ? `${Math.round(c.distanceKm).toLocaleString()} km` : "≈384,400 km (mean)"} → one-way {c.oneWayS.toFixed(2)} s, round trip {c.roundTripS.toFixed(2)} s, plus ground and processing latency.
        Real-time piloting is impossible, so terminal descent and hazard avoidance run onboard.
      </Item>
      <Item level={c.upNow ? "ok" : "hazard"} label="Direct to Earth">
        Earth {c.earthAlt.toFixed(1)}° vs skyline {c.skyline.toFixed(1)}° now · visible {pct(c.visibleFrac)} of 30 days · longest outage {c.hidden.hours ? gap : "none"}.
        {Math.abs(c.earthAlt) < 10 && " Earth stays low here (libration swings it a few degrees), so the link needs a clear skyline and suffers multipath off the ground."}
      </Item>
      <Item label="Ground & relays">
        NASA Deep Space Network 34 m / 70 m antennas at Goldstone, Madrid and Canberra (~120° apart) give near-continuous Earth-side coverage, but antenna time is scheduled and shared.
        Relays: China's Queqiao-2 (lunar orbit since 2024); ESA's Lunar Pathfinder and NASA's LCRNS / LunaNet are being set up for south-pole users.
      </Item>
      <Item level={level} label="Autonomy needed">{auto}</Item>
    </ul>
  );
}
