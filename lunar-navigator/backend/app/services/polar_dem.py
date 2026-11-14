"""Regional south-pole terrain model in polar stereographic map coordinates. Owner: TERRAIN.

Map convention (same as the frontend map, lib/geo.ts):
    x = r·sin(lon), y = −r·cos(lon), r = 2R·tan((90°+lat)/2)   [km]
    0° longitude (toward Earth) is up (−y), 90°E is right (+x). Rows run top→bottom (+y).

Elevation source, in order:
  1. REAL: NASA LRO LOLA south-pole DEM, data/dem/ldem_80s_80m.img (80 m/px, 80°S → pole, same
     projection as the map). Download it once with `python scripts/get_lola_dem.py`.
  2. SYNTHETIC fallback (no DEM file, or north of 80°S): every crater and massif in
     data/south_pole_features.json turned into a landform with crater depth/rim scaling laws
     (Pike 1977) on gentle rolling terrain. Realistic proportions, not the real surface.
Everything downstream (map shadows, horizons, windows, scores, cross sections, 3D) uses elevation_m().
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy import ndimage

R_MOON_KM = 1737.4
FEATURES_FILE = Path(__file__).resolve().parents[1] / "data" / "south_pole_features.json"
COVERAGE_LAT = -70.0  # the model covers everything south of this latitude
D = np.pi / 180

# NASA PDS LOLA GDR polar product (see data/dem/ldem_80s_80m.lbl)
DEM_FILE = Path(__file__).resolve().parents[2] / "data" / "dem" / "ldem_80s_80m.img"
DEM_N = 7600            # LINES = LINE_SAMPLES
DEM_SCALE_M = 80.0      # MAP_SCALE
DEM_DN_TO_M = 0.5       # SCALING_FACTOR: height above the 1737.4 km sphere = DN × 0.5 m
DEM_LAT = -80.0         # coverage: everything south of this
_force_synthetic = os.environ.get("LUNAR_SYNTHETIC_TERRAIN") == "1"


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
    return json.loads(FEATURES_FILE.read_text())


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


def _synthetic_elevation_m(x, y) -> np.ndarray:
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


# ---------------------------------------------------------------- real LOLA data
def set_force_synthetic(flag: bool) -> None:
    """Tests use the synthetic model so results don't depend on whether the DEM was downloaded."""
    global _force_synthetic
    _force_synthetic = flag
    _lola.cache_clear()
    grid.cache_clear()
    horizon_profile.cache_clear()


@lru_cache(maxsize=1)
def _lola() -> list[tuple[float, np.ndarray]] | None:
    """[(metres per pixel, DN array)] from fine to coarse, or None if the DEM isn't available.

    The 80 m grid is memory-mapped (read from disk on demand). 4× and 16× block means are built once
    so zoomed-out views sample a smoothed surface instead of every 20th pixel.
    """
    if _force_synthetic or not DEM_FILE.exists() or DEM_FILE.stat().st_size != DEM_N * DEM_N * 2:
        return None
    base = np.memmap(DEM_FILE, dtype="<i2", mode="r", shape=(DEM_N, DEM_N))
    k, n4 = 4, DEM_N // 4
    l4 = np.empty((n4, n4), dtype=np.float32)
    step = 400  # rows per chunk, keeps memory small
    for i in range(0, DEM_N, step):
        l4[i // k:(i + step) // k] = base[i:i + step].astype(np.float32).reshape(step // k, k, n4, k).mean(axis=(1, 3))
    l16 = l4.reshape(n4 // 4, 4, n4 // 4, 4).mean(axis=(1, 3))
    return [(DEM_SCALE_M, base), (DEM_SCALE_M * 4, l4), (DEM_SCALE_M * 16, l16)]


def real_dem_available() -> bool:
    return _lola() is not None


def is_real(lat: float) -> bool:
    """True when terrain at this latitude comes from NASA's LOLA data rather than the model."""
    return real_dem_available() and lat <= DEM_LAT


def elevation_m(x, y, res_km: float | None = None) -> np.ndarray:
    """Elevation (metres, relative to the 1737.4 km sphere) at map coordinates x, y (km). Vectorised.

    `res_km` = spacing the caller samples at; picks the matching LOLA level (avoids aliasing).
    Real LOLA data inside its coverage, synthetic model outside it.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    levels = _lola()
    if levels is None:
        return _synthetic_elevation_m(x, y)
    if x.ndim == 0 or y.ndim == 0:  # single point
        x, y = np.broadcast_arrays(x, y)
        return elevation_m(x.reshape(1), y.reshape(1), res_km).reshape(())
    want_m = max((res_km or 0) * 1000, DEM_SCALE_M)
    scale_m, arr = [lv for lv in levels if lv[0] <= want_m][-1]
    n = arr.shape[0]
    centre = (n - 1) / 2
    # Same orientation as our map: 0° longitude up (row decreases), 90°E right (column increases).
    col = centre + x * 1000 / scale_m
    row = centre + y * 1000 / scale_m
    inside = (col >= 0) & (col <= n - 1) & (row >= 0) & (row <= n - 1)
    if inside.all():
        return ndimage.map_coordinates(arr, [row, col], order=1, mode="nearest").astype(float) * DEM_DN_TO_M
    z = _synthetic_elevation_m(x, y)
    if inside.any():
        z[inside] = ndimage.map_coordinates(arr, [row[inside], col[inside]], order=1, mode="nearest") * DEM_DN_TO_M
    return z


@lru_cache(maxsize=16)
def grid(half_km: float, res: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(x, y, z_m) on a res×res grid spanning [−half, half] km. Row 0 = top (−y)."""
    v = np.linspace(-half_km, half_km, res)
    x, y = np.meshgrid(v, v)
    return x, y, elevation_m(x, y, res_km=2 * half_km / (res - 1))


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
