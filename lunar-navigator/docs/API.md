# API Contract (v0)

Base URL: `/api`. All times are ISO‑8601 UTC. All angles are in degrees. Longitude is east‑positive (−180…180).
Source of truth: `backend/app/models.py` ↔ `frontend/src/types.ts`. Keep them in sync.

## One server, two engines
`cd lunar-navigator/backend && .venv/bin/uvicorn app.main:app --reload --reload-dir app --port 8000` serves everything below.

| Paths | Engine | Used by |
|---|---|---|
| `/api/sites`, `/api/sites/{id}`, `/api/compare`, `/api/horizons-validate` | **A–H GO / NO-GO engine** in `/backend` (Diego). Spec: `/system_arch.md` | Rail (list, Selected Site, coordinates), map markers, Sky view, Timeline, Power & comms, Compare tab |
| `/api/illumination/polar`, `/api/features`, `/api/ephemeris/*`, `/api/terrain/*`, `/api/score`, `/api/mission/plan` | Map/terrain engine in `lunar-navigator/backend` | Map shading + Sun, cross section, 3D, seasons, custom points, mission plan |
| `/api/catalog` | Other notable sites (Apollo, Chang'e, CLPS…) | not shown in the UI yet |

The main server connects A–H evaluation to the same LOLA terrain reader as the terrain API.
Both ephemeris engines use JPL data and are checked for consistency (`tests/test_integration.py`).
The A–H engine asks the **live JPL Horizons API** first; offline it uses JPL DE421 via Skyfield.
Send it **6-hour-aligned dates** (00/06/12/18 UTC, see `sixHourKey` in the frontend) so slider moves hit its NASA cache.

## A–H evaluation (`/backend`, see `/system_arch.md` for every field)
`GET /api/sites?date=2026-11-16T18:00:00Z&min_duration_days=3` → `{ query_timestamp_utc, ephemeris_source, summary, sites: [...] }`
```json
{ "id": "A", "name": "Shackleton Connecting Ridge", "status": "CAUTION", "badge": "✓", "suitability_score": 77.5,
  "coordinates": { "lat": -89.45, "lon": 222.0, "elevation_m": 2120.0 },
  "is_sunlit": true, "has_earth_comm": false, "window_label": "Nov 01 – Dec 01, 2026 (15.0d left)",
  "sunlit_pct_30d": 100.0, "dte_comm_pct_30d": 46.3, "resources": ["…"], "cautions": ["…"] }
```
Longitudes may be 0–360 °E (the frontend normalises with `normLon`). Status → UI: GO ✓ green · CAUTION ⚠ yellow · NO_GO ✗ red.

`GET /api/sites/{id}?date=&min_duration_days=` → adds `ephemeris`, `visibility`, `window` (incl. `timeline_6h`, 121 steps ±15 d),
`horizon_angles_deg[360]`, `terrain_features`, `slope_deg`, `roughness_m`, `ice_distance_km`, `psr_name`, `cross_section_aa`.

Each site includes `terrain_source` (`LOLA` or `synthetic`) and `horizon_limit_km`
(`50` for LOLA, otherwise null). LOLA elevations, local slope, skyline and cross-section
come from a cached 100 km grid sampled at 200 m. The skyline uses a 2 m observer and
approximate lunar curvature; obstacles beyond 50 km are excluded. The standalone
root backend continues to use synthetic profiles. `roughness_m`, `ice_distance_km`,
`psr_name`, and `terrain_features` are unverified legacy assumptions; the status and
six-hour-sampled windows are exploratory, not validated landing guidance.

`GET /api/compare?site_a=A&date_a=&site_b=C&date_b=` → `{ recommended: {scenario, site_id, key_differences…}, scenario_1, scenario_2 }`

`GET /api/horizons-validate?site_id=A&date=` → local ephemeris + a live NASA JPL Horizons query for the same site/time.

## Catalog
`GET /api/catalog` → `Site[]` (from `app/data/sites.json`, owner GEO)

## Sun & Earth state at an instant
`GET /api/ephemeris/state?lat=&lon=&time=` → `SunEarthState`
```json
{ "time": "2026-11-14T12:00:00Z",
  "sun":   { "altitude": 4.2, "azimuth": 91.3, "distance_km": 1.49e8 },
  "earth": { "altitude": 12.0, "azimuth": 1.5, "distance_km": 384400 },
  "earth_phase_illum": 0.43, "moon_phase_name": "Waxing Crescent" }
```

## Windows over a period
`GET /api/ephemeris/windows?lat=&lon=&start=&days=30&step_min=30` → `Windows`
```json
{ "sun_events":   [{ "type": "rise", "time": "..." }, { "type": "set", "time": "..." }],
  "earth_events": [{ "type": "set",  "time": "..." }],
  "sunlit_fraction": 0.52, "earth_visible_fraction": 1.0,
  "next_sunset": "...", "next_earthset": null,
  "series": [{ "time": "...", "sun_alt": 3.1, "sun_az": 90.2, "earth_alt": 12.0, "earth_az": 1.4 }] }
```

## Lunar seasons
`GET /api/ephemeris/seasons?start=` → `Season[]` (next southern summer, southern winter and both equinoxes)
```json
[{ "key": "south_summer", "name": "Southern summer", "time": "2026-11-14T06:00:00Z", "subsolar_lat": -1.56 }]
```
The Sun's latitude on the Moon only swings ±1.54°, but at the pole that decides which rims stay lit.

## Sun & shadows on the south-pole map
`GET /api/illumination/polar?time=&min_lat=-80&res=384` → shaded-relief image lit by the real Sun (cached per hour)
```json
{ "time": "2026-11-14T20:00:00+00:00", "res": 384, "half_km": 316.4, "min_lat": -80,
  "data": "<base64 res×res bytes: 255 = outside or unknown, bit 7 = sunlit, bits 0–6 = brightness>",
  "lit_fraction": 0.46, "coverage_fraction": 0.9, "horizon_limit_km": 50, "pixel_km": 1.65,
  "sun":   { "subsolar_lat": -1.56, "subsolar_lon": 116.5, "elevation_at_pole": 1.56 },
  "earth": { "sub_lat": 5.1, "sub_lon": -3.2, "elevation_at_pole": -5.1 }, "synthetic": false }
```
Map coordinates are polar stereographic km, 0° longitude up, 90°E right (see `services/polar_dem.py`).
`lit_fraction` is the lit share of modeled pixels, or null if none are modeled;
`coverage_fraction` is their share of the requested map disc. With a DEM, missing
cells and rays are unknown unless a sampled blocker already proves shadow. The
model samples 72 distances up to 50 km, so farther blockers and subpixel features
are omitted. It uses a coarse DEM grid, approximate curvature and hourly Sun
positions; it is not validated mission guidance. Without a DEM the API reports
`synthetic: true` and relief mode stays blank instead of displaying synthetic relief.

`GET /api/features` → craters and massifs drawn on the map and used to build the terrain model.

`windows` now also returns `sun_visible_now`, `earth_visible_now`, `terrain_horizon`, and each series point carries `sun_horizon` / `earth_horizon`.

## Terrain
When a LOLA DEM is installed, local terrain requests at or south of 80°S use it;
responses mark the source with `synthetic: false`. Other locations or installations
without a DEM use synthetic terrain. Missing DEM cells within a requested tile produce
a 422 error. See `backend/data/README.md` for setup and scientific limitations.
The ephemeris-window skyline still uses synthetic terrain. The NASA LRO WAC photo
mode is a fixed mosaic, not current lighting; its image shadows do not change with
the selected date.

`GET /api/terrain/elevation?lat=&lon=&size_km=20&res=128` → `{ "grid": number[][], "pixel_m": 156.25, "min": -4200, "max": 1800, "synthetic": true }`

`GET /api/terrain/shadow?lat=&lon=&sun_alt=&sun_az=&size_km=20&res=128` → `{ "mask": (0|1)[][], "lit_fraction": 0.61, "synthetic": false }` (1 = lit; blocking terrain outside the tile is not considered)

`GET /api/terrain/rims?lat=&lon=&size_km=20&res=128` → `{ "mask": (0|1)[][], "synthetic": false }`

`POST /api/terrain/cross-section` body `{ "lat", "lon", "lines": [{ "azimuth": 0, "length_km": 10 }] }`
→ `{ "profiles": [{ "azimuth": 0, "distance_m": number[], "elevation_m": number[] }], "synthetic": true }`

## Sight lines for the cross section (owner: LEAD)
Additive. These do not change any endpoint above. Both read the LOLA DEM (a local file if installed, otherwise
NASA's copy over the network) and fall back to the synthetic model, with `synthetic: true` and a `note`, when
the DEM cannot be used or the point is north of 80°S.

`GET /api/terrain/skyline?lat=&lon=` → `Skyline`: the ray-traced terrain skyline at the site.
```json
{ "lat": -84.8, "lon": 29.2, "observer_m": 2.0,
  "elev_deg": [ 360 numbers ], "elev_max_deg": [ 360 ], "elev_min_deg": [ 360 ],
  "dist_km": [ 360 numbers or null ], "seen_km": [ 360 ], "edge_needs_m": [ 360 numbers or null ],
  "dem_top_m": 6975, "reach_km": 250.0, "site_elevation_m": 5334.4, "synthetic": false,
  "source": "LOLA DEM LDEM_80S_20MPP_ADJ.TIF (read from NASA)", "note": "…" }
```
- `elev_deg[i]`: how high the terrain rises above the lander's horizontal at azimuth `i`° (clockwise from north),
  seen from 2 m above the ground, with the Moon's curvature included. Mean over that degree.
  **The Sun or Earth is in view when the centre of its disc is above `elev_deg` at its azimuth** (interpolate
  between whole degrees). Do not add a separate curvature or "relief dip" term: it is already in the numbers.
- `elev_max_deg`, `elev_min_deg`: highest and lowest skyline inside that degree, for testing the edges of the disc.
- `dist_km[i]`: how far away the terrain that sets the skyline is. Under about 0.2 km it is the ground beside the
  lander, and the answer then depends on the assumed 2 m eye height more than on anything else.
- `seen_km[i]`: how far the terrain data reaches in that direction. The DEM stops at 80°S, so toward the north it
  can end before `reach_km`. `edge_needs_m[i]` is the elevation that ground just past the edge would need in order
  to rise above the skyline found (null where the data reaches all the way); compare it with `dem_top_m`, the
  highest ground in the whole file. `note` says this in words.

Accuracy: against an independent full-resolution calculation at six sites the skyline agrees to 0.007° RMS,
0.04° worst case. The Sun's radius is 0.27°. Sampling: 8 rays per degree; 1 m steps to 300 m, 5 m to 2 km, then
each step 0.3 % longer.

`GET /api/terrain/section?lat=&lon=&azimuth=0&length_km=8` → `Section`: the ground along a straight slice
through the site, `length_km` (0.5–150) toward `azimuth` and the same distance behind it.
```json
{ "azimuth": 90.0, "length_km": 8.0, "x_m": [ ... ], "z_m": [ ... ], "elevation_m": [ ... ],
  "site_elevation_m": 5334.4, "curvature": true, "synthetic": false, "source": "…", "note": null }
```
`x_m` is negative behind the site and positive toward `azimuth`. `z_m` is height above the lander's ground point
with curvature included, so a straight ray of light is a straight line when `x_m` and `z_m` share a scale.

The first request for a site takes about 2 s from a local DEM and roughly 10 to 25 s when the DEM is read remotely.
Results are cached in `backend/data/cache/` (not committed); the cache file names include a tag that changes
with the code and settings. Set `LOLA_REMOTE=0` to forbid network reads. If the terrain cannot be read at all,
`/terrain/section` answers 503.

## Viability score
`GET /api/score?lat=&lon=&start=&days=14` → `Score`
```json
{ "total": 72, "status": "green", "power": 80, "comms": 100, "terrain": 40,
  "reasons": ["Sun above horizon 61% of the time", "Earth always visible"] }
```
Status: green ≥ 70, yellow 40–69, red < 40 (LEAD tunes these).

## Mission plan
`POST /api/mission/plan` body `{ "site_id"?, "lat", "lon", "vehicle": "crewed_lander", "departure": "..." }`
→ `MissionPlan` (arrival, transit_days, distance_km, landing-window state, score) — downloadable JSON.
