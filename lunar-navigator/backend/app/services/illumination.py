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
    la = np.asarray(lat, dtype=np.float32) * np.float32(D)
    lo = np.asarray(lon, dtype=np.float32) * np.float32(D)
    cos_la, sin_la = np.cos(la), np.sin(la)
    cos_lo, sin_lo = np.cos(lo), np.sin(lo)
    s0, s1, s2 = np.float32(s[0]), np.float32(s[1]), np.float32(s[2])
    up_dot = s0 * (cos_la * cos_lo) + s1 * (cos_la * sin_lo) + s2 * sin_la
    north_dot = s0 * (-sin_la * cos_lo) + s1 * (-sin_la * sin_lo) + s2 * cos_la
    east_dot = s0 * (-sin_lo) + s1 * cos_lo
    elev = np.arcsin(np.clip(up_dot, -1.0, 1.0))
    az = np.arctan2(east_dot, north_dot)
    cos_az, sin_az = np.cos(az), np.sin(az)
    (nx, ny), (ex, ey) = polar_dem.local_axes(lon)
    return elev, cos_az * nx + sin_az * ex, cos_az * ny + sin_az * ey


@lru_cache(maxsize=8)
def _polar_coords(min_lat: float, res: int):
    half = polar_dem.ring_radius(min_lat) * 1.04
    px_km = 2 * half / (res - 1)
    margin = int(np.ceil(MAX_RAY_KM / px_km))
    big_res = res + 2 * margin
    big_half = half + margin * px_km
    v = np.linspace(-big_half, big_half, big_res, dtype=np.float32)
    bx, by = np.meshgrid(v, v)
    x = bx[margin:margin + res, margin:margin + res]
    y = by[margin:margin + res, margin:margin + res]
    lat, lon = polar_dem.unproject(x, y)
    inside = lat <= min_lat
    return half, px_km, margin, big_res, big_half, lat, lon, inside


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


@lru_cache(maxsize=64)
def _polar_illumination(hour_iso: str, min_lat: float, res: int, identity: tuple[str, int, int] | None) -> dict:
    when = datetime.fromisoformat(hour_iso)
    half, px_km, margin, big_res, big_half, lat, lon, inside = _polar_coords(min_lat, res)

    if identity is None:
        _, _, bz = polar_dem.grid(round(big_half, 6), big_res)
    else:
        bz = _lola_grid(big_half, big_res, identity)
    bz_f32 = np.asarray(bz, dtype=np.float32)
    valid = np.isfinite(bz_f32)
    all_valid = bool(valid.all())
    z = bz_f32[margin:margin + res, margin:margin + res]
    z_safe = z if all_valid else np.where(np.isfinite(z), z, np.float32(0.0))

    s, sub_lat, sub_lon = body_direction(when, "sun")
    elev, dx, dy = _sun_geometry(s, lat, lon)
    tan_e = np.tan(elev)

    # Fast vectorized 2D slice bilinear ray-marching toward the Sun:
    # Across the polar stereographic disc, sunlight rays are parallel to within <0.3 px over 50 km,
    # allowing zero-copy 2D array slicing instead of 144 full-grid scipy.ndimage.map_coordinates calls.
    horizon = np.full(z.shape, -np.inf, dtype=np.float32)
    complete = np.ones(z.shape, dtype=bool) if all_valid else valid[margin:margin + res, margin:margin + res].copy()
    c_idx = res // 2
    dx0 = float(dx[c_idx, c_idx])
    dy0 = float(dy[c_idx, c_idx])
    bz_pad = np.pad(bz_f32, 2, mode="constant", constant_values=np.nan)
    m_pad = margin + 2
    inv_2r = np.float32(1.0 / (2.0 * polar_dem.R_MOON_KM * 1000.0))

    for d in np.geomspace(px_km * 0.8, MAX_RAY_KM, 48):
        sr = m_pad + dy0 * (d / px_km)
        sc = m_pad + dx0 * (d / px_km)
        r0 = int(np.floor(sr))
        c0 = int(np.floor(sc))
        dr = np.float32(sr - r0)
        dc = np.float32(sc - c0)
        zs = np.float32((1.0 - dr) * (1.0 - dc)) * bz_pad[r0:r0 + res, c0:c0 + res]
        if dc > 1e-6:
            zs = zs + np.float32((1.0 - dr) * dc) * bz_pad[r0:r0 + res, c0 + 1:c0 + 1 + res]
        if dr > 1e-6:
            zs = zs + np.float32(dr * (1.0 - dc)) * bz_pad[r0 + 1:r0 + 1 + res, c0:c0 + res]
        if dr > 1e-6 and dc > 1e-6:
            zs = zs + np.float32(dr * dc) * bz_pad[r0 + 1:r0 + 1 + res, c0 + 1:c0 + 1 + res]
        dm = np.float32(d * 1000.0)
        angle = (zs - z_safe) / dm - dm * inv_2r
        np.fmax(horizon, angle, out=horizon)
        if not all_valid:
            complete &= np.isfinite(zs)

    # no "elev > 0" test: from a peak the skyline is below the flat horizon (the Moon curves away),
    # so summits keep seeing a Sun that has already set for the flat ground around them
    lit = tan_e > horizon
    gradient_valid = np.ones(z.shape, dtype=bool) if all_valid else ndimage.binary_erosion(valid)[margin:margin + res, margin:margin + res]
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
