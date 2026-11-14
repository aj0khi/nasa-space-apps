"""Regional south-pole terrain model in polar stereographic map coordinates. Owner: TERRAIN.

Map convention (same as the frontend map, lib/geo.ts):
    x = r·sin(lon), y = −r·cos(lon), r = 2R·tan((90°+lat)/2)   [km]
    0° longitude (toward Earth) is up (−y), 90°E is right (+x). Rows run top→bottom (+y).

Until a real LOLA 80°S mosaic is loaded, elevation is SYNTHETIC: every crater and massif in
data/south_pole_features.json is turned into a landform using crater depth/rim scaling laws
(Pike 1977), on top of gentle rolling terrain. It is a stand-in with realistic proportions,
not a map of the real surface.

TODO(TERRAIN): load the LOLA 80°S polar stereographic DEM (already this projection) and sample it
in `elevation_m()` instead; everything downstream (shadows, horizons, scores) then becomes real.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

R_MOON_KM = 1737.4
FEATURES_FILE = Path(__file__).resolve().parents[1] / "data" / "south_pole_features.json"
COVERAGE_LAT = -70.0  # the model covers everything south of this latitude
D = np.pi / 180


# ---------------------------------------------------------------- projection
def project(lat, lon):
    r = 2 * R_MOON_KM * np.tan((90 + np.asarray(lat)) * D / 2)
    lon = np.asarray(lon) * D
    return r * np.sin(lon), -r * np.cos(lon)


def unproject(x, y):
    r = np.hypot(x, y)
    lat = 2 * np.arctan(r / (2 * R_MOON_KM)) / D - 90
    lon = np.arctan2(x, -y) / D
    return lat, lon


def ring_radius(lat: float) -> float:
    return float(2 * R_MOON_KM * np.tan((90 + lat) * D / 2))


def local_axes(lon):
    """Unit vectors (in map x,y) of local north and east at longitude `lon` (south polar map)."""
    l = np.asarray(lon) * D
    north = (np.sin(l), -np.cos(l))  # away from the pole
    east = (np.cos(l), np.sin(l))
    return north, east


# ---------------------------------------------------------------- features
@lru_cache(maxsize=1)
def features() -> dict:
    return json.loads(FEATURES_FILE.read_text(encoding="utf-8"))


def _pike(d_km: float) -> tuple[float, float]:
    """(depth, rim height) in km for a fresh lunar crater of diameter d (Pike 1977)."""
    if d_km < 15:
        return 0.196 * d_km ** 1.01, 0.036 * d_km ** 1.014
    return 1.044 * d_km ** 0.301, 0.236 * d_km ** 0.399


@lru_cache(maxsize=1)
def _landforms():
    craters = []
    for c in features()["craters"]:
        cx, cy = project(c["lat"], c["lon"])
        depth, rim = _pike(c["diameter_km"])
        depth = c.get("depth_km", depth)
        craters.append((float(cx), float(cy), c["diameter_km"] / 2, depth, rim, c["diameter_km"] >= 15))
    massifs = []
    for m in features()["massifs"]:
        mx, my = project(m["lat"], m["lon"])
        massifs.append((float(mx), float(my), m["radius_km"], m["height_km"]))
    rng = np.random.default_rng(7)
    waves = [(rng.uniform(0, 2 * np.pi), rng.uniform(0, 2 * np.pi), wl, 0.004 * wl)
             for wl in rng.uniform(6, 90, 14)]  # rolling terrain: (direction, phase, wavelength km, amplitude km)
    return craters, massifs, waves


def elevation_m(x, y) -> np.ndarray:
    """Synthetic elevation (metres) at map coordinates x, y (km). Vectorised."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    craters, massifs, waves = _landforms()
    z = np.zeros(np.broadcast(x, y).shape)
    for ang, ph, wl, amp in waves:
        z += amp * np.sin((x * np.cos(ang) + y * np.sin(ang)) * 2 * np.pi / wl + ph)
    for mx, my, rad, h in massifs:
        z += h * np.exp(-((x - mx) ** 2 + (y - my) ** 2) / rad ** 2)
    for cx, cy, rad, depth, rim, complex_ in craters:
        r = np.hypot(x - cx, y - cy) / rad
        near = r < 4
        if not near.any():
            continue
        rn = r[near]
        if complex_:  # flat floor over the inner ~35%
            ri = np.clip((rn - 0.35) / 0.65, 0, None)
        else:
            ri = rn
        inside = (rim + depth) * ri ** 2 - depth
        outside = rim * np.maximum(rn, 1) ** -3
        z[near] += np.where(rn < 1, inside, outside)
    return z * 1000.0


@lru_cache(maxsize=16)
def grid(half_km: float, res: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(x, y, z_m) on a res×res grid spanning [−half, half] km. Row 0 = top (−y)."""
    v = np.linspace(-half_km, half_km, res)
    x, y = np.meshgrid(v, v)
    return x, y, elevation_m(x, y)


# ---------------------------------------------------------------- horizons
@lru_cache(maxsize=512)
def horizon_profile(lat: float, lon: float, observer_m: float = 2.0, n_az: int = 180):
    """Terrain horizon (degrees above the ideal flat horizon) seen from (lat, lon), for n_az azimuths.

    Includes the Moon's curvature: a far peak sinks by d²/2R.
    """
    x0, y0 = project(lat, lon)
    z0 = float(elevation_m(x0, y0)) + observer_m
    north, east = local_axes(lon)
    az = np.linspace(0, 360, n_az, endpoint=False)
    a = az * D
    dx = np.cos(a) * north[0] + np.sin(a) * east[0]
    dy = np.cos(a) * north[1] + np.sin(a) * east[1]
    dist = np.geomspace(0.15, 250, 160)  # km
    px = x0 + dx[:, None] * dist[None, :]
    py = y0 + dy[:, None] * dist[None, :]
    z = elevation_m(px, py)
    dm = dist[None, :] * 1000
    ang = np.arctan((z - z0) / dm - dm / (2 * R_MOON_KM * 1000))
    return az, np.degrees(ang.max(axis=1))


def covered(lat: float) -> bool:
    return lat <= COVERAGE_LAT
