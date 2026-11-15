"""Where the Sun is, and which ground it lights, for the whole south-pole map. Owner: TERRAIN (+ ASTRO).

For each map pixel:
  1. Sun elevation & azimuth from that exact spot (the Sun is ~±1.5° from the pole's horizon,
     so 80°S on the sunward side sees it ~10° up while the far side is in night).
  2. March across the terrain toward the Sun; if any ridge (minus the Moon's curvature drop)
     rises above the Sun, the pixel is in shadow.
  3. Lit pixels are shaded by how squarely their slope faces the Sun (that's what solar panels feel).
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from contextlib import nullcontext
from functools import lru_cache

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from scipy import ndimage

from app.services import ephemeris, polar_dem, terrain

D = np.pi / 180
MAX_RAY_KM = 50.0


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def body_direction(when: datetime, body: str = "sun"):
    """Unit vector to the Sun/Earth in the Moon's mean-Earth frame, plus its sub-point lat/lon."""
    ts, eph, _, frame = ephemeris._kernels()
    t = ts.from_datetime(_utc(when))
    v = np.asarray((eph[body] - eph["moon"]).at(t).frame_xyz(frame).km, dtype=float)
    s = v / np.linalg.norm(v)
    return s, float(np.degrees(np.arcsin(s[2]))), float(np.degrees(np.arctan2(s[1], s[0])))


def _sun_geometry(s, lat, lon):
    """Per-pixel Sun elevation (rad) and the map-plane direction (dx, dy) that points at the Sun."""
    la, lo = lat * D, lon * D
    up = (np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la))
    north = (-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la))
    east = (-np.sin(lo), np.cos(lo), 0.0)
    dot = lambda a: s[0] * a[0] + s[1] * a[1] + s[2] * a[2]  # noqa: E731
    elev = np.arcsin(np.clip(dot(up), -1, 1))
    az = np.arctan2(dot(east), dot(north))
    (nx, ny), (ex, ey) = polar_dem.local_axes(lon)
    return elev, np.cos(az) * nx + np.sin(az) * ex, np.cos(az) * ny + np.sin(az) * ey


def _round_hour(when: datetime) -> str:
    w = _utc(when)
    return w.replace(minute=0, second=0, microsecond=0).isoformat()


def polar_illumination(when: datetime, min_lat: float = -80, res: int = 384) -> dict:
    path = terrain._dem_path()
    identity = terrain.dem_identity(path) if path else None
    return _polar_illumination(_round_hour(when), float(min_lat), int(res), identity)


@lru_cache(maxsize=6)
def _lola_grid(half_km: float, res: int, identity: tuple[str, int, int]) -> np.ndarray:
    pixel_m = 2 * half_km * 1000 / (res - 1)
    grid = np.full((res, res), np.nan, dtype=np.float32)
    # streamed NASA reads go one at a time (see terrain._REMOTE_LOCK); a local file needs no lock
    lock = terrain._REMOTE_LOCK if identity[0].startswith("/vsicurl/") else nullcontext()
    with lock, rasterio.open(identity[0], **terrain.overview_options(identity[0], pixel_m)) as dem:
        if dem.count != 1 or dem.crs is None:
            raise ValueError(f"DEM must have one elevation band and a lunar coordinate system: {identity[0]}")
        target_crs = f"+proj=stere +lat_0=-90 +lon_0=0 +R={terrain.MOON_RADIUS_M} +units=m +no_defs"
        reproject(
            source=rasterio.band(dem, 1),
            destination=grid,
            src_nodata=dem.nodata,
            dst_transform=from_origin(-half_km * 1000 - pixel_m / 2, half_km * 1000 + pixel_m / 2, pixel_m, pixel_m),
            dst_crs=target_crs,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    return grid


@lru_cache(maxsize=48)
def _polar_illumination(hour_iso: str, min_lat: float, res: int, identity: tuple[str, int, int] | None) -> dict:
    when = datetime.fromisoformat(hour_iso)
    half = polar_dem.ring_radius(min_lat) * 1.04
    px_km = 2 * half / (res - 1)

    # DEM with a margin so rays can see mountains just off the map edge
    margin = int(np.ceil(MAX_RAY_KM / px_km))
    big_res = res + 2 * margin
    big_half = half + margin * px_km
    if identity is None:
        bx, by, bz = polar_dem.grid(round(big_half, 6), big_res)
    else:
        v = np.linspace(-big_half, big_half, big_res)
        bx, by = np.meshgrid(v, v)
        bz = _lola_grid(big_half, big_res, identity)
    valid = np.isfinite(bz)
    valid_float = valid.astype(np.float32)
    safe_bz = np.where(valid, bz, 0)
    z = bz[margin:margin + res, margin:margin + res]
    x = bx[margin:margin + res, margin:margin + res]
    y = by[margin:margin + res, margin:margin + res]

    lat, lon = polar_dem.unproject(x, y)
    inside = lat <= min_lat

    s, sub_lat, sub_lon = body_direction(when, "sun")
    elev, dx, dy = _sun_geometry(s, lat, lon)
    tan_e = np.tan(elev)

    # ray-march toward the Sun: track the highest horizon angle (as a tangent) seen so far
    rows, cols = np.mgrid[0:res, 0:res].astype(float)
    rows += margin
    cols += margin
    horizon = np.full(z.shape, -np.inf)
    complete = valid[margin:margin + res, margin:margin + res].copy()
    z_safe = np.where(np.isfinite(z), z, 0)
    for d in np.geomspace(px_km * 0.8, MAX_RAY_KM, 72):
        ray = [rows + dy * d / px_km, cols + dx * d / px_km]
        sample_valid = ndimage.map_coordinates(valid_float, ray, order=1, mode="constant", cval=0) > 0.999
        zs = ndimage.map_coordinates(safe_bz, ray, order=1, mode="constant", cval=0)
        dm = d * 1000
        angle = (zs - z_safe) / dm - dm / (2 * polar_dem.R_MOON_KM * 1000)
        horizon = np.maximum(horizon, np.where(sample_valid, angle, -np.inf))
        complete &= sample_valid
    # no "elev > 0" test: from a peak the skyline is below the flat horizon (the Moon curves away),
    # so summits keep seeing a Sun that has already set for the flat ground around them
    lit = tan_e > horizon
    gradient_valid = ndimage.binary_erosion(valid)[margin:margin + res, margin:margin + res]
    known = inside & gradient_valid & (complete | ~lit)

    # how squarely each slope faces the Sun, and a fixed hillshade so shadowed terrain stays readable
    gy, gx = np.gradient(z_safe, px_km * 1000)
    norm = np.sqrt(gx ** 2 + gy ** 2 + 1)
    ce = np.cos(elev)
    facing = (-gx * dx * ce - gy * dy * ce + np.sin(elev)) / norm
    ambient = np.clip(0.55 + (-gx * -0.5 - gy * -0.6) * 3, 0, 1)

    b = np.where(lit, 48 + 78 * np.clip(facing / 0.2, 0, 1), 10 + 35 * ambient).astype(np.uint8)
    byte = np.where(lit, b | 128, b).astype(np.uint8)
    byte[~known] = 255  # outside the map or insufficient terrain coverage

    e_dir, e_lat, e_lon = body_direction(when, "earth")
    return {
        "time": hour_iso,
        "res": res,
        "half_km": half,
        "min_lat": min_lat,
        "data": base64.b64encode(byte.tobytes()).decode(),
        "lit_fraction": float(lit[known].mean()) if known.any() else None,
        "coverage_fraction": float(known[inside].mean()),
        "horizon_limit_km": MAX_RAY_KM,
        "pixel_km": px_km,
        "sun": {"subsolar_lat": sub_lat, "subsolar_lon": sub_lon, "elevation_at_pole": -sub_lat},
        "earth": {"sub_lat": e_lat, "sub_lon": e_lon, "elevation_at_pole": -e_lat},
        "synthetic": identity is None,
    }
