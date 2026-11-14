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
export interface SeriesPoint { time: string; sun_alt: number; sun_az: number; earth_alt: number; earth_az: number }

export interface Windows {
  sun_events: LunarEvent[];
  earth_events: LunarEvent[];
  sunlit_fraction: number;
  earth_visible_fraction: number;
  next_sunset: string | null;
  next_earthset: string | null;
  series: SeriesPoint[];
}

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
