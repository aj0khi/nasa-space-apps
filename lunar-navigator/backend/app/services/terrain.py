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
# Ridge curvature (1/m, on terrain smoothed over ~1/64 of the tile) that counts as a rim. Measured on real
# LOLA tiles around the south pole: the median is ~2e-5, sharp crater rims reach ~5e-4. 3e-4 keeps the
# crests (3-9 % of a 20 km tile, more on rugged ground) and drops ordinary hummocky slopes.
RIM_CURVATURE = 3e-4


def rim_mask(grid: np.ndarray, pixel_m: float | None = None, percentile: float = 92,
             min_curvature: float = RIM_CURVATURE) -> np.ndarray:
    """Rims = sharp convex ridges that stand above their surroundings.

    With `pixel_m`, uses an absolute curvature threshold, so a flat tile has no rims and a rugged one isn't
    capped at a fixed share, and ignores a thin border where the filters can't see both sides of a ridge.
    Without it, falls back to the older relative rule: the most convex `100 - percentile` % of the tile.
    TODO(GEO+TERRAIN): validate against known rims (Shackleton, de Gerlache).
    """
    sigma = max(1.0, grid.shape[0] / 64)
    if pixel_m is None:
        smooth = ndimage.gaussian_filter(grid, sigma=sigma)
        convex = -ndimage.laplace(smooth)
        return (convex > np.percentile(convex, percentile)).astype(np.uint8)
    smooth = ndimage.gaussian_filter(grid, sigma=sigma, mode="nearest")
    curvature = -ndimage.laplace(smooth, mode="nearest") / pixel_m ** 2
    local_mean = ndimage.uniform_filter(smooth, size=max(5, grid.shape[0] // 12), mode="nearest")
    mask = (curvature > min_curvature) & (smooth > local_mean)
    b = int(np.ceil(2 * sigma))
    mask[:b, :] = mask[-b:, :] = mask[:, :b] = mask[:, -b:] = False
    return mask.astype(np.uint8)


def center_slope_deg(grid: np.ndarray, pixel_m: float) -> float:
    gy, gx = np.gradient(grid, pixel_m)
    c = grid.shape[0] // 2
    return float(np.degrees(np.arctan(np.hypot(gx[c, c], gy[c, c]))))


# ---------------------------------------------------------------- lit relief (same method as the 2D polar map)
LIGHT_REACH_KM = 40.0  # how far beyond each pixel to look for terrain that blocks the Sun
LIGHT_STEPS = 64


def _dem_identity() -> tuple[str, int, int] | None:
    """Which DEM the lighting grids come from (local file or NASA stream), so a new local file refreshes the cache."""
    try:
        p = _dem_path()
    except ValueError:
        return None
    return None if p is None else dem_identity(p)


@lru_cache(maxsize=8)
def _lighting_grids(lat: float, lon: float, size_km: float, res: int, identity) -> tuple:
    """(tile grid, tile pixel m, wide grid or None, wide pixel m, wide half-width m, synthetic).

    The wide grid covers the tile plus LIGHT_REACH_KM on every side at half the tile's resolution, so mountains
    outside the tile can still cast shadows into it. `identity` (the DEM file) only invalidates the cache.
    """
    grid, synthetic = load_elevation(lat, lon, size_km, res)
    px = pixel_size_m(size_km, res)
    wide, wide_px, wide_half = None, 0.0, 0.0
    for reach in (LIGHT_REACH_KM, LIGHT_REACH_KM / 2):  # near the DEM's 80°S edge, a smaller margin may still fit
        wide_size = size_km + 2 * reach
        wide_res = min(1025, int(wide_size * 1000 / (2 * px)) + 1)
        try:
            wide, _ = load_elevation(lat, lon, wide_size, wide_res)
        except ValueError:
            continue
        wide_px, wide_half = pixel_size_m(wide_size, wide_res), wide_size * 500.0
        break
    return grid, px, wide, wide_px, wide_half, synthetic


def lit_relief(lat: float, lon: float, sun_alt: float, sun_az: float, size_km: float = 20, res: int = 256):
    """Sunlight on a size_km tile around the site, like the 2D map's lit relief.

    Per pixel: the Sun's elevation from that spot (it rises ~0.03° per km toward the Sun), a march toward the
    Sun up to LIGHT_REACH_KM past the pixel (tile grid nearby, wide grid beyond) with the Moon's curvature drop,
    then brightness = how squarely the slope faces the Sun (lit) or a dim fixed hillshade (shadow).
    Returns (uint8 grid: bit 7 = lit, bits 0-6 = brightness; lit fraction; synthetic; reach km).
    Grid convention as everywhere here: row 0 = north edge, col 0 = west edge, site at the centre.
    """
    grid, px, wide, wide_px, wide_half, synthetic = _lighting_grids(
        round(lat, 6), round(lon, 6), float(size_km), int(res), _dem_identity())
    n = grid.shape[0]
    c = (n - 1) / 2
    rows, cols = np.mgrid[0:n, 0:n].astype(float)
    east, north = (cols - c) * px, (c - rows) * px  # metres from the site

    az, alt = np.radians(sun_az), np.radians(sun_alt)
    ue, un = np.sin(az), np.cos(az)  # horizontal unit vector toward the Sun
    alt_px = alt + (east * ue + north * un) / MOON_RADIUS_M  # closer to the Sun = Sun higher
    tan_sun = np.tan(alt_px)

    # samples past the wide grid (or the tile, without one) are skipped via `ok` below
    reach_m = min(LIGHT_REACH_KM * 1000.0, wide_half) if wide is not None else size_km * 1000.0 * np.sqrt(2)
    horizon = np.full(grid.shape, -np.inf)
    seen = np.zeros(grid.shape, dtype=bool)  # any terrain sampled toward the Sun?
    wn = wide.shape[0] if wide is not None else 0
    wc = (wn - 1) / 2
    for d in np.geomspace(0.8 * px, reach_m, LIGHT_STEPS):
        pe, pn = east + ue * d, north + un * d
        r_in, c_in = c - pn / px, c + pe / px
        in_tile = (r_in >= 0) & (r_in <= n - 1) & (c_in >= 0) & (c_in <= n - 1)
        zs = ndimage.map_coordinates(grid, [r_in, c_in], order=1, mode="nearest")
        ok = in_tile
        if wide is not None and not in_tile.all():
            r_w, c_w = wc - pn / wide_px, wc + pe / wide_px
            in_wide = (r_w >= 0) & (r_w <= wn - 1) & (c_w >= 0) & (c_w <= wn - 1)
            zw = ndimage.map_coordinates(wide, [r_w, c_w], order=1, mode="nearest")
            zs = np.where(in_tile, zs, zw)
            ok = in_tile | in_wide
        angle = (zs - grid) / d - d / (2 * MOON_RADIUS_M)
        horizon = np.maximum(horizon, np.where(ok, angle, -np.inf))
        seen |= ok
    # no terrain known toward the Sun (tile edge, no wide grid): assume a flat horizon there
    horizon = np.where(seen, horizon, 0.0)
    lit = tan_sun > horizon

    gy, gx = np.gradient(grid, px)  # gy: per row (southward), gx: per column (eastward)
    dzde, dzdn = gx, -gy
    norm = np.sqrt(dzde ** 2 + dzdn ** 2 + 1)
    ca = np.cos(alt_px)
    facing = (-dzde * ue * ca - dzdn * un * ca + np.sin(alt_px)) / norm
    ambient = np.clip(0.55 + (-gx * -0.5 - gy * -0.6) * 3, 0, 1)
    b = np.where(lit, 48 + 78 * np.clip(facing / 0.2, 0, 1), 10 + 35 * ambient).astype(np.uint8)
    out = np.where(lit, b | 128, b).astype(np.uint8)
    return out, float(lit.mean()), synthetic, reach_m / 1000.0
