// Vehicle type, departure date → arrival, journey, landing conditions → export JSON ("upload to the craft"). Owner: LEAD.
import { useState } from "react";
import { api } from "../../api/client";
import { useApp } from "../../state/store";
import type { MissionPlan, Vehicle } from "../../types";

const VEHICLES: { key: Vehicle; label: string }[] = [
  { key: "crewed_lander", label: "Crewed lander" },
  { key: "robotic_lander", label: "Robotic lander" },
  { key: "rover_delivery", label: "Rover delivery" },
];

export default function MissionPanel() {
  const baseTime = useApp((s) => s.baseTime);
  const loc = useApp((s) => s.location());
  const [vehicle, setVehicle] = useState<Vehicle>("robotic_lander");
  const [plan, setPlan] = useState<MissionPlan | null>(null);
  const [busy, setBusy] = useState(false);

  async function makePlan() {
    if (!loc) return;
    setBusy(true);
    try {
      setPlan(await api.missionPlan({ lat: loc.lat, lon: loc.lon, site_id: loc.site?.id, vehicle, departure: baseTime.toISOString() }));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "mission-plan.json" });
    a.click();
  }

  return (
    <div className="panel">
      <h3>Mission plan</h3>
      <select value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>
        {VEHICLES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
      </select>{" "}
      <span>Departs {baseTime.toUTCString()}</span>{" "}
      <button onClick={makePlan} disabled={busy || !loc}>{busy ? "Planning…" : "Plan mission"}</button>
      {plan && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            <tr><td>Arrives</td><td>{new Date(plan.arrival).toUTCString()}</td></tr>
            <tr><td>Journey</td><td>{plan.transit_days} days · {Math.round(plan.distance_km).toLocaleString()} km</td></tr>
            <tr><td>Sun at landing</td><td>{plan.landing_state.sun.altitude.toFixed(1)}°</td></tr>
            <tr><td>Earth at landing</td><td>{plan.landing_state.earth.altitude.toFixed(1)}°</td></tr>
            <tr><td>Status</td><td><span className={`badge ${plan.score.status}`} />{plan.score.total}/100</td></tr>
          </tbody>
        </table>
      )}
      {plan && <button onClick={download}>⬇ Export plan (JSON)</button>}
      {/* TODO(LEAD): suggest the best departure date in the next 60 days (scan arrival scores) */}
    </div>
  );
}
