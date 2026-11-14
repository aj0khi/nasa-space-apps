"""Owner: ASTRO."""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.models import Season, SunEarthState, Windows
from app.services import ephemeris

router = APIRouter(prefix="/ephemeris", tags=["ephemeris"])

Lat = Query(..., ge=-90, le=90)
Lon = Query(..., ge=-180, le=180)


@router.get("/state", response_model=SunEarthState)
def state(lat: float = Lat, lon: float = Lon, time: datetime | None = None):
    return ephemeris.sun_earth_state(lat, lon, time or datetime.now(timezone.utc))


@router.get("/seasons", response_model=list[Season])
def seasons(start: datetime | None = None):
    return ephemeris.lunar_seasons(start or datetime.now(timezone.utc))


@router.get("/windows", response_model=Windows)
def windows(lat: float = Lat, lon: float = Lon, start: datetime | None = None,
            days: float = Query(30, gt=0, le=90), step_min: int = Query(30, ge=5, le=360)):
    return ephemeris.find_windows(lat, lon, start or datetime.now(timezone.utc), days, step_min)
