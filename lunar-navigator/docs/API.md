# API Contract (v0)

Base URL: `/api`. All times are ISO‑8601 UTC. All angles are in degrees. Longitude is east‑positive (−180…180).
Source of truth: `backend/app/models.py` ↔ `frontend/src/types.ts`. Keep them in sync.

## Sites
`GET /api/sites` → `Site[]`
```json
{ "id": "apollo11", "name": "Apollo 11 – Tranquility Base", "lat": 0.674, "lon": 23.473,
  "program": "Apollo", "country": "USA", "year": 1969, "category": "historic",
  "resources": { "water_ice": "none", "psr_distance_km": null, "notes": "..." }, "verified": true }
```

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

## Terrain
`GET /api/terrain/elevation?lat=&lon=&size_km=20&res=128` → `{ "grid": number[][], "pixel_m": 156.25, "min": -4200, "max": 1800, "synthetic": true }`

`GET /api/terrain/shadow?lat=&lon=&sun_alt=&sun_az=&size_km=20&res=128` → `{ "mask": (0|1)[][], "lit_fraction": 0.61 }` (1 = lit)

`GET /api/terrain/rims?lat=&lon=&size_km=20&res=128` → `{ "mask": (0|1)[][] }`

`POST /api/terrain/cross-section` body `{ "lat", "lon", "lines": [{ "azimuth": 0, "length_km": 10 }] }`
→ `{ "profiles": [{ "azimuth": 0, "distance_m": number[], "elevation_m": number[] }], "synthetic": true }`

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
