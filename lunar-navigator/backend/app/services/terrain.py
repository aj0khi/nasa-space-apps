"""Elevation, cross sections, shadows and rims. Owner: TERRAIN.

Grid convention (all endpoints): row 0 = north edge, col 0 = west edge, site at the center.
Azimuth is clockwise from north (east = +col, north = -row).

The south-pole LOLA DEM is used when available; other locations use synthetic terrain.

Data source: a local GeoTIFF (data/dem/*.tif) if present, otherwise NASA's cloud-optimized GeoTIFFs streamed from
PGDA over HTTP range requests (only the tiles a request needs are fetched). Barker et al., "A New View of the Lunar
South Pole from LOLA", https://pgda.gsfc.nasa.gov/products/90. Set LOLA_DEM_URL / LOLA_PSR_URL to "off" to disable.
"""
from __future__ import annotations

import os
import threading
import time
from functools import lru_cache
from pathlib import Path

# GDAL settings for streaming the NASA COGs: don't list the remote directory, cache fetched tiles in memory.
for _k, _v in {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF,.tiff",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": str(256 * 1024 * 1024),
    "CPL_VSIL_CURL_CACHE_SIZE": str(256 * 1024 * 1024),
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "1",
    "GDAL_HTTP_TIMEOUT": "60",
}.items():
    os.environ.setdefault(_k, _v)

import numpy as np
import rasterio
import rasterio.errors
import rasterio.io
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from app.services import polar_dem

DEM_DIR = Path(__file__).resolve().parents[2] / "data" / "dem"
LOCAL_DEM = Path(__file__).resolve().parents[4] / "LDEM_80S_20MPP_ADJ.tiff"
PSR_DIR = DEM_DIR / "psr"
MOON_RADIUS_M = 1_737_400.0

PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"


def _remote(env: str, default: str) -> str | None:
    url = os.environ.get(env, default).strip()
    return None if url.lower() in {"", "off", "none", "0"} else url


REMOTE_DEM = _remote("LOLA_DEM_URL", PGDA + "LDEM_80S_20MPP_ADJ.TIF")  # surface height, metres
REMOTE_PSR = _remote("LOLA_PSR_URL", PGDA + "LPSR_80S_20MPP_ADJ.TIF")  # 1 = permanently shadowed


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


def _tifs(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in {".tif", ".tiff"}) if folder.exists() else []


def _dem_path() -> Path | str | None:
    """A local DEM file if there is one, else the NASA DEM streamed over HTTP (a '/vsicurl/' path), else None."""
    dems = _tifs(DEM_DIR)
    if len(dems) > 1:
        raise ValueError(f"Multiple DEM files found in {DEM_DIR}; keep only one elevation DEM.")
    if dems:
        return dems[0]
    if LOCAL_DEM.is_file():
        return LOCAL_DEM
    return f"/vsicurl/{REMOTE_DEM}" if REMOTE_DEM else None


def _psr_path() -> Path | str | None:
    """A local PSR map (data/dem/psr/*.tif) if there is one, else NASA's streamed PSR map, else None."""
    local = _tifs(PSR_DIR)
    if local:
        return local[0]
    return f"/vsicurl/{REMOTE_PSR}" if REMOTE_PSR else None


def dem_identity(path: Path | str) -> tuple[str, int, int]:
    """Cache key for a DEM source: a local file changes with its mtime/size; a remote URL is treated as fixed."""
    if isinstance(path, Path):
        stat = path.stat()
        return str(path), stat.st_mtime_ns, stat.st_size
    return str(path), 0, 0


def overview_options(path: Path | str, pixel_m: float) -> dict:
    """rasterio.open() options picking the coarsest built-in overview still at least as fine as `pixel_m`.

    For the streamed NASA files this is what keeps wide areas cheap: a 100 km grid at 200 m reads a handful of
    overview tiles instead of ~100 full-resolution ones."""
    with rasterio.open(path) as src:
        levels = src.overviews(1)
        candidates = [i for i, factor in enumerate(levels) if max(src.res) * factor <= pixel_m]
    return {"overview_level": candidates[-1]} if candidates else {}


# NASA's server drops some tile reads when several arrive at once, so streamed reads go one at a time and retry.
# Remote files stay open (one handle per file and overview level) so their fetched tiles stay in GDAL's cache,
# and recent results are remembered because the app asks for the same area several times.
_REMOTE_LOCK = threading.Lock()
REMOTE_TRIES = 3
_REMOTE_HANDLES: dict[tuple[str, int | None], rasterio.io.DatasetReader] = {}


def _remote_handle(path: str, pixel_m: float):
    """Open (once) the remote file at the overview level suited to `pixel_m`. Caller holds _REMOTE_LOCK."""
    if path not in _OVERVIEWS:
        with rasterio.open(path) as src:
            _OVERVIEWS[path] = (max(src.res), src.overviews(1))
    level = _pick_level(path, pixel_m)
    key = (path, level)
    if key not in _REMOTE_HANDLES:
        _REMOTE_HANDLES[key] = rasterio.open(path, **({"overview_level": level} if level is not None else {}))
    return _REMOTE_HANDLES[key]


_OVERVIEWS: dict[str, tuple[float, list[int]]] = {}


def _pick_level(path: str, pixel_m: float) -> int | None:
    res, levels = _OVERVIEWS[path]
    candidates = [i for i, factor in enumerate(levels) if res * factor <= pixel_m]
    return candidates[-1] if candidates else None


@lru_cache(maxsize=32)
def _local_cached(
    path_str: str, mtime_ns: int, file_size: int, lat: float, lon: float, size_km: float, res: int, resampling: Resampling
) -> np.ndarray:
    p = Path(path_str)
    with rasterio.open(p, **overview_options(p, pixel_size_m(size_km, res))) as src:
        return _reproject_from(src, p, lat, lon, size_km, res, resampling)


def _reproject_local(path: Path | str, lat: float, lon: float, size_km: float, res: int, resampling: Resampling) -> np.ndarray:
    """Resample band 1 of a polar GeoTIFF onto the local site grid (row 0 = north, site at the centre)."""
    if isinstance(path, Path):
        stat = path.stat()
        return _local_cached(
            str(path), stat.st_mtime_ns, stat.st_size, round(float(lat), 6), round(float(lon), 6), float(size_km), int(res), resampling
        ).copy()
    return _remote_cached(path, round(lat, 6), round(lon, 6), float(size_km), int(res), resampling).copy()


@lru_cache(maxsize=32)
def _remote_cached(path: str, lat: float, lon: float, size_km: float, res: int, resampling: Resampling) -> np.ndarray:
    with _REMOTE_LOCK:
        for attempt in range(REMOTE_TRIES):
            try:
                src = _remote_handle(path, pixel_size_m(size_km, res))
                return _reproject_from(src, path, lat, lon, size_km, res, resampling)
            except rasterio.errors.RasterioError:
                # drop the handles so the retry starts from a fresh connection
                for k in [k for k in _REMOTE_HANDLES if k[0] == path]:
                    _REMOTE_HANDLES.pop(k).close()
                if attempt == REMOTE_TRIES - 1:
                    raise
                time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def _reproject_from(src, path: Path | str, lat: float, lon: float, size_km: float, res: int, resampling: Resampling) -> np.ndarray:
    pixel_m = pixel_size_m(size_km, res)
    half_m = size_km * 500.0
    local_crs = (
        f"+proj=aeqd +lat_0={lat} +lon_0={lon} "
        f"+R={MOON_RADIUS_M} +units=m +no_defs"
    )
    grid = np.full((res, res), np.nan, dtype=np.float32)
    if src.count != 1 or src.crs is None:
        raise ValueError(f"Raster must have one band and a lunar coordinate system: {path}")
    reproject(
        source=rasterio.band(src, 1),
        destination=grid,
        src_nodata=src.nodata,
        dst_transform=from_origin(-half_m - pixel_m / 2, half_m + pixel_m / 2, pixel_m, pixel_m),
        dst_crs=local_crs,
        dst_nodata=np.nan,
        resampling=resampling,
    )
    return grid


def _read_dem(path: Path | str, lat: float, lon: float, size_km: float, res: int) -> np.ndarray:
    grid = _reproject_local(path, lat, lon, size_km, res, Resampling.bilinear)
    if not np.isfinite(grid).all():
        raise ValueError("The requested terrain area extends beyond available DEM coverage or contains missing data.")
    return grid


def load_psr(lat: float, lon: float, size_km: float = 20, res: int = 128) -> np.ndarray | None:
    """Fraction (0..1) of each grid cell that NASA's LOLA map marks as permanently shadowed, or None if no PSR map
    is available or the area is outside it (south of 80°S only). Same grid convention as load_elevation()."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and size_km > 0 and res >= 2):
        raise ValueError("Invalid terrain coordinates, size, or resolution.")
    path = _psr_path()
    if path is None or lat > -80:
        return None
    grid = _reproject_local(path, lat, lon, size_km, res, Resampling.average)
    if not np.isfinite(grid).any():
        return None
    return np.clip(np.nan_to_num(grid, nan=0.0), 0.0, 1.0)


def load_elevation(lat: float, lon: float, size_km: float = 20, res: int = 128) -> tuple[np.ndarray, bool]:
    """Return (elevation grid in metres, is_synthetic)."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and size_km > 0 and res >= 2):
        raise ValueError("Invalid terrain coordinates, size, or resolution.")
    dem = _dem_path()
    if dem is not None and lat <= -80:
        return _read_dem(dem, lat, lon, size_km, res), False
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
    az = np.radians(sun_az)
    dr, dc = float(-np.cos(az)), float(np.sin(az))  # one-pixel step toward the Sun
    tan_sun = float(np.tan(np.radians(sun_alt)))
    lit = np.ones((h, w), dtype=bool)
    steps = max_steps or int(np.hypot(h, w))
    g_f32 = np.asarray(grid, dtype=np.float32)

    for k in range(1, steps + 1):
        sr = dr * k
        sc = dc * k
        r0 = int(np.floor(sr))
        c0 = int(np.floor(sc))
        # Valid target window in destination [r_start:r_end, c_start:c_end] where both (r0, c0) and (r0+1, c0+1) are inside [0, h-1]×[0, w-1]
        r_start = max(0, -r0)
        r_end = min(h, h - 1 - r0)
        c_start = max(0, -c0)
        c_end = min(w, w - 1 - c0)
        if r_start >= r_end or c_start >= c_end:
            break
        fr = np.float32(sr - r0)
        fc = np.float32(sc - c0)
        sr0 = r_start + r0
        sc0 = c_start + c0
        rh = r_end - r_start
        cw = c_end - c_start
        z = (
            np.float32((1.0 - fr) * (1.0 - fc)) * g_f32[sr0:sr0 + rh, sc0:sc0 + cw]
            + np.float32((1.0 - fr) * fc) * g_f32[sr0:sr0 + rh, sc0 + 1:sc0 + 1 + cw]
            + np.float32(fr * (1.0 - fc)) * g_f32[sr0 + 1:sr0 + 1 + rh, sc0:sc0 + cw]
            + np.float32(fr * fc) * g_f32[sr0 + 1:sr0 + 1 + rh, sc0 + 1:sc0 + 1 + cw]
        )
        base = g_f32[r_start:r_end, c_start:c_end]
        lit[r_start:r_end, c_start:c_end] &= ~((z - base) > np.float32(k * pixel_m * tan_sun))
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
