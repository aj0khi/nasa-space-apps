# Lunar Landing Site Navigator 🌙

NASA Space Apps Challenge — a web app that helps mission planners **and** non-experts pick a lunar landing
site and date by showing where the **Sun and Earth** are from that spot, how **shadows** fall across craters
and rims, and whether the site/date gives enough **power** (sunlight) and **communication** (Earth in view).

> The pitch in one line: *"Pick a spot on the Moon and a date. We show you if the lights stay on and if you can
> phone home, and we explain why in plain language."*

## The story we tell (demo flow)

Start on the home page and select **Explore the lunar map**; existing links to
specific maps and sites still open the navigator directly.

1. **Pick a site.** Choose Apollo 11, Chandrayaan‑3, a south‑pole Artemis candidate, or type your own coordinates.
2. **Pick a date.** Drag the **sun slider** to explore modeled lighting. The photographic map is a fixed mosaic, not live imagery.
3. **Why rims?** Split view: the crater floor stays dark and holds ice, while the rim keeps sunlight. That's why we land on rims.
4. **Can we operate?** The status badge turns green, yellow or red based on power and comms windows, with a countdown to sunset and Earthset.
5. **Compare.** Put 2–3 sites side by side and see the trade‑offs.
6. **Plan the trip.** Pick a vehicle type, departure date and arrival date, then export a mission plan JSON (what would be "uploaded to the craft").

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
  ├─ services/scoring.py    power + comms + terrain → viability score + status
  └─ services/mission.py    vehicle, dates, journey → exportable mission plan
```

The rail (A–H GO / NO-GO, windows, resources, cautions) and the Compare tab come from the team's
evaluation engine in `/backend` (see `/system_arch.md`); `app/routers/evaluation.py` mounts it in this server,
so the frontend talks to a single API. `python backend/main.py` still runs that engine on its own.

The local terrain API and A–H evaluations on the main server read the same LOLA DEM
when installed; otherwise they report synthetic terrain. The 2D map offers
LOLA-derived sunlit relief whose estimated shadows follow the date slider, plus
NASA Moon Trek's fixed photographic, relief, elevation-color and slope imagery.
The estimated-shadow overlay is optional and off by default. Moon Trek imagery
does not provide numerical elevation for the 3D terrain or modeled shadows.
Unmodeled relief areas are
blank rather than filled with the photo. The topographic view switches between a
contour map and its A–A′ profile instead of displaying them together. Scores, shadows and windows are exploratory,
not validated landing guidance.
See [backend/data/README.md](backend/data/README.md) for DEM setup and limitations.

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
