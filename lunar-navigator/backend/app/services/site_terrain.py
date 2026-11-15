"""LOLA-derived terrain for the A–H evaluation engine."""
from __future__ import annotations

from functools import lru_cache, partial
from typing import Any

import numpy as np
from scipy import ndimage

from app.services import terrain

SIZE_KM = 100.0
RESOLUTION = 501
OBSERVER_HEIGHT_M = 2.0


@lru_cache(maxsize=16)
def _site_grid(lat: float, lon: float, path: str, modified_ns: int, size: int) -> tuple[np.ndarray, np.ndarray, float]:
    grid, synthetic = terrain.load_elevation(lat, lon, SIZE_KM, RESOLUTION)
    if synthetic:
        raise ValueError(f"LOLA terrain is not available for {lat}, {lon}.")
    pixel_m = terrain.pixel_size_m(SIZE_KM, RESOLUTION)
    center = (RESOLUTION - 1) / 2
    azimuths = np.radians(np.arange(360))
    distances = np.linspace(pixel_m, SIZE_KM * 500, RESOLUTION // 2)
    rows = center - np.cos(azimuths[:, None]) * distances / pixel_m
    cols = center + np.sin(azimuths[:, None]) * distances / pixel_m
    elevations = ndimage.map_coordinates(grid, [rows, cols], order=1, mode="nearest")
    drop = distances ** 2 / (2 * terrain.MOON_RADIUS_M)
    angles = np.degrees(np.arctan2(elevations - grid[int(center), int(center)] - OBSERVER_HEIGHT_M - drop, distances))
    return grid, angles.max(axis=1), pixel_m


def _section(grid: np.ndarray, pixel_m: float, site_id: str, sun_az: float,
             sun_alt: float, sun_horizon: float) -> dict[str, Any]:
    center = (grid.shape[0] - 1) / 2
    distance_km = np.linspace(-8, 8, 41)
    azimuth = np.radians(sun_az)
    rows = center - distance_km * 1000 * np.cos(azimuth) / pixel_m
    cols = center + distance_km * 1000 * np.sin(azimuth) / pixel_m
    elevation = ndimage.map_coordinates(grid, [rows, cols], order=1, mode="nearest")
    toward_dist, toward_elevation = terrain.cross_section(grid, pixel_m, sun_az, SIZE_KM / 2, n=251)
    distance = np.asarray(toward_dist[1:])
    angle = np.arctan2(
        np.asarray(toward_elevation[1:]) - grid[int(center), int(center)]
        - OBSERVER_HEIGHT_M - distance ** 2 / (2 * terrain.MOON_RADIUS_M), distance
    )
    ridge_km = float(toward_dist[1:][int(np.argmax(angle))]) / 1000
    tan_sun = np.tan(np.radians(sun_alt))
    points = []
    for i, x in enumerate(distance_km):
        ahead = elevation[i:]
        ray = np.max(ahead - (distance_km[i:] - x) * 1000 * tan_sun)
        points.append({
            "distance_km": round(float(x), 2),
            "terrain_elevation_m": round(float(elevation[i]), 1),
            "sun_ray_elevation_m": round(float(ray), 1),
            "in_shadow": bool(
                sun_alt - sun_horizon <= -0.15 if i == len(distance_km) // 2
                else ray > elevation[i] + 1e-6
            ),
        })
    return {
        "section_label": f"LOLA profile opposite Sun → Site {site_id} → Sun ({sun_az:.0f}°)",
        "sun_azimuth_deg": sun_az,
        "sun_elevation_deg": sun_alt,
        "blocking_horizon_deg": sun_horizon,
        "ridge_distance_km": round(ridge_km, 1),
        "pad_elevation_m": round(float(grid[int(center), int(center)]), 1),
        "profile_points": points,
    }


def prepare_site(site: dict[str, Any]) -> dict[str, Any]:
    src = terrain.dem_source()
    if src is None:
        return {**site, "terrain_source": "synthetic"}
    target, (ident, modified_ns, size) = src
    coords = site["coordinates"]
    lon = (float(coords["lon"]) + 180) % 360 - 180
    try:
        grid, horizon, pixel_m = _site_grid(float(coords["lat"]), lon, ident, modified_ns, size)
    except ValueError:
        if terrain.is_remote(target) and not terrain.remote_available():
            return {**site, "terrain_source": "synthetic"}  # NASA unreachable right now
        raise
    center = (grid.shape[0] - 1) // 2
    return {
        **site,
        "coordinates": {**coords, "elevation_m": round(float(grid[center, center]), 1)},
        "slope_deg": round(terrain.center_slope_deg(grid, pixel_m), 1),
        "horizon_angles_deg": np.round(horizon, 3).tolist(),
        "terrain_source": "LOLA",
        "horizon_limit_km": SIZE_KM / 2,
        "_section": partial(_section, grid, pixel_m, site["id"]),
    }
