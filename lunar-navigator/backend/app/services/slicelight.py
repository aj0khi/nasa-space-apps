"""Ray-traced light along a slice (GET /terrain/slice-light). Owner: LEAD. Contract: app.models.SliceLight.

What it answers
    For every ground point along a straight slice through the landing site, and every instant of the month:
    is the centre of the Sun (and of the Earth) above that point's OWN terrain skyline, seen from `observer_m`
    above the ground there? Shadows on the slice are mostly cast by terrain that is not on the slice, so each
    point gets its own 360-degree skyline, ray traced through the full 3-D terrain.

How
    1. Points: `points` positions evenly spaced in ground distance along the great circle through the site, from
       `length_km` behind it to `length_km` toward `azimuth`. x_m uses the same formula as sightline.section.
    2. Skyline of each point: one ray per whole degree of azimuth (local north of THAT point), marched out to
       250 km. Steps along a ray grow by 1.2 % out to 2 km and by 0.8 % beyond, starting 2 m from the eye, so
       ground beside the eye is never stepped over (the eye is only `observer_m` up). 914 steps a ray.
       This is coarser than sightline.skyline (8 rays a degree, 2252 steps); see "Accuracy" for what that costs.
    3. Sun and Earth: their altitude and azimuth at the lander (ephemeris.find_windows, the same series the panel
       uses) are turned into directions in the Moon-fixed frame, moved to each point (the Earth is near enough
       for its direction to change by up to 0.02 deg across 150 km, so its distance is used; for the Sun this is
       0.00006 deg), and expressed as altitude and azimuth in each point's own level plane and local north.
    4. A body is in view at a point when its centre is above the point's skyline at its azimuth (linear between
       whole degrees), the same rule the panel applies to sightline.skyline at the lander.

Terrain
    The same three resolutions as sightline (overviews of the one LOLA file), but measured from each POINT, not
    from the lander: finest data within 10 km of the point, about 80 m to 55 km, about 320 m beyond. The finest
    is 20 m for slices up to 35 km each way and 40 m for longer ones (20 m around every point of a 150 km slice
    would be over 1 GB). Everything is read once as squares around the lander that are large enough for the
    farthest point.

Accuracy (measured on the real DEM, November 2026 month, hourly; see docs)
    At x = 0 the answer is compared with sightline.skyline at the lander; elsewhere with sightline.skyline run at
    that point's own latitude and longitude. The numbers are in the final report of this module's author and in
    docs/API.md. The answer inherits sightline's limits: the DEM stops at 80 S (the note says when ground beyond
    it could change an "in view" answer), and on crests the eye height matters more than anything else.

Cost
    The skylines of a slice do not depend on the date, so they are cached on disk (data/cache/) under a key with
    every parameter that changes them; a new date or month for the same slice is then answered in well under a
    second. The terrain of the last slice stays in memory so the next slice direction at the same site skips
    the read.

No real terrain (no DEM and network reads off, a site north of 80 S, an unreadable file): ValueError with the
reason. This module never returns made-up light.
"""
from __future__ import annotations

import hashlib
import math
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pydantic import TypeAdapter

from app.services import ephemeris, sightline

R = sightline.R
REACH_M = sightline.MAX_REACH_KM * 1000.0
RAYS_PER_DEG = 2            # rays per whole degree of azimuth, averaged (sightline.skyline uses 8)
FIRST_STEP_M = 2.0          # first sample along a ray
NEAR_RATIO = 1.012          # each step this much farther than the last, out to NEAR_TO_M
NEAR_TO_M = 2000.0
FAR_RATIO = 1.008           # and this much beyond
FINE_MAX_KM = 35.0          # slices up to this long each way read 20 m data to 10 km around every point
STRIP_TO_M = 2000.0         # longer slices: 20 m data only this far around each point (40 m from there to 10 km)
STRIP_PIECE_M = 10_000.0    # ... read as squares, one for each piece of the slice this long
SUN_DISTANCE_M = 1.496e11   # only used when a caller gives no distance; the parallax is 0.00006 deg at most
EARTH_DISTANCE_M = 3.844e8  # mean; only used when a caller gives no distance
_BLOCK = 48_000             # samples worked on at a time (keeps the arrays in the processor's cache)
_ISO = TypeAdapter(datetime)
_LOCK = threading.Lock()    # one slice at a time: a second request for the same slice then finds it cached
_CODE = Path(__file__).read_bytes()


# ---------------------------------------------------------------- settings, tiers, steps
def _tag() -> str:
    """Changes when this file or a setting changes (sightline's own tag is added by its _cache_file)."""
    settings = repr((REACH_M, RAYS_PER_DEG, FIRST_STEP_M, NEAR_RATIO, NEAR_TO_M, FAR_RATIO, FINE_MAX_KM, STRIP_TO_M,
                     STRIP_PIECE_M)).encode()
    return hashlib.sha1(_CODE + settings).hexdigest()[:8]


def _tiers(length_km: float) -> list[tuple[float, float, float]]:
    """(pixel size m, radius read around the lander m, used out to this distance from each POINT m).

    A tier is used where it has data and the next one where it has none (as in sightline._Terrain.height).
    The radius is the slice half-length plus the distance the tier is used to, plus 2 % because the DEM's
    projection stretches distances by up to 0.8 % at 80 S, plus a few pixels.
    Long slices: 20 m data to 10 km around every point would be over 1 GB. They get the 20 m data around the lander
    (exactly what sightline.skyline reads, so x = 0 is unchanged), 40 m data to 10 km around every other point, and
    a strip of 20 m data within STRIP_TO_M of the slice (see _strip) for the ground beside each point.
    """
    near_to, mid_to = sightline.TIERS[0][2], sightline.TIERS[1][2]
    reach = length_km * 1000.0
    if length_km <= FINE_MAX_KM:
        fine = [(20.0, (reach + near_to) * 1.02 + 80.0, near_to)]
    else:
        fine = [(20.0, sightline.TIERS[0][1], near_to), (40.0, (reach + near_to) * 1.02 + 160.0, near_to)]
    return fine + [(80.0, (reach + mid_to) * 1.02 + 320.0, mid_to), (320.0, (reach + REACH_M) * 1.02 + 1280.0, 1e12)]


def _steps() -> np.ndarray:
    """Distances (m) sampled along every ray: geometric, so the step is always a fixed small part of the range."""
    d = [FIRST_STEP_M]
    while d[-1] < REACH_M:
        d.append(d[-1] * (NEAR_RATIO if d[-1] < NEAR_TO_M else FAR_RATIO))
    d[-1] = REACH_M
    return np.array(d)


# ---------------------------------------------------------------- vectors on the sphere
def _frame(lat, lon):
    """Unit vectors up, east and north (Moon-fixed x, y, z) at lat/lon in degrees. Shapes (..., 3)."""
    p, l = np.radians(np.asarray(lat, float)), np.radians(np.asarray(lon, float))
    sp, cp, sl, cl = np.sin(p), np.cos(p), np.sin(l), np.cos(l)
    up = np.stack([cp * cl, cp * sl, sp], axis=-1)
    east = np.stack([-sl, cl, np.zeros_like(sp)], axis=-1)
    north = np.stack([-sp * cl, -sp * sl, cp], axis=-1)
    return up, east, north


def _direction(lat: float, lon: float, alt_deg, az_deg) -> np.ndarray:
    """Altitude and azimuth (deg) seen at lat/lon as unit vectors in the Moon-fixed frame. Shape (T, 3)."""
    up, east, north = _frame(lat, lon)
    alt, az = np.radians(np.asarray(alt_deg, float))[:, None], np.radians(np.asarray(az_deg, float))[:, None]
    return np.cos(alt) * (np.cos(az) * north + np.sin(az) * east) + np.sin(alt) * up


def _seen_from(points_up, points_east, points_north, shift, direction, distance_m):
    """Altitude and azimuth (deg) of a body at each point. Shapes (T, N).

    `direction` (T, 3) is the body seen from the lander, `distance_m` (T,) how far it is, and `shift` (N, 3) is
    each point's position minus the lander's: the body's direction from a point is along distance * direction - shift.
    """
    v = direction[:, None, :] * np.asarray(distance_m, float).reshape(-1, 1, 1) - shift[None, :, :]
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    alt = np.degrees(np.arcsin(np.clip(np.einsum("tnk,nk->tn", v, points_up), -1.0, 1.0)))
    az = np.degrees(np.arctan2(np.einsum("tnk,nk->tn", v, points_east), np.einsum("tnk,nk->tn", v, points_north)))
    return alt, az % 360.0


# ---------------------------------------------------------------- the terrain, ready for fast sampling
class _Tier:
    """One resolution of the DEM as a float32 array with a border of NaN, sampled in the DEM's own x, y."""

    def __init__(self, grid, use_to: float, h_ref: np.float32):
        ny, nx = grid.z.shape
        z = np.full((ny + 2, nx + 2), np.nan, dtype=np.float32)
        np.subtract(grid.z, h_ref, out=z[1:-1, 1:-1])  # heights relative to the lander's ground keep float32 exact
        self.holes = bool(np.isnan(z[1:-1, 1:-1]).any())
        self.z, self.w, self.h = z, nx + 2, ny + 2
        flat = z.reshape(-1)
        w = self.w
        self.corners = (flat[:-(w + 1)], flat[1:-w], flat[w:-1], flat[w + 1:])  # the four neighbours share one index
        self.left, self.top, self.res_x, self.res_y, self.use_to = grid.left, grid.top, grid.res_x, grid.res_y, use_to

    def pixel(self, x, y):
        """Column and row (fractional, in the bordered array) of DEM coordinates x, y."""
        return (x - self.left) / self.res_x + 0.5, (self.top - y) / self.res_y + 0.5

    def sample(self, x, y):
        """Bilinear height (relative, float64) at x, y; NaN outside the data."""
        c, r = self.pixel(np.asarray(x, float), np.asarray(y, float))
        c0 = np.clip(np.floor(c), 0, self.w - 2).astype(np.intp)
        r0 = np.clip(np.floor(r), 0, self.h - 2).astype(np.intp)
        fc, fr = np.clip(c - c0, 0.0, 1.0), np.clip(r - r0, 0.0, 1.0)
        z = self.z
        a, b = z[r0, c0].astype(float), z[r0, c0 + 1].astype(float)
        cc, d = z[r0 + 1, c0].astype(float), z[r0 + 1, c0 + 1].astype(float)
        return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + cc * (1 - fc) * fr + d * fc * fr


class _Field:
    """The DEM around a slice at three resolutions, each used by distance from the ray's own starting point."""

    def __init__(self, target: str, lat: float, lon: float, tiers):
        t = sightline._Terrain(target, lat, lon, tiers=tiers)
        ref = np.float32(t.h0)
        self.h_ref = float(ref)
        self.tiers = []
        for grid, use_to in t.grids:
            self.tiers.append(_Tier(grid, use_to, ref))
            grid.z = None  # the bordered copy replaces it; do not hold both
        self.megabytes = sum(tier.z.nbytes for tier in self.tiers) / 1e6

    def ground(self, x, y):
        """Ground height (m, relative to h_ref) from the finest tier that has data; NaN where the DEM has none."""
        out = np.full(np.shape(x), np.nan)
        for tier in self.tiers:
            want = np.isnan(out)
            if not want.any():
                break
            out[want] = tier.sample(x[want], y[want])
        return out


_FIELDS: "OrderedDict[tuple, _Field]" = OrderedDict()


def _field(target: str, lat: float, lon: float, tiers) -> _Field:
    """The terrain for a slice. The last one is kept (if under 450 MB) for the next slice direction at the site."""
    key = (target, lat, lon, tuple(tiers), sightline._settings_tag())
    hit = _FIELDS.get(key)
    if hit is not None:
        return hit
    _FIELDS.clear()
    with sightline._READ_LOCK:
        field = _Field(target, lat, lon, tiers)
    if field.megabytes < 450.0:
        _FIELDS[key] = field
    return field


def _clear_memory() -> None:
    """Forget everything held in memory (tests call this when they swap the DEM)."""
    _FIELDS.clear()
    _SKIES.clear()
    _LIGHTS.clear()


def _strip(target: str, field: _Field, lat: float, lon: float, azimuth: float, length_km: float) -> list:
    """For long slices: 20 m data close to the slice, as one small square for each STRIP_PIECE_M of its length.

    Returns (from m, to m, tier) for each piece, in ground distance along the slice; a piece with no DEM under its
    middle is left out. The ground beside a point decides much of its skyline, so it is always read at 20 m.
    """
    if length_km <= FINE_MAX_KM:
        return []
    reach = length_km * 1000.0
    count = max(1, math.ceil(2.0 * reach / STRIP_PIECE_M))
    piece = 2.0 * reach / count
    radius = (piece / 2.0 + STRIP_TO_M) * 1.02 + 80.0
    out = []
    with sightline._READ_LOCK:
        for k in range(count):
            a, b = -reach + k * piece, -reach + (k + 1) * piece
            mid = (a + b) / 2.0
            clat, clon = sightline._destination(lat, lon, azimuth if mid >= 0 else (azimuth + 180.0) % 360.0, abs(mid))
            try:
                t = sightline._Terrain(target, float(clat), float(clon), tiers=[(20.0, radius, STRIP_TO_M)])
            except ValueError:
                continue  # this piece lies beyond the DEM
            out.append((a, b, _Tier(t.grids[0][0], STRIP_TO_M, np.float32(field.h_ref))))
    return out


# ---------------------------------------------------------------- the ray trace
class _Tracer:
    """Marches a fan of rays from one point after another through a _Field. Buffers are reused between points."""

    def __init__(self, field: _Field):
        self.field = field
        d = _steps()
        self.d = d
        th = d / R
        self.sin, self.cos, self.vers = np.sin(th), np.cos(th), 2.0 * np.sin(th / 2.0) ** 2
        n_az = 360 * RAYS_PER_DEG
        offs = (np.arange(RAYS_PER_DEG) + 0.5) / RAYS_PER_DEG - 0.5
        az = np.radians((np.arange(360)[:, None] + offs[None, :]).reshape(-1))
        self.cos_az, self.sin_az = np.cos(az), np.sin(az)
        # which tiers each step uses, as column ranges (the same rule as sightline._Terrain.height): the first of the
        # chain where it has data, the next where it has none
        self.base = []
        start = 0
        tiers = field.tiers
        for i, tier in enumerate(tiers):
            stop = int(np.searchsorted(d, tier.use_to, side="right")) if i < len(tiers) - 1 else d.size
            if stop > start:
                self.base.append((tuple(tiers[i:]), start, stop))
            start = max(start, stop)
        self.j_strip = int(np.searchsorted(d, STRIP_TO_M, side="right"))
        self.n_az = n_az
        self._buf: dict[tuple, tuple] = {}

    def _ranges(self, patch):
        """The column ranges for a point; with `patch` (20 m data beside the point) put first out to STRIP_TO_M."""
        if patch is None:
            return self.base
        out = []
        for chain, j0, j1 in self.base:
            if j0 < self.j_strip:
                jm = min(j1, self.j_strip)
                out.append(((patch,) + chain, j0, jm))
                if jm < j1:
                    out.append((chain, jm, j1))
            else:
                out.append((chain, j0, j1))
        return out

    def _buffers(self, shape):
        if shape not in self._buf:
            self._buf[shape] = tuple(np.empty(shape, np.float32) for _ in range(5)) + (
                np.empty(shape, np.intp), np.empty(shape, np.intp))
        return self._buf[shape]

    def _block(self, chain: tuple, a0: int, a1: int, j0: int, j1: int, p: dict):
        """tan(elevation angle) of the ground under rays a0:a1 at steps j0:j1, from the first tier of `chain` and
        from the following ones where it has no data (NaN where none has), and whether any of it is NaN."""
        tier = chain[0]
        E, C, Q, A0, A1, I1, I2 = self._buffers((a1 - a0, j1 - j0))
        f32 = np.float32
        sin, cos = self.sin[j0:j1].astype(f32), self.cos[j0:j1].astype(f32)
        # Position after ground distance d on azimuth a, as a unit vector: up + (t sin(th) - up vers(th)) with t the
        # horizontal unit vector of the ray. In the DEM's projection (x = 2R Y / (1 - Z), y = 2R X / (1 - Z)) the
        # offset from the point is (num_x, num_y) / (1 - eps), every term small, so float32 loses nothing.
        col_p, row_p = tier.pixel(p["x"], p["y"])
        ic, ir = math.floor(col_p), math.floor(row_p)
        reach_px = self.d[j1 - 1] * 1.02 / min(tier.res_x, tier.res_y) + 3.0
        more = len(chain) > 1
        if more and (ic + reach_px < 1 or ic - reach_px > tier.w - 2 or ir + reach_px < 1 or ir - reach_px > tier.h - 2):
            return self._block(chain[1:], a0, a1, j0, j1, p)   # this tier has nothing near the point
        inside = (ic - reach_px >= 1 and ic + reach_px <= tier.w - 3 and ir - reach_px >= 1 and ir + reach_px <= tier.h - 3)
        np.multiply.outer(p["tz"][a0:a1], sin, out=E)
        E -= (p["kz"] * self.vers[j0:j1]).astype(f32)
        np.subtract(f32(1.0), E, out=E)
        np.reciprocal(E, out=E)
        cx, cy = p["cx"][a0:a1] / tier.res_x, -p["cy"][a0:a1] / tier.res_y
        np.multiply.outer(cx.astype(f32), sin, out=C)
        C -= (p["kx"] / tier.res_x * self.vers[j0:j1]).astype(f32)
        C *= E
        C += f32(col_p - ic)
        np.multiply.outer(cy.astype(f32), sin, out=Q)
        Q += (p["ky"] / tier.res_y * self.vers[j0:j1]).astype(f32)
        Q *= E
        Q += f32(row_p - ir)
        np.floor(C, out=A0)
        C -= A0
        np.copyto(I1, A0, casting="unsafe")
        np.floor(Q, out=A0)
        Q -= A0
        np.copyto(I2, A0, casting="unsafe")
        if inside:
            I2 *= tier.w
            I2 += I1
            I2 += ir * tier.w + ic
        else:  # some samples fall outside the array: send them to the NaN border
            I1 += ic
            np.clip(I1, 0, tier.w - 2, out=I1)
            I2 += ir
            np.clip(I2, 0, tier.h - 2, out=I2)
            I2 *= tier.w
            I2 += I1
        z00, z01, z10, z11 = tier.corners
        np.take(z00, I2, out=A0, mode="clip")
        np.take(z01, I2, out=A1, mode="clip")
        A1 -= A0
        A1 *= C
        A0 += A1
        np.take(z10, I2, out=A1, mode="clip")
        np.take(z11, I2, out=E, mode="clip")
        E -= A1
        E *= C
        A1 += E
        A1 -= A0
        A1 *= Q
        A0 += A1                                   # ground height relative to h_ref
        # tan(elevation) = ((R + h) cos th - r_eye) / ((R + h) sin th), written with u = h - eye so nothing large cancels
        r_eye = R + self.field.h_ref + p["eye"]
        A0 -= f32(p["eye"])
        np.multiply(A0, sin, out=A1)
        A1 += (r_eye * self.sin[j0:j1]).astype(f32)
        A0 *= cos
        A0 -= (r_eye * self.vers[j0:j1]).astype(f32)
        A0 /= A1
        if (inside and not tier.holes) or not math.isnan(float(A0.sum(dtype=np.float64))):
            return A0, False
        if more:                                   # no data here at this resolution: use the next coarser one
            fine = A0.copy()
            coarse, gaps = self._block(chain[1:], a0, a1, j0, j1, p)
            np.copyto(coarse, fine, where=~np.isnan(fine))
            return coarse, gaps
        return A0, True

    def point(self, x: float, y: float, up, east, north, eye_rel: float, patch=None):
        """Skyline (deg, per whole degree) and how far the DEM reached (m, per whole degree) around one point.

        x, y: the point in the DEM's projection. up, east, north: its local unit vectors. eye_rel: height of the
        eye relative to the field's reference height. patch: a tier of 20 m data beside the point, if there is one.
        """
        w = 1.0 - up[2]
        t = np.outer(self.cos_az, north) + np.outer(self.sin_az, east)          # horizontal unit vector of each ray
        p = {"x": x, "y": y, "eye": eye_rel, "tz": (t[:, 2] / w).astype(np.float32), "kz": up[2] / w,
             "cx": (2.0 * R * t[:, 1] + x * t[:, 2]) / w, "kx": (2.0 * R * up[1] + x * up[2]) / w,
             "cy": (2.0 * R * t[:, 0] + y * t[:, 2]) / w, "ky": (2.0 * R * up[0] + y * up[2]) / w}
        n_az = t.shape[0]
        best = np.full(n_az, -np.inf, dtype=np.float32)
        seen = np.full(n_az, REACH_M)
        for chain, j0, j1 in self._ranges(patch):
            rows = max(1, min(n_az, _BLOCK // (j1 - j0)))
            for a0 in range(0, n_az, rows):
                a1 = min(n_az, a0 + rows)
                tan, gaps = self._block(chain, a0, a1, j0, j1, p)
                np.fmax(best[a0:a1], np.fmax.reduce(tan, axis=1), out=best[a0:a1])
                if gaps:  # the DEM ends under some of these rays: note where each first runs out of data
                    gap = np.isnan(tan)
                    first = np.where(gap.any(axis=1), self.d[j0 + gap.argmax(axis=1)], REACH_M)
                    np.minimum(seen[a0:a1], first, out=seen[a0:a1])
        elev = np.where(np.isfinite(best), np.degrees(np.arctan(best.astype(float))), -90.0)
        return elev.reshape(360, RAYS_PER_DEG).mean(axis=1), seen.reshape(360, RAYS_PER_DEG).min(axis=1)


# ---------------------------------------------------------------- skylines of a slice (date-independent, cached)
_SKIES: "OrderedDict[str, dict]" = OrderedDict()


def _clean(lat: float, lon: float, azimuth: float, length_km: float, observer_m: float, points: int):
    lat, lon = sightline._site(lat, lon)
    azimuth = round(float(azimuth) % 360.0, 2) % 360.0
    length_km = round(float(min(max(length_km, 0.5), 150.0)), 2)
    eye = round(float(min(max(observer_m, 0.5), 30.0)), 1)
    points = int(min(max(int(points), 21), 401))
    return lat, lon, azimuth, length_km, eye, points


def _target(lat: float) -> str:
    target = sightline.dem_target()
    if target is None:
        raise ValueError("No terrain data is installed and network reads are turned off, so the light along the "
                         "slice cannot be ray traced.")
    if lat > sightline.COVERAGE_LAT:
        raise ValueError("The terrain data covers 80 S to the pole only, so the light along a slice through this "
                         "site cannot be ray traced.")
    return target


def slice_skylines(lat: float, lon: float, azimuth: float, length_km: float, observer_m: float, points: int) -> dict:
    """The ray-traced skyline of every point along a slice. Arrays, not JSON:

    dist_m (N) ground distance from the lander, negative behind it; x_m (N) as sightline.section;
    lat, lon (N); ground_m (N) elevation, NaN beyond the DEM; sky (N, 360) deg above each point's own level
    plane by that point's own azimuth; seen_m (N, 360) how far the DEM reached; plus eye, source, dem_top_m.
    """
    lat, lon, azimuth, length_km, eye, points = _clean(lat, lon, azimuth, length_km, observer_m, points)
    target = _target(lat)
    cache = sightline._cache_file("slicesky", target, lat, lon, f"az{azimuth}", f"len{length_km}", f"eye{eye}",
                                  f"n{points}", _tag())
    key = str(cache)
    if key in _SKIES:
        _SKIES.move_to_end(key)
        return _SKIES[key]
    with _LOCK:
        if key in _SKIES:
            return _SKIES[key]
        hit = sightline._cache_get(cache, "sky")
        if hit and len(hit.get("sky", [])) == points:
            out = _from_cache(hit)
        else:
            out = _trace_slice(target, lat, lon, azimuth, length_km, eye, points)
            sightline._cache_put(cache, _to_cache(out))
        _SKIES[key] = out
        while len(_SKIES) > 8:
            _SKIES.popitem(last=False)
        return out


def _to_cache(s: dict) -> dict:
    whole = bool((s["seen_m"] >= REACH_M).all())
    return {"dist_m": s["dist_m"].tolist(), "x_m": s["x_m"].tolist(), "lat": s["lat"].tolist(), "lon": s["lon"].tolist(),
            "ground_m": [None if not np.isfinite(v) else round(float(v), 2) for v in s["ground_m"]],
            "sky": np.round(s["sky"], 3).tolist(),
            "seen_km": None if whole else np.round(s["seen_m"] / 1000.0, 2).tolist(),
            "eye": s["eye"], "azimuth": s["azimuth"], "length_km": s["length_km"], "source": s["source"],
            "dem_top_m": s["dem_top_m"], "finest_m": s["finest_m"]}


def _from_cache(c: dict) -> dict:
    sky = np.array(c["sky"], dtype=float)
    seen = np.full(sky.shape, REACH_M) if c.get("seen_km") is None else np.array(c["seen_km"], dtype=float) * 1000.0
    return {"dist_m": np.array(c["dist_m"], dtype=float), "x_m": np.array(c["x_m"], dtype=float),
            "lat": np.array(c["lat"], dtype=float), "lon": np.array(c["lon"], dtype=float),
            "ground_m": np.array([np.nan if v is None else v for v in c["ground_m"]], dtype=float),
            "sky": sky, "seen_m": seen, "eye": c["eye"], "azimuth": c["azimuth"], "length_km": c["length_km"],
            "source": c["source"], "dem_top_m": c.get("dem_top_m"), "finest_m": c.get("finest_m")}


def _trace_slice(target: str, lat: float, lon: float, azimuth: float, length_km: float, eye: float, points: int) -> dict:
    dist = np.linspace(-length_km * 1000.0, length_km * 1000.0, points)
    ahead = dist >= 0
    plat, plon = np.empty(points), np.empty(points)
    plat[ahead], plon[ahead] = sightline._destination(lat, lon, azimuth, dist[ahead])
    plat[~ahead], plon[~ahead] = sightline._destination(lat, lon, (azimuth + 180.0) % 360.0, -dist[~ahead])
    try:
        field = _field(target, lat, lon, _tiers(length_km))
    except ValueError as exc:
        raise ValueError(f"The terrain data cannot be used for this slice: {exc}") from exc
    except Exception as exc:  # rasterio: missing or damaged file, no network
        raise ValueError(f"The terrain data could not be read: {exc}") from exc
    up, east, north = _frame(plat, plon)
    w = 1.0 - up[:, 2]
    x, y = 2.0 * R * up[:, 1] / w, 2.0 * R * up[:, 0] / w      # the DEM's projection, same as sightline._ll2xy
    try:
        strip = _strip(target, field, lat, lon, azimuth, length_km)
    except Exception as exc:
        raise ValueError(f"The terrain data could not be read: {exc}") from exc
    patch = [next((tier for a, b, tier in strip if a <= d <= b), None) for d in dist]
    rel = field.ground(x, y)
    for i, tier in enumerate(patch):  # the eye stands on the same ground its nearest rays see
        if tier is not None:
            here = float(tier.sample(x[i], y[i]))
            if np.isfinite(here):
                rel[i] = here
    tracer = _Tracer(field)
    sky = np.full((points, 360), np.nan)
    seen = np.full((points, 360), REACH_M)
    for i in range(points):
        if np.isfinite(rel[i]):
            sky[i], seen[i] = tracer.point(float(x[i]), float(y[i]), up[i], east[i], north[i], float(rel[i]) + eye,
                                           patch[i])
    ground = rel + field.h_ref
    h = np.where(np.isfinite(ground), ground, field.h_ref)
    x_m = np.round(np.sign(dist) * (R + h) * np.sin(np.abs(dist) / R), 1)   # as sightline.section
    top = sightline._dem_top(target)
    return {"dist_m": dist, "x_m": x_m, "lat": plat, "lon": plon, "ground_m": ground, "sky": sky, "seen_m": seen,
            "eye": eye, "azimuth": azimuth, "length_km": length_km, "source": sightline._source_label(target),
            "dem_top_m": None if top is None else round(top), "finest_m": field.tiers[0].res_x}


# ---------------------------------------------------------------- light for given body directions
def _lookup(sky: np.ndarray, az: np.ndarray) -> np.ndarray:
    """Skyline (N, 360) at azimuths az (T, N), linear between whole degrees."""
    i0 = np.floor(az).astype(np.intp) % 360
    f = az - np.floor(az)
    cols = np.arange(sky.shape[0])[None, :]
    return sky[cols, i0] * (1.0 - f) + sky[cols, (i0 + 1) % 360] * f


def light_for_directions(lat: float, lon: float, azimuth: float, length_km: float, observer_m: float, points: int,
                         bodies: dict, step_hours: float = 1.0, frame_at: tuple[float, float] | None = None) -> dict:
    """The light along a slice for chosen body directions (this is what slice_light calls; tests call it directly).

    bodies: name -> (altitude deg, azimuth deg[, distance m]) with one value per instant, as seen AT THE LANDER.
    frame_at: the lat/lon those angles were computed for, when it is not exactly the (rounded) site.
    Returns x_m, eye, source, note and per body: `name` (T strings of N characters), `name`_hours (N), plus
    `name`_alt and `name`_az (T, N arrays: the body as seen from every point, for checks).
    """
    s = slice_skylines(lat, lon, azimuth, length_km, observer_m, points)
    site = sightline._site(lat, lon)
    up, east, north = _frame(s["lat"], s["lon"])
    ok = np.isfinite(s["ground_m"])
    site_up = _frame(*site)[0]
    i0 = int(np.argmin(np.abs(s["dist_m"])))
    h0 = s["ground_m"][i0] if ok[i0] else 0.0
    h = np.where(ok, s["ground_m"], h0)
    shift = (R + h + s["eye"])[:, None] * up - (R + h0 + s["eye"]) * site_up[None, :]
    sky = np.where(ok[:, None], s["sky"], 90.0)   # no ground, no eye: reported as not in view and said in the note
    out = {"azimuth": s["azimuth"], "length_km": s["length_km"], "observer_m": s["eye"], "x_m": s["x_m"].tolist(),
           "synthetic": False, "source": s["source"]}
    top = s["dem_top_m"]
    doubt, lowest, total_in_view = {}, math.inf, 0
    for name, given in bodies.items():
        alt0, az0 = np.atleast_1d(np.asarray(given[0], float)), np.atleast_1d(np.asarray(given[1], float))
        default = EARTH_DISTANCE_M if name == "earth" else SUN_DISTANCE_M
        far = np.broadcast_to(np.asarray(given[2] if len(given) > 2 and given[2] is not None else default, float),
                              alt0.shape)
        alt, az = _seen_from(up, east, north, shift, _direction(*(frame_at or site), alt0, az0), far)
        view = (alt > _lookup(sky, az)) & ok[None, :]
        out[name] = [row.tobytes().decode("ascii") for row in (view + 48).astype(np.uint8)]
        out[f"{name}_hours"] = np.round(view.sum(axis=0) * step_hours, 2).tolist()
        out[f"{name}_alt"], out[f"{name}_az"] = alt, az
        # Where the DEM ended before 250 km in the body's direction: how high would ground just past the edge
        # have to stand to cover the body? (a sight line leaving the eye at angle e is at radius
        # r_eye cos(e) / cos(e + s / R) after ground distance s). Only "in view" answers can be changed by it.
        cols = np.arange(points)[None, :]
        reach = s["seen_m"][cols, np.round(az).astype(np.intp) % 360]
        e = np.radians(alt)
        behind = np.cos(e + reach / R)
        with np.errstate(divide="ignore", invalid="ignore"):
            need = np.where(behind > 0, (R + h[None, :] + s["eye"]) * np.cos(e) / behind - R, np.inf)
        open_edge = view & (reach < REACH_M) & (need < (top if top is not None else np.inf))
        doubt[name] = int(open_edge.sum())
        total_in_view += int(view.sum())
        if open_edge.any():
            lowest = min(lowest, float(need[open_edge].min()))
    notes = []
    if not ok.all():
        notes.append(f"{int((~ok).sum())} of the {points} points lie beyond the terrain data and are reported as not in view.")
    if any(doubt.values()):
        which = " and ".join(f"the {name.capitalize()} in {n:,}" for name, n in doubt.items() if n)
        notes.append(f"The terrain data stops at 80 S, before 250 km in some directions, and ground beyond its edge is "
                     f"not included. If it stood above {lowest:,.0f} m elevation there it could hide {which} of the "
                     f"{total_in_view:,} 'in view' answers"
                     + (f" (the highest ground in the file is {top:,.0f} m)." if top is not None else "."))
    out["note"] = " ".join(notes) or None
    return out


# ---------------------------------------------------------------- the endpoint's service
_LIGHTS: "OrderedDict[tuple, dict]" = OrderedDict()


def _distances(times: list[datetime]):
    """Distance (m) from the Moon's centre to the Sun and to the Earth at each instant."""
    ts, eph, _, _ = ephemeris._kernels()
    t = ts.from_datetimes(times)
    moon = eph["moon"].at(t)
    return ((eph["sun"].at(t).position.km - moon.position.km) ** 2).sum(axis=0) ** 0.5 * 1000.0, \
           ((eph["earth"].at(t).position.km - moon.position.km) ** 2).sum(axis=0) ** 0.5 * 1000.0


def slice_light(lat: float, lon: float, azimuth: float, length_km: float, start: datetime | None, days: float,
                step_min: int, observer_m: float, points: int) -> dict:
    """For every ground point along the slice and every instant: is the Sun / Earth in view from there?"""
    when = start or datetime.now(timezone.utc)  # the same default as GET /ephemeris/windows
    c_lat, c_lon, c_az, c_len, eye, n = _clean(lat, lon, azimuth, length_km, observer_m, points)
    target = _target(c_lat)
    key = (target, sightline._settings_tag(), _tag(), c_lat, c_lon, c_az, c_len, eye, n, float(lat), float(lon),
           ephemeris._utc(when).isoformat(), float(days), int(step_min), str(sightline.CACHE_DIR))
    if start is not None and key in _LIGHTS:
        _LIGHTS.move_to_end(key)
        return _LIGHTS[key]
    series = ephemeris.find_windows(lat, lon, when, days, step_min).series   # the instants and angles the panel uses
    times = [p.time for p in series]
    try:
        sun_m, earth_m = _distances(times)
    except Exception:  # the distances only refine the Earth's direction by up to 0.02 deg: never fail on them
        sun_m = earth_m = None
    step_h = (times[1] - times[0]).total_seconds() / 3600.0 if len(times) > 1 else step_min / 60.0
    got = light_for_directions(
        lat, lon, azimuth, length_km, observer_m, points,
        {"sun": ([p.sun_alt for p in series], [p.sun_az for p in series], sun_m),
         "earth": ([p.earth_alt for p in series], [p.earth_az for p in series], earth_m)},
        step_hours=step_h, frame_at=(float(lat), float(lon)))
    out = {"azimuth": got["azimuth"], "length_km": got["length_km"], "observer_m": got["observer_m"], "x_m": got["x_m"],
           "times": [_ISO.dump_python(t, mode="json") for t in times],
           "sun": got["sun"], "earth": got["earth"], "sun_hours": got["sun_hours"], "earth_hours": got["earth_hours"],
           "synthetic": False, "source": got["source"], "note": got["note"]}
    if start is not None:
        _LIGHTS[key] = out
        while len(_LIGHTS) > 16:
            _LIGHTS.popitem(last=False)
    return out
