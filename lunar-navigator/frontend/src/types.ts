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

export interface Illumination {
  time: string;
  res: number;
  half_km: number;
  min_lat: number;
  data: string; // 255 = outside or unknown; bit 7 = sunlit; bits 0–6 = brightness
  lit_fraction: number | null;
  coverage_fraction: number;
  horizon_limit_km: number;
  pixel_km: number;
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
export interface Mask { mask: number[][]; lit_fraction?: number | null; synthetic: boolean }

export interface Profile { azimuth: number; distance_m: number[]; elevation_m: number[] }

/** GET /terrain/skyline: ray-traced terrain skyline seen from the lander (owner: LEAD). */
export interface Skyline {
  lat: number;
  lon: number;
  observer_m: number; // eye height above the ground
  elev_deg: number[]; // 360 values; index = azimuth in whole degrees, clockwise from north; mean over that degree
  elev_max_deg?: number[] | null; // highest skyline inside that degree
  elev_min_deg?: number[] | null; // lowest skyline inside that degree
  dist_km: (number | null)[]; // distance to the terrain that sets the skyline (null in the synthetic model)
  seen_km?: number[] | null; // how far the terrain data reaches in that direction (it stops at 80°S)
  edge_needs_m?: (number | null)[] | null; // where the data ends early: elevation that ground past the edge would need to raise the skyline
  dem_top_m?: number | null; // highest ground in the whole terrain file
  reach_km: number;
  site_elevation_m?: number | null;
  synthetic: boolean;
  source: string;
  note?: string | null;
}

/** GET /terrain/section: ground along a straight slice through the site (owner: LEAD). */
export interface Section {
  azimuth: number; // direction of positive x, degrees clockwise from north
  length_km: number; // reach each way from the site
  x_m: number[]; // negative behind the site (azimuth + 180), positive toward `azimuth`
  z_m: number[]; // height relative to the lander's ground point; includes the Moon's curvature when `curvature`
  elevation_m: number[];
  site_elevation_m: number;
  curvature: boolean;
  synthetic: boolean;
  source: string;
  note?: string | null;
}

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

// ---------------------------------------------------------------------------------------------
// A–H evaluation engine (/backend: evaluator.py, ephemeris.py). Shapes mirror its JSON exactly.
// Endpoints: /api/sites, /api/sites/{id}, /api/compare, /api/horizons-validate (system_arch.md)
// ---------------------------------------------------------------------------------------------
export type EvalStatus = "GO" | "CAUTION" | "NO_GO";

export interface EvalCoords { lat: number; lon: number; elevation_m: number } // lon may be 0–360 °E

export interface EngineBody {
  azimuth_deg: number;
  elevation_deg: number;
  sub_lat_deg: number;
  sub_lon_deg: number;
  angular_radius_deg: number;
}

export interface EngineEphemeris {
  timestamp_utc: string;
  julian_date: number;
  ephemeris_source: string;
  relief_dip_deg: number;
  sun: EngineBody;
  earth: EngineBody;
}

/** One row of GET /api/sites → sites[] */
export interface EvalSite {
  id: string;
  name: string;
  region: string;
  mission_context: string;
  coordinates: EvalCoords;
  map_xy: { x: number; y: number };
  slope_deg: number;
  terrain_source: "LOLA" | "synthetic";
  horizon_limit_km: number | null;
  status: EvalStatus;
  is_go: boolean;
  badge: string;
  suitability_score: number;
  is_sunlit: boolean;
  has_earth_comm: boolean;
  sun_azimuth_deg: number;
  sun_elevation_deg: number;
  sun_horizon_deg: number;
  sun_margin_deg: number;
  earth_azimuth_deg: number;
  earth_elevation_deg: number;
  earth_margin_deg: number;
  window_label: string;
  window_start_utc: string; // "YYYY-MM-DD HH:MM UTC"
  window_end_utc: string;
  remaining_sunlit_days: number;
  sunlit_pct_30d: number;
  dte_comm_pct_30d: number;
  resources: string[];
  cautions: string[];
}

export interface EvalAll {
  query_timestamp_utc: string;
  ephemeris_source: string;
  min_duration_days: number;
  south_pole_ephemeris: EngineEphemeris;
  summary: { total_sites: number; viable_sites_count: number; recommended_backup_site: string; recommended_backup_name: string };
  sites: EvalSite[];
}

export interface TimelineStep {
  offset_hours: number;
  timestamp_utc: string;
  date_label: string;
  is_sunlit: boolean;
  has_earth_comm: boolean;
  sun_alt_deg: number;
  sun_horizon_deg: number;
  sun_margin_deg: number;
  earth_alt_deg: number;
}

export interface EvalWindow {
  currently_sunlit: boolean;
  window_start_utc: string;
  window_end_utc: string;
  window_label: string;
  remaining_sunlit_days: number;
  total_window_days: number;
  hours_until_sunlight: number;
  sunlit_pct_30d: number;
  dte_comm_pct_30d: number;
  timeline_6h: TimelineStep[]; // −15 d … +15 d around the query time
}

/** GET /api/sites/{id} */
export interface SiteDetails {
  id: string;
  name: string;
  region: string;
  mission_context: string;
  query_timestamp_utc: string;
  coordinates: EvalCoords;
  slope_deg: number;
  terrain_source: "LOLA" | "synthetic";
  horizon_limit_km: number | null;
  roughness_m: number;
  ice_distance_km: number;
  psr_name: string;
  status: EvalStatus;
  is_go: boolean;
  badge: string;
  suitability_score: number;
  ephemeris: EngineEphemeris;
  visibility: {
    is_sunlit: boolean;
    sun_horizon_deg: number;
    sun_margin_deg: number;
    has_earth_comm: boolean;
    earth_horizon_deg: number;
    earth_margin_deg: number;
  };
  window: EvalWindow;
  resources: string[];
  cautions: string[];
  horizon_angles_deg: number[]; // 360 values, index = azimuth°
  terrain_features: { name: string; az: number; width: number; height_deg: number; dist_km: number }[];
  cross_section_aa: unknown; // conceptual slice; the Cross section tab draws the terrain model instead
}

/** GET /api/compare */
export interface CompareResult {
  recommended: {
    scenario: 1 | 2;
    site_id: string;
    site_name: string;
    date_utc: string;
    suitability_score: number;
    key_differences: string[];
  };
  scenario_1: SiteDetails;
  scenario_2: SiteDetails;
}

/** GET /api/horizons-validate */
export interface HorizonsCheck {
  site_id: string;
  site_name: string;
  timestamp_utc: string;
  local_ephemeris: EngineEphemeris;
  nasa_jpl_horizons: { source: string; status: string; request_url?: string; raw_excerpt?: string; note?: string };
}

/** GET /terrain/slice-light: for every ground point along a slice and every time step, is the body in view from there? (owner: LEAD) */
export interface SliceLight {
  azimuth: number;
  length_km: number;
  observer_m: number;
  x_m: number[]; // N positions along the slice, same convention as Section.x_m, evenly spaced
  times: string[]; // T instants (ISO, UTC): the same grid as /ephemeris/windows for the same start, days and step
  sun: string[]; // T strings of N characters: "1" = the Sun's centre is above that point's ray-traced skyline
  earth: string[]; // same for Earth
  sun_hours: number[]; // per point: hours with the Sun in view over the whole series
  earth_hours: number[];
  synthetic: boolean;
  source: string;
  note?: string | null;
}

/** GET /terrain/shadow-map: terrain around the site plus a per-pixel horizon, for drawing real shadows (owner: LEAD). */
export interface ShadowMap {
  lat: number;
  lon: number;
  size_km: number; // the map is size_km across, centred on the site, north of the site at the top
  res: number; // res x res pixels
  observer_m: number;
  az_step_deg: number; // the horizon is given every az_step_deg of azimuth (0, step, 2 x step ...)
  elevation_m: number[]; // res*res heights, row-major, row 0 = north edge, column 0 = west edge
  horizon_b64: string; // base64 of uint8[res*res*(360/az_step_deg)], pixel-major then azimuth
  horizon_scale: number; // angle (deg) = value * horizon_scale + horizon_offset
  horizon_offset: number; // angles are in the lander's level frame: compare directly with the body's altitude at the site
  synthetic: boolean;
  source: string;
  note?: string | null;
}
