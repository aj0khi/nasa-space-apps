"""Sun and terrain shadows for the south-pole map. Owner: TERRAIN (+ LEAD)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.models import Illumination
from app.services import illumination, polar_dem

router = APIRouter(tags=["illumination"])


@router.get("/illumination/polar", response_model=Illumination)
def polar(time: datetime | None = None, min_lat: float = Query(-80, ge=-89, le=-65), res: int = Query(384, ge=64, le=640)):
    """Approximate shaded relief using the DEM and Sun at `time` (rounded to the hour)."""
    return illumination.polar_illumination(time or datetime.now(timezone.utc), min_lat, res)


@router.get("/features")
def features():
    """Craters and massifs drawn on the map (also the inputs to the terrain model)."""
    return polar_dem.features()
