# Lunar Landing Site Navigator 🌙

NASA Space Apps Challenge — a web app that helps mission planners **and** non-experts pick a lunar landing
site and date by showing where the **Sun and Earth** are from that spot, how **shadows** fall across craters
and rims, and whether the site/date gives enough **power** (sunlight) and **communication** (Earth in view).

> The pitch in one line: *"Pick a spot on the Moon and a date. We show you if the lights stay on and if you can
> phone home, and we explain why in plain language."*

## The story we tell (demo flow)

1. **Pick a site.** Choose Apollo 11, Chandrayaan‑3, a south‑pole Artemis candidate, or type your own coordinates.
2. **Pick a date.** It fills in today's date by default. Drag the **sun slider** and watch shadows sweep across craters.
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

The backend works **offline from day 1**. If no real DEM is downloaded, `terrain.py` creates a fake crater so the
frontend team is never blocked.

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

## Docs

| File | What's in it |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Feature tiers, **6‑person work split**, timeline, Git workflow |
| [docs/API.md](docs/API.md) | The JSON contract between frontend and backend (agree on this first) |
| [docs/SCIENCE.md](docs/SCIENCE.md) | Moon facts, fixes to our notes, data sources, glossary (owned by Geography) |

## Who owns what

Search the code for `TODO(<ROLE>)` to find your tasks: `GEO`, `ASTRO`, `TERRAIN`, `MAP`, `SKY3D`, `LEAD`.
