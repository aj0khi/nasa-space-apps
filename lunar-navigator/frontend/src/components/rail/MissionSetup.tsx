// MISSION SETUP: launch site, departure date, vehicle → arrival date, landing point, and the Sun at arrival.
// Computed values can be changed by hand (Expert). Owner: Visualization.
//   Earth–Moon distance + Sun at the site: lunar-navigator/backend /api/ephemeris/state
//   best A–H site on arrival day: A–H engine /api/sites
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { fmtUtc, sixHourKey } from "../../hooks/useLatest";
import { compass, fmtLat, fmtLon } from "../../lib/geo";
import { go } from "../../router";
import { useApp } from "../../state/store";
import { ExpertOnly, useExpert } from "../learn/ModeGate";

// Where rockets to the Moon launch from.
const LAUNCH_SITES = [
  { key: "ksc", name: "Kennedy Space Center, USA", lat: 28.57, lon: -80.65 },
  { key: "vsfb", name: "Vandenberg, USA", lat: 34.74, lon: -120.57 },
  { key: "kourou", name: "Guiana Space Centre, French Guiana", lat: 5.24, lon: -52.77 },
  { key: "baikonur", name: "Baikonur, Kazakhstan", lat: 45.97, lon: 63.31 },
  { key: "shar", name: "Satish Dhawan, India", lat: 13.72, lon: 80.23 },
  { key: "wenchang", name: "Wenchang, China", lat: 19.61, lon: 110.95 },
  { key: "tanegashima", name: "Tanegashima, Japan", lat: 30.4, lon: 130.97 },
  { key: "mahia", name: "Mahia Peninsula, New Zealand", lat: -39.26, lon: 177.86 },
];

// Transit times at the mean Earth–Moon distance. Direct transfers scale with the actual distance.
const MEAN_DIST_KM = 384_400;
const R_EARTH_KM = 6371;
const VEHICLES = [
  { key: "crewed", name: "Crewed lander (direct, like Apollo/Artemis)", days: 3.0, direct: true },
  { key: "robotic", name: "Robotic lander (direct, like IM-1)", days: 6.0, direct: true },
  { key: "lowenergy", name: "Fuel-saving route (like Chandrayaan-3)", days: 40, direct: false },
];

export default function MissionSetup() {
  const { baseTime, setBaseTime, time, sunOverride, setSunOverride, minDays } = useApp();
  const loc = useApp((s) => s.location());
  const expert = useExpert();
  const [launch, setLaunch] = useState(LAUNCH_SITES[0].key);
  const [vehicle, setVehicle] = useState(VEHICLES[0].key);
  const site = LAUNCH_SITES.find((s) => s.key === launch)!;
  const v = VEHICLES.find((x) => x.key === vehicle)!;

  // Earth–Moon distance on departure day (measured from the landing site, which is within 1,737 km of the Moon's centre).
  const dep = useApi(() => (loc ? api.state(loc, baseTime.toISOString()) : null), [loc?.lat, loc?.lon, baseTime.getTime()]);
  const distKm = dep.data?.earth.distance_km ?? MEAN_DIST_KM;
  const transitDays = v.direct ? v.days * (distKm / MEAN_DIST_KM) : v.days;
  const arrival = new Date(baseTime.getTime() + transitDays * 864e5);

  // The best A–H site on arrival day, and the Sun at the chosen site on arrival.
  const slot = sixHourKey(arrival);
  const atArrival = useApi(() => api.sites(slot, minDays), [slot, minDays], 300);
  const best = atArrival.data?.sites.slice().sort((a, b) => Number(b.is_go) - Number(a.is_go) || b.suitability_score - a.suitability_score)[0];
  const tilt = atArrival.data?.south_pole_ephemeris.sun.sub_lat_deg;
  const sunArr = useApi(() => (loc ? api.state(loc, arrival.toISOString()) : null), [loc?.lat, loc?.lon, slot]);

  return (
    <section className="rail-sec mission-setup">
      <h2>Mission setup</h2>
      <div className="ms-grid">
        <label><span>Launch from</span>
          <select value={launch} onChange={(e) => setLaunch(e.target.value)}>
            {LAUNCH_SITES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        <label><span>Spacecraft</span>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            {VEHICLES.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </label>
        <label><span>Departure (UTC)</span>
          <input type="datetime-local" value={baseTime.toISOString().slice(0, 16)}
            onChange={(e) => { const d = new Date(e.target.value + "Z"); if (!isNaN(+d)) setBaseTime(d); }} />
        </label>
      </div>

      <dl className="facts">
        <dt>Arrival</dt>
        <dd>
          <b>{fmtUtc(arrival)}</b> <span className="muted">· {transitDays.toFixed(1)} days</span>
          <div className="muted small">
            {expert
              ? `Moon ${Math.round(distKm).toLocaleString()} km away (${((100 * distKm) / MEAN_DIST_KM - 100).toFixed(1)}% vs mean). From ${site.name} (${fmtLat(site.lat)}, ${fmtLon(site.lon)}) that changes by at most ±${R_EARTH_KM.toLocaleString()} km, depending on where the Moon is in your sky.`
              : `The Moon is ${Math.round(distKm / 1000).toLocaleString()} thousand km away that day. Where you launch from changes when you can go, not how long the trip takes.`}
          </div>
          <button className="link" onClick={() => setBaseTime(arrival)}>Show arrival day in the app</button>
        </dd>

        <dt>Best landing site on arrival</dt>
        <dd>
          {best ? (
            <>
              <button className="link" onClick={() => go.site(best.id)}><b>{best.id}</b> · {best.name}</button>
              <span className="muted"> · {best.is_go ? "GO" : best.status.replace("_", "-")}{expert ? ` · ${best.suitability_score}/100` : ""}</span>
            </>
          ) : <span className="muted">{atArrival.error ?? "Checking sites…"}</span>}
        </dd>

        {tilt != null && (
          <>
            <dt>Lunar season on arrival</dt>
            <dd>
              {tilt < 0 ? "Southern summer side: the Sun circles just above the pole's horizon." : "Southern winter side: the Sun sits lower, so shadows at the pole are longer."}
              <ExpertOnly><div className="muted small">Sub-solar latitude {tilt.toFixed(2)}°. The Moon's 1.54° axial tilt keeps it within about ±1.6°, so at the pole the Sun never rises more than ~1.6° (plus any height of the site).</div></ExpertOnly>
            </dd>
          </>
        )}

        {sunArr.data && (
          <>
            <dt>Sun at the site on arrival</dt>
            <dd>
              {expert
                ? `${sunArr.data.sun.altitude.toFixed(1)}° high, from ${sunArr.data.sun.azimuth.toFixed(0)}° (${compass(sunArr.data.sun.azimuth)}) · shadows point ${compass(sunArr.data.sun.azimuth + 180)}`
                : sunArr.data.sun.altitude > 0 ? `Up in the ${compass(sunArr.data.sun.azimuth)}, shadows point ${compass(sunArr.data.sun.azimuth + 180)}.` : "Below the horizon: it's night there."}
            </dd>
          </>
        )}
      </dl>

      <ExpertOnly>
        <LandingPoint />
        <SunOverride time={time} override={sunOverride} setOverride={setSunOverride} />
      </ExpertOnly>
    </section>
  );
}

/** Type a latitude / longitude to land anywhere. */
function LandingPoint() {
  const loc = useApp((s) => s.location());
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  useEffect(() => { if (loc) { setLat(loc.lat.toFixed(3)); setLon(loc.lon.toFixed(3)); } }, [loc?.lat, loc?.lon]);
  const la = Number(lat), lo = Number(lon);
  const ok = lat !== "" && lon !== "" && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  return (
    <form className="ms-row" onSubmit={(e) => { e.preventDefault(); if (ok) go.point(la, lo); }}>
      <label><span>Latitude</span><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude, negative for south" /></label>
      <label><span>Longitude</span><input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude, negative for west" /></label>
      <button type="submit" disabled={!ok}>Go</button>
    </form>
  );
}

/** "What if": replace the computed Sun position in the cross section and conditions briefing. */
function SunOverride({ time, override, setOverride }: { time: Date; override: { alt: number; az: number } | null; setOverride: (s: { alt: number; az: number } | null) => void }) {
  const loc = useApp((s) => s.location());
  const now = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [loc?.lat, loc?.lon, Math.floor(time.getTime() / 3.6e6)]);
  const computed = now.data ? { alt: +now.data.sun.altitude.toFixed(1), az: +now.data.sun.azimuth.toFixed(0) } : null;
  const shown = override ?? computed;
  const set = (k: "alt" | "az", v: string) => {
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || !shown) return;
    setOverride({ ...shown, [k]: k === "alt" ? Math.max(-10, Math.min(90, n)) : ((n % 360) + 360) % 360 });
  };
  return (
    <div className="ms-override">
      <div className="ms-row">
        <label><span>Sun elevation °</span><input type="number" step={0.1} value={shown?.alt ?? ""} onChange={(e) => set("alt", e.target.value)} /></label>
        <label><span>Sun azimuth °</span><input type="number" step={1} value={shown?.az ?? ""} onChange={(e) => set("az", e.target.value)} /></label>
        {override && <button onClick={() => setOverride(null)}>Use computed</button>}
      </div>
      <div className="muted small">
        {override ? "⚠ Manual Sun: the cross section and landing conditions use these values instead of the ephemeris." : "Computed from the ephemeris at the slider time. Edit to try a what-if."}
      </div>
    </div>
  );
}
