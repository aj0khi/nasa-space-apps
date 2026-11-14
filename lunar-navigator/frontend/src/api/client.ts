// Typed API client. Owner: LEAD. One function per endpoint in docs/API.md.
import type { ElevationGrid, Mask, MissionPlan, Profile, Score, Season, Site, SunEarthState, Vehicle, Windows } from "../types";

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`/api${path}?${qs}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

type LatLon = { lat: number; lon: number };

export const api = {
  sites: () => get<Site[]>("/sites"),
  state: (p: LatLon, time: string) => get<SunEarthState>("/ephemeris/state", { ...p, time }),
  windows: (p: LatLon, start: string, days = 30, step_min = 30) =>
    get<Windows>("/ephemeris/windows", { ...p, start, days, step_min }),
  seasons: (start: string) => get<Season[]>("/ephemeris/seasons", { start }),
  elevation: (p: LatLon, size_km = 20, res = 128) => get<ElevationGrid>("/terrain/elevation", { ...p, size_km, res }),
  shadow: (p: LatLon, sun_alt: number, sun_az: number, size_km = 20, res = 128) =>
    get<Mask>("/terrain/shadow", { ...p, sun_alt, sun_az, size_km, res }),
  rims: (p: LatLon, size_km = 20, res = 128) => get<Mask>("/terrain/rims", { ...p, size_km, res }),
  crossSection: (p: LatLon, lines: { azimuth: number; length_km: number }[]) =>
    post<{ profiles: Profile[]; synthetic: boolean }>("/terrain/cross-section", { ...p, lines }),
  score: (p: LatLon, start: string, days = 14) => get<Score>("/score", { ...p, start, days }),
  missionPlan: (p: LatLon & { site_id?: string; vehicle: Vehicle; departure: string }) =>
    post<MissionPlan>("/mission/plan", p),
};
