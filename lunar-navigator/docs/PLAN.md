# Project Plan

## 1. Challenge objectives → our features

| NASA objective | Our feature(s) | Status in notes | Owner |
|---|---|---|---|
| Interactive site selection & comparison | Curated site list, custom coords, status badge per site, side‑by‑side compare | Covered | MAP + GEO |
| Date & time flexibility | Date and time fill in automatically, date picker, sun slider, timeline across lunar days and seasons | Covered | SKY3D + ASTRO |
| Sun & Earth position visualization | Sky dome (alt/az vs horizon), sun visualization on each site, sunset/Earthset countdown | Covered | SKY3D + ASTRO |
| Power & communication assessment | Solar elevation, sunlight duration, Earth visibility windows → viability score | **Needs work** | LEAD + ASTRO |
| Multiple visualization approaches | 2D map tabs (Sun / Shadows / Rims), split view craters+rims, 3D surface, cross sections | Covered | MAP + TERRAIN + SKY3D |
| Temporal dynamics | Timeline animation over a lunar day (~29.5 Earth days) | Not marked yet | SKY3D |
| Accessibility across skill levels | Beginner/Expert toggle, explainer cards, Moon vs Earth facts, plain language | **Needs work** | LEAD + GEO |

## 2. Feature tiers

**MVP (must demo)**
- [ ] Site picker: curated list + custom lat/lon
- [ ] Date/time picker that fills in the current date and time
- [ ] Sun + Earth altitude/azimuth at site → sky dome view
- [ ] Sunset / Earthset countdown and sunlight %, Earth‑visible % over the next lunar day
- [ ] Viability score and a green/yellow/red status badge per site
- [ ] 2D map with tabs: **Sun position**, **Shadows**, **Rims**
- [ ] Sun slider that moves the sun and re‑renders shadows
- [ ] One cross‑section (elevation on y axis) through the site
- [ ] Beginner mode explainer cards

**Should have**
- [ ] Side‑by‑side compare (2–3 sites)
- [ ] Split view: crater floor vs rim illumination
- [ ] Timeline animation across a lunar day
- [ ] Up to 4 cross sections overlaid on one chart
- [ ] Mission panel: vehicle type, departure date, arrival date, journey distance and time → export JSON plan
- [ ] Moon vs Earth panel: month length, axial tilt, day/night length
- [ ] Resource info per site (water‑ice likelihood, PSR proximity)

**Stretch**
- [ ] 3D surface with a live sun light source
- [ ] Surface conditions (temperature estimate from illumination). This replaces the "weather" idea, since the Moon has no weather.
- [ ] Lunar phase / season indicator (phase as seen from Earth plus the site's local "time of day")
- [ ] Explainer chatbot ("Bot" in notes) that answers "why is this site red?"
- [ ] Measure crater/bump height from shadow length

## Screen layout (from the team sketch)

```
 ┌ 2D │ Cross section │ 3D ┐───────────────────────┬────────────────────────┐
 │                                                │ DATE  [day][month][year]│
 │   2D: south pole map, craters, □A □B □C markers│       ▶ ───●─────────── │
 │   Cross section: A ── site ── A′ sun profile   │ IDEAL LANDING LOCATIONS │
 │   3D: lit terrain + Sun/Shadows/Rims maps      │  A ✓  B ✗  C ✓ …        │
 │                                                │ SELECTED SITE           │
 │            Team 1 (MAP + SKY3D + TERRAIN)      │  status · window ·      │
 │                                                │  resources · cautions   │
 │                                                │ coordinates             │
 └────────────────────────────────────────────────┴────────────────────────┘
                                                     Team 2 (LEAD + ASTRO + GEO)
```
URL keeps the state: `#/2d`, `#/section?site=shackleton_rim`, `#/3d?lat=-89.5&lon=10`.

## 3. Team split (6 people)

| # | Role tag | Person | Focus | Key files |
|---|---|---|---|---|
| 1 | `GEO` | **Geography / Science & Story lead** | Site list + coordinates, resource data, scientific accuracy, explainer text, pitch script | `backend/app/data/sites.json`, `frontend/src/content/explanations.ts`, `docs/SCIENCE.md` |
| 2 | `ASTRO` | CS – **Ephemeris engine** (backend) | Sun/Earth alt‑az at site, rise/set events, sunlight & Earth‑visibility windows, phase, Moon‑vs‑Earth numbers | `backend/app/services/ephemeris.py`, `routers/ephemeris.py` |
| 3 | `TERRAIN` | CS – **Terrain & shadows** (backend) | Load LOLA DEM, elevation tiles, cross sections, shadow/illumination maps, rim detection | `backend/app/services/terrain.py`, `routers/terrain.py` |
| 4 | `MAP` | CS – **South pole map & site UX** (frontend) | 2D tab: south‑pole map (zoom/pan, lettered markers, click‑to‑analyse), Ideal Landing Locations list, coordinates bar, local map tabs, split view | `frontend/src/views/MapView.tsx`, `components/map/*`, `components/rail/LandingList.tsx`, `rail/CoordsBar.tsx`, `lib/geo.ts`, `lib/letters.ts` |
| 5 | `SKY3D` | CS – **Site page visuals** (frontend) | **Sun profile** (slice with sunlit/shaded ground, sun‑hours bar, seasons, time and bearing sliders), sky dome, timeline, 3D surface | `frontend/src/views/SectionView.tsx`, `ThreeDView.tsx`, `components/profile/*`, `sky/*`, `timeline/*`, `terrain/*`, `viz3d/*` |
| 6 | `LEAD` | CS – **Mission, scoring & integration** (full stack) | API contract, viability scoring, mission panel + export, beginner/expert mode, repo/CI/deploy, demo build | `backend/app/services/scoring.py`, `mission.py`, `frontend/src/App.tsx`, `router.ts`, `api/*`, `state/*`, `components/rail/DatePanel.tsx`, `rail/SelectedSite.tsx`, `components/mission/*` |

### Role details

**1. GEO — Geography / Science & Story** *(not coding-heavy, but a key role)*
- Check and fill in coordinates in `sites.json` (Apollo, Artemis III candidate regions, CLPS, Chang'e, Chandrayaan‑3, SLIM). Every entry has a `verified` flag.
- Add per‑site resource notes: distance to permanently shadowed regions (PSRs), likelihood of water ice, terrain type, slope.
- Explain the geography: why rims and not crater floors, how shadows give heights, why the south pole is special.
- Write all beginner‑mode text in `explanations.ts` and the Moon vs Earth facts.
- Sanity‑check outputs. Does Apollo 11 show the Sun at the right altitude on 1969‑07‑20? (It was low in the east, about 10°.)
- Own the pitch: the story, slides and the 2‑minute video script.

**2. ASTRO — Ephemeris engine**
- Implement `sun_earth_state(lat, lon, time)` with Skyfield (already started).
- Implement `find_windows()`: sunrise/sunset, Earthrise/Earthset, % lit and % Earth‑visible over N days.
- Later: horizon masks from TERRAIN so "sunset" accounts for crater walls, not just a flat horizon.
- Unit tests against known cases (Apollo 11 landing sun elevation; Earth never sets at near‑side sites).

**3. TERRAIN — Terrain & shadows**
- Download and crop LOLA south‑pole DEM tiles (see `backend/data/README.md`).
- Convert lat/lon to DEM pixels (polar stereographic projection via `pyproj`).
- Endpoints: elevation tile (PNG/array), cross section between two points, shadow mask for a given sun alt/az, rim mask.
- Keep the synthetic crater fallback working so the frontend is never blocked.

**4. MAP — 2D map & site UX**
- Map component with three tabs (Sun / Shadows / Rims). Top‑down view, not oblique.
- Site picker + custom coordinates form; status badge on each site marker.
- Compare table and split view (crater floor vs rim).

**5. SKY3D — Sky, time & 3D**
- Sky dome: polar plot of the horizon with Sun and Earth icons.
- Sun slider and timeline playback that drive `store.time`. All views re‑render from that one value.
- Cross‑section chart (Recharts) with up to 4 overlaid lines.
- Stretch: 3D surface mesh lit by a directional light at the sun's alt/az.

**6. LEAD — Mission, scoring & integration**
- Freeze `docs/API.md` and `frontend/src/types.ts` in hour 1. Changes after that need team sign-off.
- Viability scoring (power, comms, terrain) and status thresholds.
- Mission panel (vehicle, departure date, arrival date, journey) and JSON export.
- Beginner/Expert toggle, global state, deployment, final integration and demo rehearsal.

## 4. Timeline (48‑hour hackathon)

| Block | Everyone | Milestone |
|---|---|---|
| **H0–2** | Read this plan, agree on API.md, run backend + frontend locally | All 6 can run the app |
| **H2–12** | Build in parallel against **mock/synthetic** data | Each endpoint returns real‑shaped JSON; each component renders |
| **H12–24** | Real data: Skyfield, LOLA DEM, verified sites | Sun/Earth correct for 3 sites, real shadows for the south pole |
| **H24–36** | Integration: slider → shadows → score → badge | End‑to‑end MVP demo |
| **H36–42** | Should‑haves, polish, beginner text | Compare, split view, mission export |
| **H42–48** | Freeze code. Video, slides, submission | Submitted 🚀 |

Check‑ins: 10 minutes every 6 hours. Each person says what's done, what's next and what's blocking them.

## 5. Git workflow
- `main` is always demoable. Work on `feat/<role>-<thing>` branches and open small PRs. LEAD merges.
- Don't edit another role's files without pinging them. Shared files (`types.ts`, `models.py`, `API.md`) are owned by LEAD.
