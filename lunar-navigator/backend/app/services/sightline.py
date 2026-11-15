"""Ray-traced skyline and true terrain slices from the LOLA south-pole DEM. Owner: LEAD (cross section).

Additive module: nothing here changes the existing terrain, ephemeris or evaluation code.

What it answers
    skyline(lat, lon)                 how high the real terrain rises above the lander's horizontal in every
                                      compass direction (360 values). The Sun or Earth is in view when its
                                      elevation is above this value at its azimuth. This is the ray trace:
                                      rays are marched from the lander through the terrain in every direction.
    section(lat, lon, azimuth, km)    the ground along a straight slice through the site, on the real terrain.

Sampling (checked against an independent full-resolution calculation at six sites: 0.007 deg RMS, 0.04 deg worst)
    8 rays per degree of azimuth. Along each ray: 1 m steps to 300 m, 5 m steps to 2 km, then each step 0.3 %
    longer, out to 250 km. The fine steps near the lander matter: the eye is only 2 m up, so on a crest the
    skyline is often the lander's own ground a few tens of metres away.
    elev_deg is the mean over each degree (compare with the centre of the Sun or Earth); elev_max_deg and
    elev_min_deg are the highest and lowest inside that degree.

How it reads the terrain
    One LOLA polar-stereographic GeoTIFF, at three resolutions taken from the file's own overviews:
    20 m out to 10 km, about 80 m out to 55 km, about 320 m beyond. A local file (see terrain._dem_path)
    is used when present; otherwise the NASA copy is read over the network, only the parts that are needed.
    Set LOLA_REMOTE=0 to forbid network reads, or LOLA_DEM_URL to point at another copy.

Geometry
    The Moon is a sphere of radius 1737.4 km. Rays follow great circles. Elevation angles are measured from
    the plane perpendicular to the local vertical at the lander, so distant ground sinks below it by itself:
    there is no separate "curvature correction" and none should be added on top.

Limits
    The DEM stops at 80 S, so terrain north of that is not seen: seen_km says how far the data reaches in each
    direction, and the note says so when it ends early.
    On crests the answer depends on the assumed 2 m eye height more than on anything else (1 m more moves the
    skyline by over a degree in places), and a 20 m DEM does not describe ground 30 to 100 m away that finely.
    Results are cached in memory and on disk (data/cache/), because a first remote read takes several seconds.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

from app.services import polar_dem, terrain

R = terrain.MOON_RADIUS_M
DEFAULT_DEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"
OBSERVER_M = 2.0            # eye of the lander above the ground, same as the rest of the app
MAX_REACH_KM = 250.0        # how far rays are marched
COVERAGE_LAT = -80.0        # the DEM covers 80 S to the pole
# (target pixel size m, radius read around the site m, used out to this distance m)
TIERS = [(20.0, 12e3, 10e3), (80.0, 60e3, 55e3), (320.0, 320e3, 1e12)]
_GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2",
                 GDAL_HTTP_TIMEOUT="60", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF,.tif,.tiff")


# ---------------------------------------------------------------- where the DEM is
def dem_target() -> str | None:
    """Path or /vsicurl/ URL of the DEM to read, or None when there is none."""
    local = terrain._dem_path()
    if local is not None:
        return str(local)
    if os.environ.get("LOLA_REMOTE", "1") != "0":
        return "/vsicurl/" + os.environ.get("LOLA_DEM_URL", DEFAULT_DEM_URL)
    return None


def _source_label(target: str) -> str:
    name = target.rsplit("/", 1)[-1]
    return f"LOLA DEM {name} ({'read from NASA' if target.startswith('/vsicurl/') else 'local file'})"


# ---------------------------------------------------------------- geometry
def _ll2xy(lat, lon):
    """Lat/lon (deg) to south polar stereographic x, y (m): 0 E is +y, 90 E is +x."""
    r = 2.0 * R * np.tan(np.radians(90.0 + np.asarray(lat, float)) / 2.0)
    lon = np.radians(np.asarray(lon, float))
    return r * np.sin(lon), r * np.cos(lon)


def _destination(lat0: float, lon0: float, az, d):
    """Point reached from (lat0, lon0) after distance d (m) on azimuth az (deg clockwise from north)."""
    p0, l0 = math.radians(lat0), math.radians(lon0)
    a = np.radians(np.asarray(az, float))
    th = np.asarray(d, float) / R
    sinp = math.sin(p0) * np.cos(th) + math.cos(p0) * np.sin(th) * np.cos(a)
    p = np.arcsin(np.clip(sinp, -1.0, 1.0))
    l = l0 + np.arctan2(np.sin(a) * np.sin(th) * math.cos(p0), np.cos(th) - math.sin(p0) * sinp)
    return np.degrees(p), np.degrees(l)


def _elevation_angle(r_obs: float, h, d):
    """Angle (deg) above the observer's horizontal of ground at height h (m) and distance d (m)."""
    th = np.asarray(d, float) / R
    r1 = R + np.asarray(h, float)
    return np.degrees(np.arctan2(r1 * np.cos(th) - r_obs, r1 * np.sin(th)))


# ---------------------------------------------------------------- reading the DEM
class _Grid:
    """A square window of the DEM at one resolution, with bilinear sampling by lat/lon."""

    def __init__(self, ds, xc: float, yc: float, radius: float, target_res: float):
        native = abs(ds.transform.a)
        f = max(1, 2 ** round(math.log2(target_res / native)))  # GDAL reads an overview if there is one, else decimates
        tr = ds.transform  # north-up grid: x = c + col * a, y = f + row * e (e is negative)
        col_c, row_c = (xc - tr.c) / tr.a, (yc - tr.f) / tr.e
        half = radius / native
        c0 = max(0, int(math.floor((col_c - half) / f)) * f)
        r0 = max(0, int(math.floor((row_c - half) / f)) * f)
        c1 = min(ds.width, int(math.ceil((col_c + half) / f)) * f)
        r1 = min(ds.height, int(math.ceil((row_c + half) / f)) * f)
        if c1 <= c0 or r1 <= r0:
            raise ValueError("The site is outside the DEM.")
        w, h = c1 - c0, r1 - r0
        out = (max(1, round(h / f)), max(1, round(w / f)))
        z = self._read(ds, Window(c0, r0, w, h), out)
        if ds.nodata is not None and not np.isnan(ds.nodata):
            z[z == ds.nodata] = np.nan
        self.z = z
        self.res_x = native * w / out[1]
        self.res_y = native * h / out[0]
        self.left, self.top = tr.c + c0 * tr.a, tr.f + r0 * tr.e
        self.res = native * f

    @staticmethod
    def _read(ds, window, out_shape, tries: int = 5):
        """Read in horizontal strips, retrying each: long remote reads occasionally fail part-way."""
        rows_out, cols_out = out_shape
        z = np.empty(out_shape, dtype="float32")
        step = max(1, 256 * 1024 // max(cols_out, 1))  # about a megabyte of output per strip
        scale = window.height / rows_out
        for a in range(0, rows_out, step):
            b = min(rows_out, a + step)
            strip = Window(window.col_off, window.row_off + round(a * scale), window.width, round((b - a) * scale))
            for attempt in range(tries):
                try:
                    z[a:b] = ds.read(1, window=strip, out_shape=(b - a, cols_out))
                    break
                except Exception:
                    if attempt == tries - 1 or not str(ds.name).startswith("/vsicurl/"):
                        raise  # a local file does not get better by waiting
                    time.sleep(2.0 * (attempt + 1))
        return z

    def sample(self, lat, lon):
        x, y = _ll2xy(lat, lon)
        c = (x - self.left) / self.res_x - 0.5
        r = (self.top - y) / self.res_y - 0.5
        c0 = np.floor(c).astype(int)
        r0 = np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        ny, nx = self.z.shape
        ok = (c0 >= 0) & (r0 >= 0) & (c0 < nx - 1) & (r0 < ny - 1)
        ca, ra = np.clip(c0, 0, max(nx - 2, 0)), np.clip(r0, 0, max(ny - 2, 0))
        cb, rb = np.minimum(ca + 1, nx - 1), np.minimum(ra + 1, ny - 1)
        z = self.z
        out = z[ra, ca] * (1 - fc) * (1 - fr) + z[ra, cb] * fc * (1 - fr) + z[rb, ca] * (1 - fc) * fr + z[rb, cb] * fc * fr
        return np.where(ok, out, np.nan)


class _Terrain:
    """The DEM around one site at three resolutions."""

    def __init__(self, target: str, lat: float, lon: float):
        self.lat, self.lon = lat, lon
        xc, yc = (float(v) for v in _ll2xy(lat, lon))
        with rasterio.Env(**_GDAL_ENV):
            with rasterio.open(target) as ds:
                crs = ds.crs.to_dict() if ds.crs else {}
                same = (crs.get("proj") == "stere" and float(crs.get("lat_0", 0)) == -90.0
                        and float(crs.get("lon_0", 0)) == 0.0 and float(crs.get("lat_ts", -90)) == -90.0
                        and float(crs.get("k", crs.get("k_0", 1))) == 1.0 and not crs.get("x_0") and not crs.get("y_0")
                        and abs(float(crs.get("R", crs.get("a", 0))) - R) <= 1.0)
                if not same:  # _ll2xy below is written for exactly this grid
                    raise ValueError("The DEM is not the south polar stereographic grid this module assumes "
                                     "(lat_0 -90, lon_0 0, true scale at the pole, R 1737400 m).")
                self.grids = [(_Grid(ds, xc, yc, rad, res), use_to) for res, rad, use_to in TIERS]
        self.finest_m = self.grids[0][0].res
        h0 = self.height(np.array([lat]), np.array([lon]), np.array([0.0]))[0]
        if not np.isfinite(h0):
            raise ValueError("The DEM has no elevation at the site.")
        self.h0 = float(h0)

    def height(self, lat, lon, d):
        """Height (m) at lat/lon, from the finest grid allowed at distance d; NaN where the DEM has no data."""
        lat, lon, d = np.asarray(lat, float), np.asarray(lon, float), np.asarray(d, float)
        out = np.full(lat.shape, np.nan)
        allowed = np.zeros(lat.shape, bool)
        for grid, use_to in self.grids:
            allowed |= d <= use_to
            want = np.isnan(out) & allowed
            if want.any():
                out[want] = grid.sample(lat[want], lon[want])
        return out

    def along(self, az, d):
        lat, lon = _destination(self.lat, self.lon, az, d)
        return self.height(lat, lon, np.broadcast_to(d, np.shape(lat)))


@lru_cache(maxsize=6)  # each holds about 30 MB of elevation
def _terrain_cached(target: str, lat: float, lon: float) -> _Terrain:
    return _Terrain(target, lat, lon)


_READ_LOCK = threading.Lock()


def _terrain(target: str, lat: float, lon: float) -> _Terrain:
    with _READ_LOCK:  # one DEM read at a time; a second request for the same site then finds it in the lru_cache
        return _terrain_cached(target, lat, lon)


_terrain.cache_clear = _terrain_cached.cache_clear
_terrain.cache_info = _terrain_cached.cache_info


@lru_cache(maxsize=4)
def _dem_top(target: str) -> float | None:
    """Highest elevation (m) in the DEM, read from a coarse copy of the whole file. None if it cannot be read."""
    try:
        with rasterio.Env(**_GDAL_ENV):
            with rasterio.open(target) as ds:
                f = max(1, math.ceil(max(ds.width, ds.height) / 512))
                z = ds.read(1, out_shape=(max(1, ds.height // f), max(1, ds.width // f))).astype("float64")
                if ds.nodata is not None and not np.isnan(ds.nodata):
                    z[z == ds.nodata] = np.nan
        return float(np.nanmax(z)) if np.isfinite(z).any() else None
    except Exception:
        return None


def _site(lat: float, lon: float) -> tuple[float, float]:
    lat = max(float(lat), -89.9999)  # exactly at the pole every direction is north; step 3 m off it
    lon = (float(lon) + 180.0) % 360.0 - 180.0
    return round(lat, 4), round(lon, 4)


# ---------------------------------------------------------------- disk cache
_CODE = Path(__file__).read_bytes()


def _settings_tag() -> str:
    """Changes when this file or any setting changes, so old cache files are never served for new settings."""
    settings = repr((OBSERVER_M, MAX_REACH_KM, COVERAGE_LAT, TIERS)).encode()
    return hashlib.sha1(_CODE + settings).hexdigest()[:8]


def _cache_file(kind: str, target: str, *key) -> Path:
    tag = target.rsplit("/", 1)[-1].replace(".", "_")
    return CACHE_DIR / f"{kind}_{tag}_{_settings_tag()}_{'_'.join(str(k) for k in key)}.json"


def _cache_get(path: Path, need: str):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) and need in value else None


def _cache_put(path: Path, value) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(value, separators=(",", ":")))
        os.replace(tmp, path)  # readers never see a half-written file
    except OSError:
        pass  # caching is a convenience, never a failure


# ---------------------------------------------------------------- skyline (the ray trace)
def _ray_distances(max_d: float, ratio: float = 1.003) -> np.ndarray:
    """1 m steps to 300 m (the eye is 2 m up, so near ground moves fast in angle), 5 m to 2 km, then +0.3 % a step."""
    g = [2000.0]
    while g[-1] * ratio < max_d:
        g.append(g[-1] * ratio)
    return np.concatenate([np.arange(1.0, 300.0, 1.0), np.arange(300.0, 2000.0, 5.0), np.array(g + [max_d])])


def _trace(t: _Terrain, observer_m: float, sub: int = 8, chunk: int = 96):
    """March `sub` rays per degree of azimuth out to MAX_REACH_KM.

    Per whole degree: mean, highest and lowest skyline of the rays in that degree, distance (km) of the terrain that
    sets the highest, how far (km) the rays had DEM under them, and, where the DEM ended before MAX_REACH_KM, the
    elevation (m) that ground just past the edge would need in order to rise above the skyline found (NaN elsewhere).
    """
    d = _ray_distances(MAX_REACH_KM * 1000.0)
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    az = (np.arange(360)[:, None] + offs[None, :]).reshape(-1)
    best, dist, seen = np.empty(az.size), np.empty(az.size), np.empty(az.size)
    for a in range(0, az.size, chunk):  # in pieces: the whole fan at once needs several hundred MB
        AZ, DD = np.meshgrid(az[a:a + chunk], d, indexing="ij")
        h = t.along(AZ, DD)
        gap = np.isnan(h)
        el = np.where(gap, -90.0, _elevation_angle(R + t.h0 + observer_m, h, DD))
        idx = el.argmax(axis=1)
        best[a:a + chunk] = el[np.arange(el.shape[0]), idx]
        dist[a:a + chunk] = d[idx]
        seen[a:a + chunk] = np.where(gap.any(axis=1), d[gap.argmax(axis=1)], d[-1])
    # A sight line leaving the eye at angle e is at radius r_eye * cos(e) / cos(e + s / R) after ground distance s.
    e, th = np.radians(best), seen / R
    need = np.where(seen < d[-1], (R + t.h0 + observer_m) * np.cos(e) / np.cos(e + th) - R, np.nan)
    best, dist, seen, need = (v.reshape(360, sub) for v in (best, dist, seen, need))
    j = best.argmax(axis=1)
    top, far = best[np.arange(360), j], dist[np.arange(360), j] / 1000.0
    with np.errstate(all="ignore"):
        need = np.where(np.isnan(need).all(axis=1), np.nan, np.nanmin(np.where(np.isnan(need), np.inf, need), axis=1))
    return best.mean(axis=1), top, best.min(axis=1), far, seen.min(axis=1) / 1000.0, need


def _synthetic_skyline(lat: float, lon: float, reason: str) -> dict:
    if polar_dem.covered(lat):
        az, hz = polar_dem.horizon_profile(round(lat, 4), round(lon, 4))
        elev = np.interp(np.arange(360), az, hz, period=360)
        source = "synthetic terrain model"
    else:
        elev = np.zeros(360)
        source = "flat horizon (no terrain data here)"
    return {"lat": lat, "lon": lon, "observer_m": OBSERVER_M, "elev_deg": np.round(elev, 3).tolist(),
            "dist_km": [None] * 360, "reach_km": MAX_REACH_KM, "synthetic": True, "source": source, "note": reason}


def skyline(lat: float, lon: float) -> dict:
    """360-degree ray-traced skyline at a site. Falls back to the synthetic model when the DEM cannot be used."""
    lat, lon = _site(lat, lon)
    target = dem_target()
    if target is None:
        return _synthetic_skyline(lat, lon, "No DEM is installed and network reads are turned off.")
    if lat > COVERAGE_LAT:
        return _synthetic_skyline(lat, lon, "The DEM covers 80 S to the pole only.")
    cache = _cache_file("skyline", target, lat, lon)
    hit = _cache_get(cache, "elev_deg")
    if hit:
        return hit
    try:
        t = _terrain(target, lat, lon)
        elev, top, low, dist, seen, need = _trace(t, OBSERVER_M)
    except Exception as exc:  # unreadable DEM, no network: degrade, never break the page
        return _synthetic_skyline(lat, lon, f"The DEM could not be read: {exc}")
    cut = np.isfinite(need)
    dem_top = _dem_top(target)
    note = None
    if cut.any():
        lowest = float(np.nanmin(need))
        note = (f"The terrain data ends {seen.min():.0f} km from the site at its nearest (it stops at 80 S). Ground "
                f"beyond the edge is not included in {int(cut.sum())} of 360 directions; it would have to stand above "
                f"{lowest:,.0f} m elevation to raise the skyline there.")
        if dem_top is not None:
            note += (f" The highest ground in the whole file is {dem_top:,.0f} m, so "
                     + ("this could matter here." if lowest < dem_top else "this is unlikely to matter here."))
    out = {"lat": lat, "lon": lon, "observer_m": OBSERVER_M, "elev_deg": np.round(elev, 3).tolist(),
           "elev_max_deg": np.round(top, 3).tolist(), "elev_min_deg": np.round(low, 3).tolist(),
           "dist_km": np.round(dist, 3).tolist(), "seen_km": np.round(seen, 1).tolist(),
           "edge_needs_m": [None if not np.isfinite(v) else round(float(v)) for v in need],
           "dem_top_m": None if dem_top is None else round(dem_top), "reach_km": MAX_REACH_KM,
           "synthetic": False, "source": _source_label(target), "site_elevation_m": round(t.h0, 1), "note": note}
    _cache_put(cache, out)
    return out


# ---------------------------------------------------------------- section (the slice)
def _synthetic_section(lat: float, lon: float, azimuth: float, length_km: float, reason: str) -> dict:
    size_km = max(2 * length_km, 2)
    grid, _ = terrain.load_elevation(lat, lon, size_km, 256)
    px = terrain.pixel_size_m(size_km, 256)
    df, ef = terrain.cross_section(grid, px, azimuth, length_km)
    db, eb = terrain.cross_section(grid, px, (azimuth + 180) % 360, length_km)
    x = [-v for v in db[:0:-1]] + list(df)
    e = list(eb[:0:-1]) + list(ef)
    z0 = ef[0]
    return {"azimuth": azimuth, "length_km": length_km, "x_m": [round(v, 1) for v in x],
            "z_m": [round(v - z0, 1) for v in e], "elevation_m": [round(v, 1) for v in e],
            "site_elevation_m": round(z0, 1), "curvature": False, "synthetic": True,
            "source": "synthetic terrain model", "note": reason}


def section(lat: float, lon: float, azimuth: float, length_km: float = 8.0) -> dict:
    """Ground along a slice through the site: `length_km` toward `azimuth` (positive x) and the same behind it.

    x_m  horizontal distance from the lander in its own frame.
    z_m  height above the lander's ground point with the Moon's curvature included, so a straight ray
         of light is a straight line when x_m and z_m are plotted at the same scale.
    """
    lat, lon = _site(lat, lon)
    azimuth = round(float(azimuth) % 360.0, 2) % 360.0
    length_km = round(float(min(max(length_km, 0.5), 150.0)), 2)
    target = dem_target()
    if target is None:
        return _synthetic_section(lat, lon, azimuth, length_km, "No DEM is installed and network reads are turned off.")
    if lat > COVERAGE_LAT:
        return _synthetic_section(lat, lon, azimuth, length_km, "The DEM covers 80 S to the pole only.")
    cache = _cache_file("section", target, lat, lon, azimuth, length_km)
    hit = _cache_get(cache, "x_m")
    if hit:
        return hit
    try:
        t = _terrain(target, lat, lon)
        n = int(min(600, max(100, round(length_km * 1000 / 20.0))))
        d = np.linspace(0.0, length_km * 1000.0, n + 1)
        hf = t.along(np.full(d.shape, azimuth), d)
        hb = t.along(np.full(d.shape, (azimuth + 180.0) % 360.0), d)
    except Exception as exc:
        return _synthetic_section(lat, lon, azimuth, length_km, f"The DEM could not be read: {exc}")
    dist = np.concatenate([-d[:0:-1], d])
    h = np.concatenate([hb[:0:-1], hf])
    keep = np.isfinite(h)  # beyond the DEM edge there is no ground to draw
    th = np.abs(dist) / R
    r1 = R + h
    x = np.sign(dist) * r1 * np.sin(th)
    z = r1 * np.cos(th) - (R + t.h0)
    out = {"azimuth": azimuth, "length_km": length_km, "x_m": np.round(x[keep], 1).tolist(),
           "z_m": np.round(z[keep], 1).tolist(), "elevation_m": np.round(h[keep], 1).tolist(),
           "site_elevation_m": round(t.h0, 1), "curvature": True, "synthetic": False,
           "source": _source_label(target), "note": None if keep.all() else "Part of this slice lies beyond the DEM."}
    _cache_put(cache, out)
    return out
