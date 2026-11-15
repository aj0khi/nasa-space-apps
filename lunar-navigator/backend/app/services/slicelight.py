"""Ray-traced light along a slice (GET /terrain/slice-light). Owner: LEAD. Contract: app.models.SliceLight."""
from __future__ import annotations

from datetime import datetime


def slice_light(lat: float, lon: float, azimuth: float, length_km: float, start: datetime | None, days: float,
                step_min: int, observer_m: float, points: int) -> dict:
    raise NotImplementedError("slice-light is not built yet")
