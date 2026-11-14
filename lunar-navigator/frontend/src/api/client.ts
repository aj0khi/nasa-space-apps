// Typed API client. Owner: LEAD. One function per endpoint in docs/API.md.
import type {
  CompareResult, ElevationGrid, EvalAll, Features, HorizonsCheck, Illumination, Mask, MissionPlan, Profile, Score, Season,
  Site, SiteDetails, SunEarthState, Vehicle, Windows,
} from "../types";

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
  // A–H GO / NO-GO engine (/backend, see system_arch.md). Use 6-hour-aligned dates (sixHourKey).
  sites: (date: string, min_duration_days = 3) => get<EvalAll>("/sites", { date, min_duration_days }),
  siteDetails: (id: string, date: string, min_duration_days = 3) =>
    get<SiteDetails>(`/sites/${encodeURIComponent(id)}`, { date, min_duration_days }),
  compare: (site_a: string, date_a: string, site_b: string, date_b: string, min_duration_days = 3) =>
    get<CompareResult>("/compare", { site_a, date_a, site_b, date_b, min_duration_days }),
  horizonsValidate: (site_id: string, date: string) => get<HorizonsCheck>("/horizons-validate", { site_id, date }),
  catalog: () => get<Site[]>("/catalog"),
  state: (p: LatLon, time: string) => get<SunEarthState>("/ephemeris/state", { ...p, time }),
  windows: (p: LatLon, start: string, days = 30, step_min = 30) =>
    get<Windows>("/ephemeris/windows", { ...p, start, days, step_min }),
  seasons: (start: string) => get<Season[]>("/ephemeris/seasons", { start }),
  illumination: (time: string, min_lat: number, res = 384) =>
    get<Illumination>("/illumination/polar", { time, min_lat, res }),
  features: () => get<Features>("/features"),
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
