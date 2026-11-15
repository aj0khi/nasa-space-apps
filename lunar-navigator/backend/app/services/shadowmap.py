"""Per-pixel horizon map around a site (GET /terrain/shadow-map). Owner: LEAD. Contract: app.models.ShadowMap."""
from __future__ import annotations


def shadow_map(lat: float, lon: float, size_km: float, res: int, observer_m: float) -> dict:
    raise NotImplementedError("shadow-map is not built yet")
