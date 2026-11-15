"""Ray-traced light along a slice, checked on made-up DEMs with known answers. Owner: LEAD."""
import math
from datetime import datetime, timezone

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.main import app
from app.services import ephemeris, sightline, slicelight, terrain

R = 1_737_400.0
WALL_Y, WALL_H = 5000.0, 300.0  # an east-west wall 5 km north of the pole, 300 m high, 200 m thick
START = datetime(2026, 11, 14, 6, tzinfo=timezone.utc)


def _install(grid, tmp_path, monkeypatch, px=20.0):
    """Write `grid` as a small polar DEM centred on the pole and point the app at it (as in test_sightline)."""
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
    sightline._dem_top.cache_clear()
    slicelight._clear_memory()


def _forget():
    sightline._terrain.cache_clear()
    sightline._dem_top.cache_clear()
    slicelight._clear_memory()


@pytest.fixture
def wall_dem(tmp_path, monkeypatch):
    """Flat ground at height 0 around the pole, with one straight wall. 40 km across, 20 m pixels."""
    n, px = 2000, 20.0
    y = (n / 2 - np.arange(n) - 0.5) * px  # pixel-centre northing along +y (the 0 E meridian)
    grid = np.zeros((n, n), dtype="float32")
    grid[(y >= WALL_Y) & (y <= WALL_Y + 200.0), :] = WALL_H
    _install(grid, tmp_path, monkeypatch)
    yield
    _forget()


@pytest.fixture
def flat_dem(tmp_path, monkeypatch):
    """Perfectly flat ground at height 0, 40 km across."""
    _install(np.zeros((2000, 2000), dtype="float32"), tmp_path, monkeypatch)
    yield
    _forget()


def _light(length_km, points, bodies, lat=-90.0, lon=0.0, azimuth=0.0, eye=2.0):
    return slicelight.light_for_directions(lat, lon, azimuth, length_km, eye, points, bodies)


def test_a_wall_shades_the_ground_behind_it_and_not_the_ground_in_front(wall_dem):
    """Slice due north from the pole, through the wall. One body is low in the north, the other low in the south
    (both 1 degree up at the lander). Behind the lander the slice is on the far side of the pole, where local
    north points the other way: reusing the lander's azimuth there would look away from the wall."""
    got = _light(8.0, 41, {"sun": ([1.0], [0.0]), "earth": ([1.0], [180.0])})
    x = np.array(got["x_m"])
    assert len(x) == 41 and x[0] == pytest.approx(-8000, abs=1) and x[-1] == pytest.approx(8000, abs=1)
    assert np.allclose(np.diff(x), 400.0, atol=0.5)  # x follows the ground height, as in sightline.section
    sun, earth = got["sun"][0], got["earth"][0]
    assert len(got["sun"]) == len(got["earth"]) == 1 and len(sun) == len(earth) == 41
    south_of_wall, north_of_wall = x < WALL_Y - 150.0, x > WALL_Y + 350.0
    assert south_of_wall.sum() == 33 and north_of_wall.sum() == 7
    for i in np.nonzero(south_of_wall)[0]:
        assert sun[i] == "0", f"x = {x[i]} m is in the wall's shadow when the body is low in the north"
        assert earth[i] == "1", f"x = {x[i]} m sees a body low in the south over flat ground"
    for i in np.nonzero(north_of_wall)[0]:
        assert sun[i] == "1", f"x = {x[i]} m is beyond the wall and sees a body low in the north"
        assert earth[i] == "0", f"x = {x[i]} m has the wall between it and a body low in the south"
    assert got["synthetic"] is False and "local file" in got["source"]
    assert got["sun_hours"] == [float(c) for c in sun] and got["earth_hours"] == [float(c) for c in earth]


def test_the_shadow_is_cast_by_terrain_off_the_slice(wall_dem):
    """An east-west slice 2 km south of the wall never touches it, yet a body low in the north is hidden from
    all of it and a body low in the south is seen from all of it. A test on the slice's own ground cannot know."""
    lat = -90.0 + 3000.0 / (R * math.radians(1.0))  # 3 km from the pole on the 0 E meridian: 2 km short of the wall
    got = _light(4.0, 21, {"sun": ([1.0, 1.0], [0.0, 180.0])}, lat=lat, lon=0.0, azimuth=90.0)
    assert got["sun"] == ["0" * 21, "1" * 21]
    assert got["sun_hours"] == [1.0] * 21


def test_flat_ground_is_lit_whenever_the_body_is_above_the_dip_of_the_horizon(flat_dem):
    """From 2 m above a smooth sphere the horizon is 0.087 degrees below level. Curvature is in the answer."""
    dip = -math.degrees(math.sqrt(2 * 2.0 / R))
    assert dip == pytest.approx(-0.087, abs=0.001)
    az = [0.0, 90.0, 180.0, 270.0, 33.0]
    up = _light(0.5, 21, {"sun": ([0.5] * 5, az), "earth": ([dip + 0.04] * 5, az)})
    assert up["sun"] == ["1" * 21] * 5 and up["earth"] == ["1" * 21] * 5
    assert up["sun_hours"] == [5.0] * 21
    down = _light(0.5, 21, {"sun": ([-1.0] * 5, az), "earth": ([dip - 0.04] * 5, az)})
    assert down["sun"] == ["0" * 21] * 5 and down["earth"] == ["0" * 21] * 5
    assert down["earth_hours"] == [0.0] * 21


def test_the_level_plane_tilts_along_the_slice(flat_dem):
    """A body exactly level at the lander, due north: 8 km north it is 0.26 degrees up (lit), 8 km south it is
    0.26 degrees down, below the 0.087 degree dip (hidden). Flat ground, so only the geometry decides."""
    got = _light(8.0, 21, {"sun": ([0.0], [0.0])})
    row, x = got["sun"][0], np.array(got["x_m"])
    tilt = np.degrees(x / R)
    assert got["sun_alt"][0] == pytest.approx(tilt, abs=1e-4)
    for i in range(21):
        assert row[i] == ("1" if tilt[i] > -0.087 else "0")
    assert row[0] == "0" and row[-1] == "1"


def test_x0_agrees_with_the_skyline_of_the_lander(wall_dem):
    """At x = 0 the answer must be the lander's own verdict from sightline.skyline (the panel shows both)."""
    lat, lon = -89.95, 30.0
    sky = sightline.skyline(lat, lon, 2.0)
    mean, lo, hi = (np.array(sky[k]) for k in ("elev_deg", "elev_min_deg", "elev_max_deg"))
    mine = slicelight.slice_skylines(lat, lon, 45.0, 1.0, 2.0, 21)
    assert mine["dist_m"][10] == 0.0 and mine["sky"].shape == (21, 360)
    smooth = (hi - lo) < 0.05  # where the skyline does not jump inside the degree (it does at the wall's two ends)
    assert smooth.sum() > 250  # the wall fills many directions from this close
    assert np.abs(mine["sky"][10] - mean)[smooth].max() < 0.05
    # a body 0.15 degrees above, then 0.15 degrees below, the lander's skyline in every smooth direction
    az = np.nonzero(smooth & np.roll(smooth, 1) & np.roll(smooth, -1))[0].astype(float)
    alt = np.concatenate([mean[az.astype(int)] + 0.15, mean[az.astype(int)] - 0.15])
    got = slicelight.light_for_directions(lat, lon, 45.0, 1.0, 2.0, 21, {"sun": (alt, np.concatenate([az, az]))})
    column = "".join(row[10] for row in got["sun"])
    assert column == "1" * len(az) + "0" * len(az)


def test_a_body_is_moved_to_each_point_with_vectors_not_small_angles():
    """Sun and Earth as seen 30 km from the lander, near the pole where local north turns quickly, against the
    ephemeris run at that point. No DEM is needed for this."""
    lat, lon = -89.45, -137.3
    plat, plon = (float(v) for v in sightline._destination(lat, lon, 67.5, 30_000.0))
    here = ephemeris.find_windows(lat, lon, START, 2.0, 60).series
    there = ephemeris.find_windows(plat, plon, START, 2.0, 60).series
    sun_m, earth_m = slicelight._distances([p.time for p in here])
    up, east, north = slicelight._frame(np.array([plat]), np.array([plon]))
    shift = R * up - R * slicelight._frame(lat, lon)[0][None, :]

    def worst(name, far):
        direction = slicelight._direction(lat, lon, [getattr(p, f"{name}_alt") for p in here],
                                          [getattr(p, f"{name}_az") for p in here])
        alt, az = slicelight._seen_from(up, east, north, shift, direction, far)
        d_alt = alt[:, 0] - np.array([getattr(p, f"{name}_alt") for p in there])
        d_az = (az[:, 0] - np.array([getattr(p, f"{name}_az") for p in there]) + 180.0) % 360.0 - 180.0
        return max(np.abs(d_alt).max(), np.abs(d_az).max())

    assert abs(here[0].sun_az - there[0].sun_az) > 20.0   # local north really is different there
    assert worst("sun", sun_m) < 1e-4
    assert worst("earth", earth_m) < 1e-4
    assert 0.002 < worst("earth", np.full(len(here), 1e30)) < 0.01  # without the Earth's distance: its parallax


def test_endpoint_matches_the_contract_and_the_ephemeris_time_grid(wall_dem):
    c = TestClient(app)
    q = {"lat": -90, "lon": 0, "azimuth": 0, "length_km": 2, "start": "2026-11-14T06:00:00Z", "days": 3,
         "step_min": 120, "observer_m": 2, "points": 21}
    r = c.get("/api/terrain/slice-light", params=q)
    assert r.status_code == 200, r.text
    got = r.json()
    windows = c.get("/api/ephemeris/windows", params={k: q[k] for k in ("lat", "lon", "start", "days", "step_min")}).json()
    assert got["times"] == [p["time"] for p in windows["series"]] and got["times"][0] == "2026-11-14T06:00:00Z"
    n_t = len(got["times"])
    assert n_t == 37 and len(got["sun"]) == len(got["earth"]) == n_t
    assert all(len(row) == 21 and set(row) <= {"0", "1"} for row in got["sun"] + got["earth"])
    assert len(got["x_m"]) == len(got["sun_hours"]) == len(got["earth_hours"]) == 21
    assert got["sun_hours"] == [2.0 * sum(row[i] == "1" for row in got["sun"]) for i in range(21)]
    assert got["synthetic"] is False and got["observer_m"] == 2.0 and got["azimuth"] == 0.0 and got["length_km"] == 2.0
    # x_m is the section's own x_m at the same ground distances
    section = np.array(sightline.section(-90, 0, 0, 2)["x_m"])
    assert all(np.abs(section - x).min() < 0.11 for x in got["x_m"])
    assert got["x_m"][10] == 0.0
    # the same question again is answered from memory, and gives the same thing
    assert c.get("/api/terrain/slice-light", params=q).json() == got


def test_long_time_series_are_thinned_exactly_as_the_ephemeris_does(flat_dem):
    c = TestClient(app)
    q = {"lat": -90, "lon": 0, "start": "2026-11-14T06:00:00", "days": 29.53, "step_min": 20}
    got = c.get("/api/terrain/slice-light", params={**q, "length_km": 0.5, "points": 21}).json()
    series = c.get("/api/ephemeris/windows", params=q).json()["series"]
    assert got["times"] == [p["time"] for p in series] and len(series) > 500
    assert got["sun_hours"][10] == pytest.approx(sum(row[10] == "1" for row in got["sun"]) * 80 / 60, abs=0.01)


def test_no_real_terrain_is_an_error_never_made_up_light(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "none")
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    monkeypatch.setattr(sightline, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setenv("LOLA_REMOTE", "0")
    slicelight._clear_memory()
    with pytest.raises(ValueError, match="No terrain data"):
        slicelight.slice_light(-89.5, 120, 0, 8, START, 2, 60, 2.0, 21)
    r = TestClient(app).get("/api/terrain/slice-light", params={"lat": -89.5, "lon": 120})
    assert r.status_code == 422 and "No terrain data" in r.json()["detail"]


def test_north_of_the_dem_is_an_error(wall_dem):
    with pytest.raises(ValueError, match="80 S"):
        slicelight.slice_light(-60, 10, 0, 8, START, 2, 60, 2.0, 21)
    assert TestClient(app).get("/api/terrain/slice-light", params={"lat": -60, "lon": 10}).status_code == 422


def test_an_unreadable_file_is_an_error(tmp_path, monkeypatch):
    dem_dir = tmp_path / "dem"
    dem_dir.mkdir()
    (dem_dir / "broken.tiff").write_bytes(b"this is not a GeoTIFF")
    monkeypatch.setattr(terrain, "DEM_DIR", dem_dir)
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    monkeypatch.setattr(sightline, "CACHE_DIR", tmp_path / "cache")
    slicelight._clear_memory()
    with pytest.raises(ValueError, match="could not be read"):
        slicelight.slice_light(-89.5, 120, 0, 8, START, 2, 60, 2.0, 21)
    r = TestClient(app).get("/api/terrain/slice-light", params={"lat": -89.5, "lon": 120})
    assert r.status_code == 422 and "could not be read" in r.json()["detail"]


def test_points_beyond_the_dem_are_not_lit_and_the_note_says_so(flat_dem):
    """The made-up DEM is 40 km across: a 30 km slice from the pole runs 10 km past its edge at both ends."""
    got = _light(30.0, 31, {"sun": ([0.5], [90.0])})
    row, x = got["sun"][0], np.array(got["x_m"])
    assert all(row[i] == "0" for i in np.nonzero(np.abs(x) > 20_100)[0])
    assert all(row[i] == "1" for i in np.nonzero(np.abs(x) < 19_900)[0])
    assert "beyond the terrain data" in got["note"]


def test_the_note_warns_when_ground_past_the_edge_could_hide_the_body(wall_dem):
    """A body 0.2 degrees up in the east is in view over flat ground, but the data ends 20 km away, where ground
    under 150 m high (the file has 300 m) would cover it. A body 5 degrees up cannot be covered: no warning."""
    low = _light(1.0, 21, {"sun": ([0.2], [90.0])})
    assert low["sun"] == ["1" * 21] and "stops at 80 S" in low["note"] and "the Sun in 21" in low["note"]
    high = _light(1.0, 21, {"sun": ([5.0], [90.0])})
    assert high["sun"] == ["1" * 21] and high["note"] is None


def test_cache_holds_the_skylines_under_every_parameter_that_changes_them(wall_dem, monkeypatch):
    args = (-89.95, 30.0, 45.0, 1.0, 2.0, 21)
    first = slicelight.slice_skylines(*args)
    files = sorted(sightline.CACHE_DIR.glob("slicesky_*.json"))
    assert len(files) == 1
    slicelight._clear_memory()                               # read back from disk: the same numbers
    again = slicelight.slice_skylines(*args)
    assert np.allclose(again["sky"], first["sky"], atol=0.0006) and np.array_equal(again["x_m"], first["x_m"])
    files[0].write_text("[1, 2, 3]")                         # a damaged file is ignored and replaced
    slicelight._clear_memory()
    assert np.allclose(slicelight.slice_skylines(*args)["sky"], first["sky"], atol=0.0006)
    for changed in [(-89.95, 30.0, 67.5, 1.0, 2.0, 21), (-89.95, 30.0, 45.0, 2.0, 2.0, 21),
                    (-89.95, 30.0, 45.0, 1.0, 5.0, 21), (-89.95, 30.0, 45.0, 1.0, 2.0, 31), (-89.9, 30.0, 45.0, 1.0, 2.0, 21)]:
        slicelight.slice_skylines(*changed)
    assert len(list(sightline.CACHE_DIR.glob("slicesky_*.json"))) == 6
    taller = slicelight.slice_skylines(-89.95, 30.0, 45.0, 1.0, 5.0, 21)
    assert taller["sky"][10][200] < first["sky"][10][200]    # from higher up the flat horizon dips further
    monkeypatch.setattr(slicelight, "RAYS_PER_DEG", 1)       # a different setting never reuses the old answer
    slicelight._clear_memory()
    slicelight.slice_skylines(*args)
    assert len(list(sightline.CACHE_DIR.glob("slicesky_*.json"))) == 7


def test_long_slices_keep_fine_data_beside_every_point(tmp_path, monkeypatch):
    """Slices over 35 km read coarser data in bulk and a strip of 20 m data along the slice. A 3 m ridge 50 m east
    of a point 45 km from the lander must still stand above that point's level (as in test_sightline's bump)."""
    n, px = 5000, 20.0                                        # 100 km across
    xs = (np.arange(n) + 0.5 - n / 2) * px
    grid = np.zeros((n, n), dtype="float32")
    grid[:, np.isclose(xs, 50.0)] = 3.0                       # a low north-south ridge 50 m east of the 0 E meridian
    _install(grid, tmp_path, monkeypatch)
    try:
        s = slicelight.slice_skylines(-90.0, 0.0, 0.0, 45.0, 2.0, 21)   # north along the 0 E meridian
        assert s["finest_m"] == 20.0 and len(slicelight._tiers(45.0)) == 4
        crest = math.degrees(math.atan2(3.0 - 2.0, 50.0))
        for i in (11, 15, 19):                                # 4.5, 22.5 and 40.5 km north of the lander
            assert s["sky"][i][90] == pytest.approx(crest, abs=0.05)
            assert s["sky"][i][270] < 0
    finally:
        _forget()
