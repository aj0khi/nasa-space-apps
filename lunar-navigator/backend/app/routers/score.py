"""Owner: LEAD."""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.models import Score
from app.services import ephemeris, scoring, terrain

router = APIRouter(tags=["score"])


@router.get("/score", response_model=Score)
def score(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
          start: datetime | None = None, days: float = Query(14, gt=0, le=60)):
    w = ephemeris.find_windows(lat, lon, start or datetime.now(timezone.utc), days, step_min=60)
    grid, _ = terrain.load_elevation(lat, lon, 20, 128)
    return scoring.score_site(w, terrain.center_slope_deg(grid, terrain.pixel_size_m(20, 128)))
