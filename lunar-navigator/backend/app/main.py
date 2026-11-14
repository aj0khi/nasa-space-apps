"""FastAPI entry point: one server for the whole app. Owner: LEAD.

  /api/sites, /api/sites/{id}, /api/compare, /api/horizons-validate
        → A–H GO / NO-GO engine in /backend (see system_arch.md), mounted by routers/evaluation.py
  /api/illumination/*, /api/ephemeris/*, /api/terrain/*, /api/score, /api/mission/*, /api/features
        → map shadows, Sun/Earth positions, terrain, scores for any clicked point, mission plans
  /api/catalog → other notable landing sites (Apollo, Chang'e, CLPS…)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ephemeris, evaluation, illumination, mission, score, sites, terrain

app = FastAPI(title="Lunar Landing Site Navigator API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (evaluation.router, illumination.router, sites.router, ephemeris.router, terrain.router, score.router, mission.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    db = evaluation.get_terrain_db()
    return {
        "ok": True,
        "evaluation_sites": sorted(db["sites"].keys()),
        "terrain_dataset": db.get("dataset"),
        "ephemeris_source": evaluation.get_ephemeris_source(),
    }
