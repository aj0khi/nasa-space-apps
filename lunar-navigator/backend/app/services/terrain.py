"""Elevation, cross sections, shadows and rims. Owner: TERRAIN.

Grid convention (all endpoints): row 0 = north edge, col 0 = west edge, site at the center.
Azimuth is clockwise from north (east = +col, north = -row).

Until a real LOLA DEM is in backend/data/dem/, a synthetic crater is generated so the frontend is never blocked.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy import ndimage

from app.services import polar_dem

DEM_DIR = Path(__file__).resolve().parents[2] / "data" / "dem"


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


def load_elevation(lat: float, lon: float, size_km: float = 20, res: int = 128) -> tuple[np.ndarray, bool]:
    """Return (elevation grid in metres, is_synthetic).

    TODO(TERRAIN):
      1. Put a LOLA polar-stereographic GeoTIFF in data/dem/ (see data/README.md).
      2. Project (lat, lon) → DEM x/y with pyproj (Moon 2015 south polar stereographic, R = 1737.4 km).
      3. Window-read size_km × size_km around it with rasterio and resample to res × res.
    """
    dems = sorted(DEM_DIR.glob("*.tif")) if DEM_DIR.exists() else []
    if dems:
        pass  # real DEM goes here
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
