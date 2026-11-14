"""FastAPI entry point. Owner: LEAD."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ephemeris, illumination, mission, score, sites, terrain

app = FastAPI(title="Lunar Landing Site Navigator API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# illumination first: its /sites/now must win over sites' /sites/{site_id}
for r in (illumination.router, sites.router, ephemeris.router, terrain.router, score.router, mission.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
