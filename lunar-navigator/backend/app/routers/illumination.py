"""Sun, shadows and per-site 'right now' status for the south-pole map. Owner: TERRAIN (+ LEAD)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.models import Illumination, SiteNow
from app.routers.sites import all_sites
from app.services import ephemeris, illumination, polar_dem

router = APIRouter(tags=["illumination"])


@router.get("/illumination/polar", response_model=Illumination)
def polar(time: datetime | None = None, min_lat: float = Query(-80, ge=-89, le=-65), res: int = Query(384, ge=64, le=640)):
    """Shaded-relief image of the south pole lit by the real Sun at `time` (rounded to the hour)."""
    return illumination.polar_illumination(time or datetime.now(timezone.utc), min_lat, res)


@router.get("/features")
def features():
    """Craters and massifs drawn on the map (also the inputs to the terrain model)."""
    return polar_dem.features()


@router.get("/sites/now", response_model=list[SiteNow])
def sites_now(time: datetime | None = None):
    """For every south-polar site: is it in sunlight / in view of Earth at this instant (terrain included)?"""
    when = time or datetime.now(timezone.utc)
    return [SiteNow(id=s.id, **ephemeris.site_now(s.lat, s.lon, when))
            for s in all_sites() if polar_dem.covered(s.lat)]
