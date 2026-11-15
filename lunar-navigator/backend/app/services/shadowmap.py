"""Per-pixel horizon map around a site (GET /terrain/shadow-map). Owner: LEAD. Contract: app.models.ShadowMap.

What it answers
    shadow_map(lat, lon, size_km, res, observer_m)
        A square map `size_km` across centred on the site, `res` x `res` pixels, drawn in the lander's own flat
        frame: up is local north at the site, right is east. Row 0 is the north edge, column 0 the west edge.
        Pixel centres sit at (column + 0.5 - res / 2) * size / res east and (res / 2 - row - 0.5) * size / res north
        of the site, so an ODD `res` puts one pixel exactly on the lander. Each pixel's place on the Moon comes from
        its distance and bearing from the site along a great circle.
        For every pixel and every 5 deg of azimuth AT THE LANDER (72 directions) it gives the altitude, in the
        LANDER's level frame, that a far-away body in that direction must exceed for its centre to be seen from
        `observer_m` above the ground at that pixel. A client needs no geometry:
            pixel p is lit  <=>  body altitude at the lander > horizon(p, body azimuth at the lander).

How
    One ray per pixel and direction, marched over the real terrain out to 250 km (sightline.MAX_REACH_KM).
    The ray leaves the pixel along the great circle whose direction, at the pixel, is the lander-frame direction
    (altitude 0, azimuth k * 5 deg) projected onto the pixel's own level plane. The highest terrain along it gives
    a sight line; that sight line, as a 3-D vector, is then read off in the lander's frame. So the tilt of "level"
    between the lander and the pixel (1 deg per 30 km) and the turning of "north" near the pole are exact.
    What is not exact: the sight line found has the wanted lander azimuth only when the horizon is at altitude 0.
    For a horizon H above level it is off by about tan(H) times the sideways tilt: measured worst case 0.2 deg of
    azimuth on a 16 km map and 2.6 deg on a 200 km map, both where the horizon stands 30 deg or more above level
    (so far above any Sun or Earth position here that the answer does not change).

Sampling (coarser than sightline.skyline, measured against it: see docs/API.md)
    Along each ray: 2 m steps to 60 m (the eye is only `observer_m` up, so ground beside it must not be stepped
    over), then each step 3 % longer, out to 250 km: about 310 samples. Terrain: 20 m data within 10 km of each
    pixel, 80 m to 55 km, 320 m beyond (the same three resolutions as the skyline). Wide maps cannot hold 20 m data
    for the whole map in memory, so they use 40 m (above about 80 km across) or 80 m (above about 130 km) or
    160 m (above about 290 km) for the nearest ground, and the note says so.
    The horizon is stored as one byte: angle = value * 0.25 - 16, so it is rounded to the nearest 0.25 deg and
    clipped to -16 .. 47.75 deg.

Sun and Earth as directions
    The same direction is used for every pixel. The Earth is about 356,000 to 407,000 km away, so across the map
    its true direction differs from the one at the lander by at most asin(offset / distance): 0.002 deg at the
    corner of a 16 km map, 0.023 deg at the corner of a 200 km map, 0.036 deg at the corner of the largest
    (320 km) map, all at the closest Earth. For the Sun it is under 0.0001 deg.

No terrain, no map
    With no DEM, north of 80 S, or an unreadable file, this raises ValueError (HTTP 422). It never invents
    shadows. Pixels of the map that fall outside the DEM get elevation NODATA_M and horizon value 255.
"""
from __future__ import annotations

import base64
import hashlib
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from scipy import ndimage

from app.services import sightline

R = sightline.R
AZ_STEP_DEG = 5.0
HORIZON_SCALE = 0.25      # angle (deg) = value * HORIZON_SCALE + HORIZON_OFFSET
HORIZON_OFFSET = -16.0
NODATA_M = -99999.0       # elevation written for pixels outside the DEM (their horizon bytes are all 255)
RAY_RATIO = 1.02          # each step along a ray is 2 % longer than the last (after the fine steps near the eye)
NEAR_STEPS = 30           # this many equal steps first: 2 m each on 20 m data, so 2 m .. 60 m
MAX_SIDE_LOCAL = 6000     # widest grid (pixels) read for one resolution from a local file: 144 MB
MAX_SIDE_REMOTE = 2600    # and from NASA over the network, where every megabyte is slow
_LOCK = threading.Lock()  # one map at a time: a second request for the same map then finds it in the cache
_TAG = "v" + hashlib.sha1(Path(__file__).read_bytes()).hexdigest()[:8]  # new code or settings never reuse old files


def _tiers(size_km: float, remote: bool) -> list[tuple[float, float, float]]:
    """(pixel size m, radius read around the site m, used out to this distance from a pixel m) for one map size."""
    half = size_km * 1000.0 / 2.0 * math.sqrt(2.0) * 1.01  # corner of the map; 1 % covers the projection's scale
    max_side = MAX_SIDE_REMOTE if remote else MAX_SIDE_LOCAL
    out = []
    for group, use_to in (((20.0, 40.0), 10e3), ((80.0, 160.0), 55e3)):
        for px in group:
            radius = half + use_to * 1.01 + 4 * px
            if 2 * radius / px <= max_side:
                out.append((px, radius, use_to))
                break
    out.append((320.0, half + sightline.MAX_REACH_KM * 1000.0 * 1.01 + 4 * 320.0, 1e12))
    return out


def _distances(first_step: float) -> np.ndarray:
    """Sample distances along a ray: NEAR_STEPS equal steps, then each step RAY_RATIO times the last, to 250 km."""
    reach = sightline.MAX_REACH_KM * 1000.0
    d = [first_step * (i + 1) for i in range(NEAR_STEPS)]
    while d[-1] * RAY_RATIO < reach:
        d.append(d[-1] * RAY_RATIO)
    return np.array(d + [reach])


def _frame(lat: float, lon: float):
    """Unit vectors up, east, north at a place, in Moon-fixed axes (z through the north pole)."""
    p, l = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)])
    east = np.array([-math.sin(l), math.cos(l), 0.0])
    north = np.array([-math.sin(p) * math.cos(l), -math.sin(p) * math.sin(l), math.cos(p)])
    return up, east, north


def _pixel_offsets(size_km: float, res: int):
    """East and north offsets (m) of every pixel centre from the site, row-major, row 0 = north edge."""
    px = size_km * 1000.0 / res
    east = (np.arange(res) + 0.5 - res / 2.0) * px
    north = (res / 2.0 - np.arange(res) - 0.5) * px
    e, n = np.meshgrid(east, north)
    return e.reshape(-1), n.reshape(-1)


def _grid_rc(grid, ux, uy, uz):
    """Row and column (fractional, pixel centres at whole numbers) in a sightline._Grid of unit vectors."""
    w = 2.0 * R / (1.0 - uz)  # south polar stereographic: x = 2R u_y / (1 - u_z), y = 2R u_x / (1 - u_z)
    return (grid.top - ux * w) / grid.res_y - 0.5, (uy * w - grid.left) / grid.res_x - 0.5


def _heights(grid, ux, uy, uz) -> np.ndarray:
    """Bilinear terrain height (m) at unit vectors; NaN outside the grid or where the DEM has no data."""
    row, col = _grid_rc(grid, ux, uy, uz)
    return ndimage.map_coordinates(grid.z, [row, col], order=1, mode="constant", cval=np.nan, output=np.float64)


def _march(grids, plan, up_p, tang, h_eye):
    """Highest terrain along every ray of a block of pixels.

    up_p (P, 3) unit vectors of the pixels, tang (P, A, 3) unit tangents of the rays at the pixels, h_eye (P,)
    eye elevation. Returns (P, A): the tangent of the skyline's angle above each pixel's own level plane
    (-inf where a ray has no terrain under it at all), and whether the ray ran off the DEM before 250 km.
    """
    best = np.full(tang.shape[:2], -np.inf)
    cut = np.zeros(tang.shape[:2], bool)
    r_eye = R + h_eye
    for (grid, _), (tan_d, sec_d, cot_d, half_d) in zip(grids, plan):
        if tan_d.size == 0:
            continue
        # point at distance d along the ray: cos(d/R) * up + sin(d/R) * tangent; divided through by cos(d/R)
        bx = up_p[:, None, None, 0] + tang[:, :, None, 0] * tan_d
        by = up_p[:, None, None, 1] + tang[:, :, None, 1] * tan_d
        den = (sec_d - up_p[:, None, None, 2]) - tang[:, :, None, 2] * tan_d
        np.divide(2.0 * R, den, out=den)
        np.multiply(bx, den, out=bx)  # stereographic y
        np.multiply(by, den, out=by)  # stereographic x
        row = np.subtract(grid.top, bx, out=bx)
        row /= grid.res_y
        row -= 0.5
        col = np.subtract(by, grid.left, out=by)
        col /= grid.res_x
        col -= 0.5
        h = ndimage.map_coordinates(grid.z, [row.reshape(-1), col.reshape(-1)], order=1, mode="constant",
                                    cval=np.nan, output=np.float64).reshape(row.shape)
        cut |= np.isnan(h[:, :, -1])
        # tan(elevation) = ((R + h) cos t - r_eye) / ((R + h) sin t), t = d / R, written so that no large numbers
        # are subtracted: (h - h_eye) / tan t - r_eye * tan(t / 2), over R + h
        num = np.subtract(h, h_eye[:, None, None], out=row)
        num *= cot_d
        num -= r_eye[:, None, None] * half_d
        h += R
        num /= h
        np.fmax(best, np.fmax.reduce(num, axis=2), out=best)  # fmax skips the NaN of missing terrain
    return best, cut


def _build(target: str, lat: float, lon: float, size_km: float, res: int, eye: float):
    """Compute one map. Returns (response dict, measurements for the tests and the write-up)."""
    remote = target.startswith("/vsicurl/")
    tiers = _tiers(size_km, remote)
    try:
        t = sightline._Terrain(target, lat, lon, tiers=tiers)
    except ValueError:
        raise
    except Exception as exc:  # unreadable or damaged file, no network
        raise ValueError(f"The terrain file could not be read ({type(exc).__name__}), so there is no shadow map.") from exc
    fine = t.grids[0][0]
    fine_px = tiers[0][0]

    up0, east0, north0 = _frame(lat, lon)
    e, n = _pixel_offsets(size_km, res)
    th = np.hypot(e, n) / R
    brg = np.arctan2(e, n)
    flat = np.cos(brg)[:, None] * north0 + np.sin(brg)[:, None] * east0
    up_p = np.cos(th)[:, None] * up0 + np.sin(th)[:, None] * flat  # (N, 3) unit vector of every pixel
    h_p = _heights(fine, up_p[:, 0], up_p[:, 1], up_p[:, 2])
    have = np.isfinite(h_p)
    if not have.any():
        raise ValueError("The terrain file has no elevation anywhere on this map.")

    az = np.radians(np.arange(0.0, 360.0, AZ_STEP_DEG))
    level = np.cos(az)[:, None] * north0 + np.sin(az)[:, None] * east0  # (A, 3) lander-frame directions, altitude 0

    d = _distances(max(2.0, fine_px / 10.0))
    plan, lo = [], 0.0
    for _, _, use_to in tiers:
        td = d[(d > lo) & (d <= use_to)] / R
        plan.append((np.tan(td), 1.0 / np.cos(td), 1.0 / np.tan(td), np.tan(td / 2.0)))
        lo = use_to

    idx = np.flatnonzero(have)
    block = max(4, int(3.0e5 / (az.size * max(p[0].size for p in plan))))  # about 2.4 MB per work array

    def run(sel):
        u = up_p[sel]
        tang = level[None, :, :] - (u @ level.T)[:, :, None] * u[:, None, :]  # onto the pixel's level plane
        tang /= np.linalg.norm(tang, axis=2, keepdims=True)
        tan_h, cut = _march(t.grids, plan, u, tang, h_p[sel] + eye)
        # the sight line that grazes the skyline, as a 3-D vector, read in the lander's frame
        hh = np.arctan(tan_h)  # -inf -> -90 deg: no terrain at all under that ray
        sight = np.cos(hh)[:, :, None] * tang + np.sin(hh)[:, :, None] * u[:, None, :]
        alt = np.degrees(np.arcsin(np.clip(sight @ up0, -1.0, 1.0)))
        az_got = np.degrees(np.arctan2(sight @ east0, sight @ north0))
        off = np.abs((az_got - np.degrees(az)[None, :] + 180.0) % 360.0 - 180.0)
        return alt, cut, np.where(np.isfinite(tan_h), off, 0.0), np.degrees(hh)

    parts = [idx[a:a + block] for a in range(0, idx.size, block)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        done = list(pool.map(run, parts))
    alt = np.full((e.size, az.size), np.nan)
    alt[idx] = np.concatenate([r[0] for r in done])
    cut = np.concatenate([r[1] for r in done])
    az_off = np.concatenate([r[2] for r in done])
    own = np.concatenate([r[3] for r in done])

    value = np.clip(np.rint((alt - HORIZON_OFFSET) / HORIZON_SCALE), 0, 255)
    value[~have] = 255
    notes = []
    blank = 1.0 - have.mean()
    edge_km = math.radians(sightline.COVERAGE_LAT - lat) * R / 1000.0  # how far north of the site the DEM ends
    if blank > 0:
        notes.append(f"The terrain data stops at 80 S, {edge_km:.0f} km north of the site: {100 * blank:.0f} % of this "
                     "map has no terrain and is left blank.")
    if edge_km - size_km / 2.0 < 60.0:
        notes.append(f"Ground beyond the edge of the terrain data ({edge_km:.0f} km north of the site) is not included, "
                     "so shadows cast from the north may be missing.")
    if fine_px > 20.0:
        notes.append(f"This map is wide, so the ground next to each point is read at {fine_px:.0f} m instead of 20 m: "
                     "shadows from small features close to a point are missed.")
    out = {"lat": lat, "lon": lon, "size_km": size_km, "res": res, "observer_m": eye, "az_step_deg": AZ_STEP_DEG,
           "elevation_m": np.where(have, np.round(h_p, 1), NODATA_M).tolist(),
           "horizon_b64": base64.b64encode(value.astype(np.uint8).tobytes()).decode("ascii"),
           "horizon_scale": HORIZON_SCALE, "horizon_offset": HORIZON_OFFSET, "synthetic": False,
           "source": sightline._source_label(target), "note": " ".join(notes) or None}
    info = {"tiers": tiers, "samples_per_ray": int(d.size), "rays": int(idx.size * az.size),
            "grid_mb": sum(g.z.nbytes for g, _ in t.grids) / 1e6, "rays_cut": float(cut.mean()),
            "az_off_max_deg": float(az_off.max()), "az_off_max_low_deg": float(az_off[own < 10.0].max(initial=0.0)),
            "alt_deg": alt}
    return out, info


def decode(m: dict) -> np.ndarray:
    """The packed horizon as degrees, shape (res, res, directions). For tests and checks."""
    raw = np.frombuffer(base64.b64decode(m["horizon_b64"]), dtype=np.uint8)
    return raw.reshape(m["res"], m["res"], -1) * m["horizon_scale"] + m["horizon_offset"]


def shadow_map(lat: float, lon: float, size_km: float = 16.0, res: int = 96, observer_m: float = 2.0) -> dict:
    """Terrain and per-pixel horizon around a site (see the top of this file). Raises ValueError without real terrain."""
    lat, lon = sightline._site(lat, lon)
    size_km = round(float(min(max(size_km, 2.0), 320.0)), 2)
    res = int(min(max(int(res), 32), 160))
    eye = round(float(min(max(observer_m, 0.5), 30.0)), 1)
    target = sightline.dem_target()
    if target is None:
        raise ValueError("No terrain file is installed and network reads are turned off, so there is no shadow map.")
    if lat > sightline.COVERAGE_LAT:
        raise ValueError("The terrain data covers 80 S to the pole only, so there is no shadow map for this place.")
    cache = sightline._cache_file("shadowmap", target, _TAG, lat, lon, f"km{size_km}", f"res{res}", f"eye{eye}")
    hit = sightline._cache_get(cache, "horizon_b64")
    if hit:
        return hit
    with _LOCK:
        hit = sightline._cache_get(cache, "horizon_b64")
        if hit:
            return hit
        out, _ = _build(target, lat, lon, size_km, res, eye)
        sightline._cache_put(cache, out)
    return out
