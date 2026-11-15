"""Elevation, cross sections, shadows and rims. Owner: TERRAIN.

Grid convention (all endpoints): row 0 = north edge, col 0 = west edge, site at the center.
Azimuth is clockwise from north (east = +col, north = -row).

The south-pole LOLA DEM is used when available; other locations use synthetic terrain.
DEM source, in order: a file in data/dem/, the repo-root LDEM_80S_20MPP_ADJ.tiff, or (no download needed)
NASA's copy read remotely in small windows. NASA's GeoTIFF is tiled (512×512) with overviews, so only the
needed tiles are fetched. Set LOLA_REMOTE=0 to turn remote reading off, or LOLA_DEM_URL to use another copy.
"""
from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from rasterio.errors import RasterioIOError
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from app.services import polar_dem

DEM_DIR = Path(__file__).resolve().parents[2] / "data" / "dem"
LOCAL_DEM = Path(__file__).resolve().parents[4] / "LDEM_80S_20MPP_ADJ.tiff"
MOON_RADIUS_M = 1_737_400.0

REMOTE_DEM_URL = os.environ.get("LOLA_DEM_URL", "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF")
REMOTE_ENABLED = os.environ.get("LOLA_REMOTE", "1") != "0"
REMOTE_RETRY_S = 300  # after a network failure, use synthetic terrain for this long before trying NASA again
# GDAL settings for fast windowed reads over HTTP (only used for the remote copy)
for _k, _v in {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".TIF,.tif,.tiff",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": str(256 * 1024 * 1024),
    "GDAL_CACHEMAX": "512",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "30",
    "GDAL_HTTP_MAX_RETRY": "3",
}.items():
    os.environ.setdefault(_k, _v)

_remote_lock = threading.Lock()  # one GDAL dataset is not safe to share between threads
_remote_open: dict[int | None, rasterio.io.DatasetReader] = {}
_remote_down_until = 0.0


# ---------------------------------------------------------------- elevation
def pixel_size_m(size_km: float, res: int) -> float:
    return size_km * 1000.0 / (res - 1)


def _synthetic_crater(size_km: float, res: int) -> np.ndarray:
    """Bowl-shaped crater (diameter = 60% of tile) with a raised rim, plus small bumps."""
    half = size_km * 500.0  # metres
    y, x = np.mgrid[-half:half:res * 1j, -half:half:res * 1j]
    r = np.hypot(x, y)
    R = 0.3 * size_km * 1000
    depth = 0.2 * R
    bowl = np.where(r < R, -depth * (1 - (r / R) ** 2), 0.0)
    rim = 0.04 * R * np.exp(-((r - R) / (0.12 * R)) ** 2)
    rng = np.random.default_rng(42)
    bumps = ndimage.gaussian_filter(rng.normal(0, 40, (res, res)), sigma=res / 30)
    return bowl + rim + bumps


def _dem_path() -> Path | None:
    dems = sorted(p for p in DEM_DIR.iterdir() if p.is_file() and p.suffix.lower() in {".tif", ".tiff"}) if DEM_DIR.exists() else []
    if len(dems) > 1:
        raise ValueError(f"Multiple DEM files found in {DEM_DIR}; keep only one elevation DEM.")
    if dems:
        return dems[0]
    return LOCAL_DEM if LOCAL_DEM.is_file() else None


def _remote_target() -> str:
    return "/vsicurl/" + REMOTE_DEM_URL


def remote_available() -> bool:
    return REMOTE_ENABLED and time.monotonic() >= _remote_down_until


def mark_remote_down() -> None:
    global _remote_down_until
    _remote_down_until = time.monotonic() + REMOTE_RETRY_S


def dem_source() -> tuple[str, tuple[str, int, int]] | None:
    """(what to open, cache identity) for the DEM to use, or None for synthetic terrain."""
    path = _dem_path()
    if path is not None:
        stat = path.stat()
        return str(path), (str(path), stat.st_mtime_ns, stat.st_size)
    if remote_available():
        target = _remote_target()
        return target, (target, 0, 0)
    return None


def is_remote(target: str) -> bool:
    return target.startswith("/vsicurl/")


@contextmanager
def open_dem(target: str, overview_level: int | None = None):
    """Open the DEM (optionally one of its lower-resolution overviews). Remote copies stay open between requests."""
    opts = {} if overview_level is None else {"overview_level": overview_level}
    if not is_remote(target):
        with rasterio.open(target, **opts) as dem:
            yield dem
        return
    with _remote_lock:
        dem = _remote_open.get(overview_level)
        if dem is None:
            dem = rasterio.open(target, **opts)
            _remote_open[overview_level] = dem
        yield dem


def overview_for(target: str, pixel_m: float) -> int | None:
    """The coarsest overview that is still at least as sharp as `pixel_m` (None = full 20 m resolution)."""
    with open_dem(target) as dem:
        native = max(dem.res)
        factors = dem.overviews(1)
    levels = [i for i, f in enumerate(factors) if native * f <= pixel_m * 1.05]
    return levels[-1] if levels else None


@lru_cache(maxsize=64)
def _read_dem_cached(identity: tuple[str, int, int], lat: float, lon: float, size_km: float, res: int) -> np.ndarray:
    return _read_dem(identity[0], lat, lon, size_km, res)


def _read_dem(path: Path | str, lat: float, lon: float, size_km: float, res: int) -> np.ndarray:
    pixel_m = pixel_size_m(size_km, res)
    half_m = size_km * 500.0
    local_crs = (
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} "
        f"+R={MOON_RADIUS_M} +units=m +no_defs"
    )
    grid = np.full((res, res), np.nan, dtype=np.float32)
    target = str(path)
    with open_dem(target, overview_for(target, pixel_m)) as dem:
        if dem.count != 1 or dem.crs is None:
            raise ValueError(f"DEM must have one elevation band and a lunar coordinate system: {path}")
        reproject(
            source=rasterio.band(dem, 1),
            destination=grid,
            src_nodata=dem.nodata,
            dst_transform=from_origin(-half_m - pixel_m / 2, half_m + pixel_m / 2, pixel_m, pixel_m),
            dst_crs=local_crs,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    if not np.isfinite(grid).all():
        raise ValueError("The requested terrain area extends beyond available DEM coverage or contains missing data.")
    return grid


def load_elevation(lat: float, lon: float, size_km: float = 20, res: int = 128) -> tuple[np.ndarray, bool]:
    """Return (elevation grid in metres, is_synthetic)."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and size_km > 0 and res >= 2):
        raise ValueError("Invalid terrain coordinates, size, or resolution.")
    src = dem_source()
    if src is not None and lat <= -80:
        target, identity = src
        try:
            return _read_dem_cached(identity, round(lat, 6), round(lon, 6), float(size_km), int(res)).copy(), False
        except (RasterioIOError, OSError):
            if not is_remote(target):
                raise
            mark_remote_down()  # NASA unreachable: fall back to synthetic terrain for a while
    if polar_dem.covered(lat):
        # sample the regional south-pole model so this tile matches the 2D map exactly
        half_m = size_km * 500.0
        v = np.linspace(-half_m, half_m, res)
        east, south = np.meshgrid(v, v)  # col → east, row → south (row 0 = north edge)
        (nx, ny), (ex, ey) = polar_dem.local_axes(lon)
        x0, y0 = polar_dem.project(lat, lon)
        north = -south
        x = x0 + (north * nx + east * ex) / 1000
        y = y0 + (north * ny + east * ey) / 1000
        return polar_dem.elevation_m(x, y), True
    return _synthetic_crater(size_km, res), True


# ---------------------------------------------------------------- cross sections
def cross_section(grid: np.ndarray, pixel_m: float, azimuth: float, length_km: float, n: int = 200):
    c = (grid.shape[0] - 1) / 2
    d = np.linspace(0, length_km * 1000, n)
    az = np.radians(azimuth)
    rows = c - d * np.cos(az) / pixel_m
    cols = c + d * np.sin(az) / pixel_m
    elev = ndimage.map_coordinates(grid, [rows, cols], order=1, mode="nearest")
    return d.tolist(), elev.tolist()


# ---------------------------------------------------------------- shadows
def shadow_mask(grid: np.ndarray, pixel_m: float, sun_alt: float, sun_az: float, max_steps: int | None = None) -> np.ndarray:
    """1 = lit, 0 = shadow. Ray-march every pixel toward the Sun; shadowed if terrain rises above the sun angle.

    Ignores lunar curvature, which is fine for tiles < ~30 km. TODO(TERRAIN): add curvature drop d²/(2R) for big tiles.
    """
    if sun_alt <= 0:
        return np.zeros_like(grid, dtype=np.uint8)
    h, w = grid.shape
    rows, cols = np.mgrid[0:h, 0:w].astype(float)
    az = np.radians(sun_az)
    dr, dc = -np.cos(az), np.sin(az)  # one-pixel step toward the Sun
    tan_sun = np.tan(np.radians(sun_alt))
    lit = np.ones_like(grid, dtype=bool)
    steps = max_steps or int(np.hypot(h, w))
    for k in range(1, steps + 1):
        rr, cc = rows + dr * k, cols + dc * k
        inside = (rr >= 0) & (rr <= h - 1) & (cc >= 0) & (cc <= w - 1)
        if not inside.any():
            break
        z = ndimage.map_coordinates(grid, [rr, cc], order=1, mode="nearest")
        blocked = inside & ((z - grid) / (k * pixel_m) > tan_sun)
        lit &= ~blocked
    return lit.astype(np.uint8)


def horizon_profile(grid: np.ndarray, pixel_m: float, n_az: int = 72) -> tuple[np.ndarray, np.ndarray]:
    """Horizon elevation angle (deg) seen from the tile center, for n_az azimuths.

    TODO(TERRAIN): hand this to ephemeris.horizon_elevation so sunrise/sunset respect crater walls.
    """
    c = (grid.shape[0] - 1) / 2
    z0 = grid[int(c), int(c)] + 2.0  # observer ~2 m above ground (a lander's solar panel)
    azs = np.linspace(0, 360, n_az, endpoint=False)
    out = []
    for a in azs:
        d, e = cross_section(grid, pixel_m, a, (grid.shape[0] / 2) * pixel_m / 1000, n=grid.shape[0])
        d, e = np.array(d[1:]), np.array(e[1:])
        out.append(np.degrees(np.max(np.arctan2(e - z0, d))))
    return azs, np.array(out)


# ---------------------------------------------------------------- rims
def rim_mask(grid: np.ndarray, percentile: float = 92) -> np.ndarray:
    """Rims = strongly convex ridges. Negative Laplacian of a smoothed DEM above a percentile.

    TODO(GEO+TERRAIN): validate against known rims (Shackleton, de Gerlache) and tune.
    """
    smooth = ndimage.gaussian_filter(grid, sigma=max(1, grid.shape[0] / 64))
    convex = -ndimage.laplace(smooth)
    return (convex > np.percentile(convex, percentile)).astype(np.uint8)


def center_slope_deg(grid: np.ndarray, pixel_m: float) -> float:
    gy, gx = np.gradient(grid, pixel_m)
    c = grid.shape[0] // 2
    return float(np.degrees(np.arctan(np.hypot(gx[c, c], gy[c, c]))))
