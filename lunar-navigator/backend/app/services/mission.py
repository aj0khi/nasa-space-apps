"""Mission plan: vehicle + departure date → arrival, journey, landing conditions. Owner: LEAD."""
from __future__ import annotations

from datetime import timedelta

from app.models import MissionPlan, MissionRequest
from app.services import ephemeris, scoring, terrain

# Typical Earth→Moon transit times. TODO(GEO): cite sources / refine.
TRANSIT_DAYS = {
    "crewed_lander": 3.0,     # Apollo-style direct trajectory (~3 days)
    "robotic_lander": 6.0,    # CLPS direct-ish (IM-1 took ~7 days)
    "rover_delivery": 6.0,
}


def plan(req: MissionRequest) -> MissionPlan:
    days = TRANSIT_DAYS[req.vehicle]
    arrival = req.departure + timedelta(days=days)
    state = ephemeris.sun_earth_state(req.lat, req.lon, arrival)
    windows = ephemeris.find_windows(req.lat, req.lon, arrival, days=14)
    grid, _ = terrain.load_elevation(req.lat, req.lon)
    pixel_m = terrain.pixel_size_m(20, grid.shape[0])
    score = scoring.score_site(windows, terrain.center_slope_deg(grid, pixel_m))
    return MissionPlan(
        site_id=req.site_id, lat=req.lat, lon=req.lon, vehicle=req.vehicle,
        departure=req.departure, arrival=arrival, transit_days=days,
        distance_km=ephemeris.earth_moon_distance_km(arrival),
        landing_state=state, score=score,
    )
