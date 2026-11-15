# SouthPoint: Lunar Landing Site Navigator 🌙

NASA Space Apps Challenge — an interactive prototype for comparing lunar landing-site scenarios.
SouthPoint shows modeled **Sun and Earth geometry**, terrain and illumination views, and heuristic
screening indicators for sunlight, direct-to-Earth visibility, and slope. It is designed to make
site-selection trade-offs understandable to both mission-planning teams and the public; it does not
certify a site as safe or suitable for a specific CLPS or crewed mission.

> The pitch in one line: *"Choose a lunar site and date, then explore how lighting, terrain, and
> Earth visibility change—so teams can compare scenarios and understand the trade-offs."*

## The story we tell (demo flow)

Start on the home page and select **Explore the lunar map**; existing links to
specific maps and sites still open the navigator directly.

1. **Pick a site.** Choose an A–H scenario, select a site from the catalog, or type custom coordinates.
   Catalog locations are evaluated with the custom-point model; unverified entries are labeled and
   should not be treated as confirmed landing-site coordinates.
   Sites outside the south-pole 2D map can still be selected.
2. **Pick a date and time.** Use the date controls, seasonal shortcuts, and **sun slider** to explore modeled lighting.
   The photographic map is a fixed mosaic, not live imagery.
3. **Explore the lighting trade-off.** Some permanently shadowed regions may preserve volatiles, while
   nearby elevated terrain may receive more sunlight. The visualization does not identify or confirm
   water ice at a selected site.
4. **Review the screening indicators.** The status badge summarizes heuristic sunlight, direct-to-Earth
   visibility, and slope indicators, with countdowns to modeled sunset and Earthset.
   A–H countdowns use six-hour samples up to 15 days ahead; custom-point estimates use the
   separate horizon model up to 30 days ahead. These are finite forecast windows: no event in the
   interval does not mean it will never occur.
5. **Compare scenarios.** Put 2–3 site/date combinations side by side to inspect their trade-offs.
6. **Explore a transit scenario.** Select a vehicle type and departure date to calculate an assumed
   arrival and export a mission-plan JSON. This is a planning artifact, not a trajectory solution,
   flight software, or command package to upload to a spacecraft.

## Architecture

```
frontend/  React + Vite + TypeScript
  ├─ 2D map with tabs (Sun / Shadows / Rims), split view, site picker, compare
  ├─ Sky dome (Sun + Earth vs horizon), sun slider, timeline animation
  ├─ 3D surface (react-three-fiber), cross-section chart
  └─ Mission panel, beginner/expert mode, explainer cards
        │  REST/JSON (contract in docs/API.md)
backend/   Python FastAPI — ONE server for everything (also mounts the A–H engine from /backend)
  ├─ services/ephemeris.py  Skyfield + JPL DE421 + lunar frame → Sun/Earth alt/az, windows
  ├─ services/terrain.py    LOLA DEM → elevation, cross sections, shadow/illumination maps
  ├─ services/scoring.py    sunlight + Earth visibility + slope → heuristic score and status
  └─ services/mission.py    assumed transit time + dates → illustrative mission plan
```

The A–H screening rail and Compare tab use the team's evaluation engine in `/backend`
(see `/system_arch.md`); `app/routers/evaluation.py` mounts it in this server, so the frontend talks
to a single API. `python backend/main.py` still runs that engine on its own. Green/yellow/red
statuses are prototype screening labels, not mission approval or NASA/CLPS go/no-go decisions.

The local terrain API and A–H evaluations on the main server read the same LOLA DEM
when installed; otherwise they report synthetic terrain. The 2D map offers
LOLA-derived sunlit relief whose estimated shadows follow the date slider, plus
NASA Moon Trek's fixed photographic, relief, elevation-color and slope imagery.
The estimated lighting overlay is optional. Moon Trek imagery does not provide
numerical elevation for the 3D terrain or modeled shadows.
Unmodeled relief areas are
blank rather than filled with the photo. The 2D map opens on LOLA Relief with a
lighting overlay. Without the DEM, the overlay uses synthetic terrain, so shadows are
illustrative and may not align with real features in the imagery. The separate
**Simulated shadows** map shows the same synthetic terrain without imagery. Without the
DEM, lighting uses a lower-resolution grid for faster updates and may lag behind the
selected time during playback.
The topographic view switches between a
contour map and its A–A′ profile instead of displaying them together. Scores, shadows and windows are exploratory,
not validated landing guidance.
See [backend/data/README.md](backend/data/README.md) for DEM setup and limitations.

## Scope and scientific limitations

SouthPoint is a **scenario exploration and comparison prototype**, not an operational landing-site
selection system. Its outputs depend on the selected time, site, ephemeris, terrain coverage, and
model assumptions.

- **Site score:** The current composite weights power at 45%, direct-to-Earth visibility at 35%, and
  terrain at 20%. The weights and status cutoffs are heuristic prototype choices, not published
  CLPS requirements. The terrain score uses a site-center slope statistic; it does not evaluate a
  landing ellipse, boulder hazards, or vehicle-specific landing limits.
- **Lighting and power:** Sun position and modeled visibility windows support comparisons across
  selected dates, with seasonal shortcuts. The power indicator is a proxy based on sunlight fraction
  and mean Sun elevation. It does not calculate solar-array output, panel orientation, battery state,
  electrical loads, or power available through a dark period.
- **Thermal environment:** The explainer includes general lunar temperature context, but the app
  does not predict surface or equipment temperatures at a selected site and time. It does not model
  lander thermal control, battery operating limits, heaters, or survival through lunar night. Ambient
  temperature facts should not be interpreted as equipment performance.
- **Communications:** The app estimates direct Earth line of sight and its terrain horizon where
  supported. It does not model a relay satellite, radio link budget, bandwidth, signal delay, command
  scheduling, or onboard autonomy. A warning about lost Earth visibility does not mean a relay is
  available or that a mission can safely operate autonomously.
- **Terrain and catalog:** Real terrain-dependent shadows and horizon checks require suitable LOLA DEM
  coverage. Without it, some views use labeled synthetic terrain and Earth-horizon calculations may
  use a flat horizon. Catalog entries marked unverified are not authoritative coordinates or evidence
  that a site is an approved CLPS destination.
- **Mission plan:** Vehicle transit durations are fixed illustrative assumptions. The exported JSON
  is not a validated trajectory, engineering analysis, or spacecraft command sequence.

Use the results to explain and compare trade-offs, not to select a real mission site without
independent engineering review and mission-specific requirements. For the team's science notes and
data sources, see [docs/SCIENCE.md](docs/SCIENCE.md).

### Background references

- [NASA Lunar Landing and Operations Policy Analysis](https://ntrs.nasa.gov/citations/20220015973)
- [NASA: The Lunar South Pole Region](https://www.nasa.gov/reference/moonbase-environment/)
- [NASA technical paper: Surviving Night at the Lunar South Pole](https://ntrs.nasa.gov/citations/20230008341)
- [NASA technical paper: Lunar Surface Communications Architecture](https://ntrs.nasa.gov/citations/20240008640)

## Quick start

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --reload-dir app --port 8000     # docs at http://localhost:8000/docs

# frontend (new terminal)
cd frontend
npm install
npm run dev                                   # http://localhost:5173 (proxies /api → :8000)
```

The first ephemeris call downloads about 20 MB of JPL kernels into `backend/data/kernels/`.

### Separate frontend and backend

By default the frontend uses the same-origin `/api` path, including the Vite
development proxy. To use a separately hosted backend, set
`VITE_API_BASE_URL` to its HTTPS origin (without `/api`) when building the
frontend. Vite embeds this public value in the build; rebuild and redeploy after
changing it. On the backend, set `CORS_ALLOWED_ORIGINS` to a comma-separated
list of exact frontend origins, for example `https://example.com`. Local Vite
development at `http://localhost:5173` remains allowed. Restart the backend
after changing its environment.

For a temporary demo, a Cloudflare Quick Tunnel can expose the local backend
over HTTPS. Its URL changes when the tunnel restarts, so update
`VITE_API_BASE_URL` and rebuild the frontend each time. The computer and tunnel
must remain running. The API is publicly reachable: CORS restricts browser
access to responses, but does not authenticate or protect the API from direct
requests. Quick Tunnels are for testing, not production.

For frontend builds from the repository root, run `npm install` followed by
`npm run build`. The root install uses the frontend lockfile and includes its
build tools even when the install environment is set to production.

## Hostinger hosting

[Hostinger supports Python on its self-managed VPS plans](https://www.hostinger.com/support/which-programming-languages-and-frameworks-are-supported-at-hostinger/).
The static frontend alone cannot run the FastAPI backend. This repository includes
a Docker Compose setup for a Hostinger VPS: Nginx serves the frontend and proxies
`/api` to the single backend. Hostinger's standard Web/Cloud plans do not support
the Python service. The Vite development proxy is not used in production.

### Deploy from GitHub

1. Push the repository to GitHub and merge the workflow into the default branch
   before running it manually. Set up a Hostinger VPS with Docker and the
   [Docker manager](https://www.hostinger.com/support/12040815-how-to-deploy-your-first-container-with-hostinger-docker-manager/).
2. Generate a Hostinger API key and add it as the GitHub Actions secret
   `HOSTINGER_API_KEY`. Add the VPS ID as the Actions variable `HOSTINGER_VM_ID`.
   Follow [Hostinger's GitHub Actions guide](https://www.hostinger.com/support/deploy-to-hostinger-vps-using-github-actions/).
3. In GitHub Actions, run **Deploy to Hostinger VPS** manually on the desired
   branch. It requests a deployment of `lunar-navigator/docker-compose.yml`;
   it does not deploy automatically on pushes. The repository must be accessible
   to Hostinger, including the root build context and both Dockerfiles. For a
   private repository, configure Hostinger's GitHub access first.
4. Configure a TLS-enabled reverse proxy for your domain to forward to
   `127.0.0.1:8080`. The Compose port is intentionally bound to localhost, so
   it is not publicly accessible until a proxy is configured. Check
   `curl http://127.0.0.1:8080/api/health` on the VPS and then check the same
   path over HTTPS. Configure the firewall and resource limits before launch.

Alternatively, clone the complete repository on the VPS and run
`docker compose -f lunar-navigator/docker-compose.yml up -d --build` from the
repository root. The image build excludes local DEMs and kernels. Kernels are
downloaded into a persistent volume on first use; the service needs outbound
network access. To supply the optional LOLA DEM, copy it into the backend's
`dem` volume as a temporary `.part` file, then rename it to a `.tif` file after
the copy completes. See [DEM setup](backend/data/README.md) for the source and
limitations. Without it, imagery works, but numerical terrain is synthetic and
the modeled polar relief is unavailable.

For example, from the repository root on the VPS, replace the source path with
the downloaded DEM:

```bash
docker compose -f lunar-navigator/docker-compose.yml cp /path/to/LOLA.tif backend:/app/lunar-navigator/backend/data/dem/LOLA.part
docker compose -f lunar-navigator/docker-compose.yml exec -u root backend sh -c 'chmod 644 data/dem/LOLA.part && mv data/dem/LOLA.part data/dem/LOLA.tif'
```

Keep only one TIFF in the DEM volume. The DEM persists across container
rebuilds; deleting the volume also deletes the dataset.

This deployment configuration has not been tested on a Hostinger VPS; validate
the build, proxy, HTTPS, storage and `/api/health` on your own server before launch.

## Docs

| File | What's in it |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Feature tiers, **6‑person work split**, timeline, Git workflow |
| [docs/API.md](docs/API.md) | The JSON contract between frontend and backend (agree on this first) |
| [docs/SCIENCE.md](docs/SCIENCE.md) | Moon facts, fixes to our notes, data sources, glossary (owned by Geography) |

## Who owns what

Search the code for `TODO(<ROLE>)` to find your tasks: `GEO`, `ASTRO`, `TERRAIN`, `MAP`, `SKY3D`, `LEAD`.
