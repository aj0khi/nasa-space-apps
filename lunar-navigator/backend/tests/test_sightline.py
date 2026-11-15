"""Ray-traced skyline and terrain slices, checked on a made-up DEM with a wall of known height. Owner: LEAD."""
import math

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.main import app
from app.services import sightline, terrain

R = 1_737_400.0
WALL_Y, WALL_H = 5000.0, 300.0  # an east-west wall 5 km north of the site, 300 m high, 200 m thick


def _install(grid, tmp_path, monkeypatch, px=20.0):
    """Write `grid` as a small polar DEM centred on the pole and point the app at it."""
    n = grid.shape[0]
    dem_dir = tmp_path / "dem"
    dem_dir.mkdir()
    with rasterio.open(
        dem_dir / "made_up.tiff", "w", driver="GTiff", width=n, height=n, count=1, dtype="float32",
        crs="+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs",
        transform=from_origin(-n / 2 * px, n / 2 * px, px, px), nodata=np.nan,
    ) as dst:
        dst.write(grid, 1)
    monkeypatch.setattr(terrain, "DEM_DIR", dem_dir)
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    monkeypatch.setattr(sightline, "CACHE_DIR", tmp_path / "cache")
    sightline._terrain.cache_clear()


@pytest.fixture
def wall_dem(tmp_path, monkeypatch):
    """Flat ground at height 0 around the pole, with one straight wall. 40 km across, 20 m pixels."""
    n, px = 2000, 20.0
    y = (n / 2 - np.arange(n) - 0.5) * px  # pixel-centre northing along +y (the 0 E meridian)
    grid = np.zeros((n, n), dtype="float32")
    grid[(y >= WALL_Y) & (y <= WALL_Y + 200.0), :] = WALL_H
    _install(grid, tmp_path, monkeypatch)
    yield
    sightline._terrain.cache_clear()


BUMP_X, BUMP_H = 50.0, 3.0  # a low north-south ridge whose crest is 50 m east of the site, 3 m high


@pytest.fixture
def bump_dem(tmp_path, monkeypatch):
    """Flat ground with one raised column of pixels: between pixel centres the height ramps 0 -> 3 m -> 0."""
    n, px = 600, 20.0
    x = (np.arange(n) + 0.5 - n / 2) * px  # pixel-centre easting along +x (the 90 E meridian)
    grid = np.zeros((n, n), dtype="float32")
    grid[:, np.isclose(x, BUMP_X)] = BUMP_H
    _install(grid, tmp_path, monkeypatch)
    yield
    sightline._terrain.cache_clear()


def expected_angle(height_above_eye: float, d: float) -> float:
    """Small-angle form, written independently of the module: rise over run, minus the curvature drop."""
    return math.degrees((height_above_eye - d * d / (2 * R)) / d)


def test_skyline_sees_the_wall_at_the_right_angle(wall_dem):
    sky = sightline.skyline(-90, 0)
    assert not sky["synthetic"] and len(sky["elev_deg"]) == 360
    # due north: the wall face is 5 km away
    assert sky["elev_deg"][0] == pytest.approx(expected_angle(WALL_H - 2, WALL_Y), abs=0.06)
    assert sky["dist_km"][0] == pytest.approx(5.0, abs=0.25)
    # at 45 degrees the same wall is farther away, so it looks lower
    assert sky["elev_deg"][45] == pytest.approx(expected_angle(WALL_H - 2, WALL_Y / math.cos(math.radians(45))), abs=0.06)
    assert sky["elev_deg"][45] < sky["elev_deg"][0]


def test_skyline_over_flat_ground_dips_below_horizontal(wall_dem):
    sky = sightline.skyline(-90, 0)
    dip = -math.degrees(math.sqrt(2 * 2.0 / R))  # horizon dip for an eye 2 m above a smooth sphere
    for az in (90, 180, 270):
        assert sky["elev_deg"][az] == pytest.approx(dip, abs=0.02)


def test_section_follows_the_ground_and_the_curvature(wall_dem):
    s = sightline.section(-90, 0, azimuth=0, length_km=8)
    x, z, e = np.array(s["x_m"]), np.array(s["z_m"]), np.array(s["elevation_m"])
    assert not s["synthetic"] and s["curvature"]
    assert x[0] == pytest.approx(-8000, abs=5) and x[-1] == pytest.approx(8000, abs=5)
    assert e[np.argmin(np.abs(x - 5100))] == pytest.approx(WALL_H, abs=1)   # on the wall, toward the azimuth
    assert e[np.argmin(np.abs(x + 5100))] == pytest.approx(0, abs=1)        # nothing behind the site
    i = np.argmin(np.abs(x - 4000))
    assert z[i] == pytest.approx(-(x[i] ** 2) / (2 * R), abs=0.3)           # flat ground sinks by d^2 / 2R


def test_endpoints(wall_dem):
    c = TestClient(app)
    sky = c.get("/api/terrain/skyline", params={"lat": -90, "lon": 0}).json()
    assert len(sky["elev_deg"]) == 360 and sky["synthetic"] is False and "local file" in sky["source"]
    sec = c.get("/api/terrain/section", params={"lat": -90, "lon": 0, "azimuth": 0, "length_km": 6}).json()
    assert len(sec["x_m"]) == len(sec["z_m"]) == len(sec["elevation_m"]) and sec["synthetic"] is False
    assert c.get("/api/terrain/section", params={"lat": -90, "lon": 0, "length_km": 500}).status_code == 422


def test_falls_back_to_synthetic_without_a_dem(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "none")
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    monkeypatch.setenv("LOLA_REMOTE", "0")
    sky = sightline.skyline(-89.5, 120)
    assert sky["synthetic"] and len(sky["elev_deg"]) == 360
    sec = sightline.section(-89.5, 120, 30, 8)
    assert sec["synthetic"] and len(sec["x_m"]) == len(sec["z_m"])


def test_outside_the_dem_is_marked_synthetic(wall_dem):
    assert sightline.skyline(-60, 10)["synthetic"]
    assert sightline.section(-60, 10, 0, 8)["synthetic"]



def test_ground_close_to_the_lander_is_not_stepped_over(bump_dem):
    """The eye is 2 m up, so a 3 m rise 50 m away stands above horizontal. Rays stepping 20 m would land on
    its two shoulders (1.5 m high at 40 m and 60 m) and report it below horizontal."""
    sky = sightline.skyline(-90, 0)
    crest = math.degrees(math.atan2(BUMP_H - 2.0, BUMP_X))
    assert crest > 1.0
    assert sky["elev_deg"][90] == pytest.approx(crest, abs=0.03)
    assert sky["dist_km"][90] == pytest.approx(BUMP_X / 1000.0, abs=0.006)
    assert sky["elev_deg"][270] < 0  # nothing to the west


def test_degree_summaries_are_ordered(wall_dem):
    sky = sightline.skyline(-90, 0)
    lo, mid, hi = (np.array(sky[k]) for k in ("elev_min_deg", "elev_deg", "elev_max_deg"))
    assert len(lo) == len(hi) == 360
    assert np.all(lo <= mid + 1e-9) and np.all(mid <= hi + 1e-9)


def test_the_edge_of_the_dem_is_reported(wall_dem):
    """The made-up DEM is 40 km across, so every ray runs out of data long before 250 km."""
    sky = sightline.skyline(-90, 0)
    seen = sky["seen_km"]
    assert seen[90] == pytest.approx(20.0, abs=0.5)
    assert seen[135] == pytest.approx(20.0 * math.sqrt(2), abs=0.6)
    assert max(seen) < sky["reach_km"]
    assert sky["note"] and "terrain data ends" in sky["note"]


def test_cache_is_keyed_by_settings_and_checked(wall_dem, monkeypatch):
    first = sightline.skyline(-90, 0)
    files = list(sightline.CACHE_DIR.glob("skyline_*.json"))
    assert len(files) == 1
    files[0].write_text("[1, 2, 3]")                      # a damaged cache file is ignored and replaced
    assert sightline.skyline(-90, 0) == first
    monkeypatch.setattr(sightline, "OBSERVER_M", 10.0)    # a different setting never reuses the old answer
    taller = sightline.skyline(-90, 0)
    assert taller["observer_m"] == 10.0
    assert taller["elev_deg"][90] < first["elev_deg"][90]  # from higher up the flat horizon dips further


def test_bad_azimuth_is_rejected(wall_dem):
    c = TestClient(app)
    assert c.get("/api/terrain/section", params={"lat": -90, "lon": 0, "azimuth": "nan"}).status_code == 422
    assert c.get("/api/terrain/section", params={"lat": -90, "lon": 0, "azimuth": 720}).status_code == 422
