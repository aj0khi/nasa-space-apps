// Mirror of backend/app/models.py. Owner: LEAD. Change both together.

export type Category = "historic" | "artemis" | "clps" | "international" | "custom";
export type Status = "green" | "yellow" | "red";
export type Vehicle = "crewed_lander" | "robotic_lander" | "rover_delivery";

export interface Resources {
  water_ice: "none" | "low" | "possible" | "likely" | "confirmed";
  psr_distance_km?: number | null;
  notes?: string;
}

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  program: string;
  country: string;
  year?: number | null;
  category: Category;
  resources: Resources;
  verified: boolean;
}

export interface BodyPosition { altitude: number; azimuth: number; distance_km: number }

export interface SunEarthState {
  time: string;
  sun: BodyPosition;
  earth: BodyPosition;
  earth_phase_illum: number;
  moon_phase_name: string;
}

export interface LunarEvent { type: "rise" | "set"; time: string }
export interface SeriesPoint {
  time: string;
  sun_alt: number;
  sun_az: number;
  earth_alt: number;
  earth_az: number;
  sun_horizon: number; // terrain horizon height toward the Sun (deg)
  earth_horizon: number;
}

export interface Windows {
  sun_events: LunarEvent[];
  earth_events: LunarEvent[];
  sunlit_fraction: number;
  earth_visible_fraction: number;
  next_sunset: string | null;
  next_earthset: string | null;
  sun_visible_now: boolean;
  earth_visible_now: boolean;
  terrain_horizon: boolean;
  series: SeriesPoint[];
}

/** Is a site in sunlight / in view of Earth at this instant (crater walls and mountains included)? */
export interface SiteNow {
  id: string;
  sun_alt: number;
  sun_az: number;
  sun_horizon: number;
  sun_visible: boolean;
  earth_alt: number;
  earth_az: number;
  earth_horizon: number;
  earth_visible: boolean;
}

export interface Illumination {
  time: string;
  res: number;
  half_km: number;
  min_lat: number;
  data: string; // base64 res×res bytes, row 0 = top. 255 = outside; bit 7 = sunlit; bits 0–6 = brightness
  lit_fraction: number;
  sun: { subsolar_lat: number; subsolar_lon: number; elevation_at_pole: number };
  earth: { sub_lat: number; sub_lon: number; elevation_at_pole: number };
  synthetic: boolean;
}

export interface Crater { name: string; lat: number; lon: number; diameter_km: number; depth_km?: number; psr: boolean }
export interface Massif { name: string; lat: number; lon: number; height_km: number; radius_km: number }
export interface Features { craters: Crater[]; massifs: Massif[] }

export interface Season {
  key: "south_summer" | "south_winter" | "equinox_north" | "equinox_south";
  name: string;
  time: string;
  subsolar_lat: number;
}

export interface ElevationGrid { grid: number[][]; pixel_m: number; min: number; max: number; synthetic: boolean }
export interface Mask { mask: number[][]; lit_fraction?: number | null }

export interface Profile { azimuth: number; distance_m: number[]; elevation_m: number[] }

export interface Score {
  total: number;
  status: Status;
  power: number;
  comms: number;
  terrain: number;
  reasons: string[];
}

export interface MissionPlan {
  site_id: string | null;
  lat: number;
  lon: number;
  vehicle: Vehicle;
  departure: string;
  arrival: string;
  transit_days: number;
  distance_km: number;
  landing_state: SunEarthState;
  score: Score;
}
