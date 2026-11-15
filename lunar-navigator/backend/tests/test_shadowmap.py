"""Per-pixel horizon map (shadow-map), checked on made-up DEMs with known answers. Owner: LEAD."""
import base64
import math

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.main import app
from app.services import shadowmap, sightline, terrain

R = 1_737_400.0
WALL_Y, WALL_H, WALL_W = 5000.0, 300.0, 1000.0  # an east-west wall 5 km north of the site, 300 m high, 1 km thick
# (rays step 2 % of the distance at a time, so they cannot step over anything that wide within this map)
WALL_TOP_Y = WALL_Y + 10.0      # between pixel centres the height ramps, so the full height starts here
SIZE, RES = 16.0, 33            # 485 m pixels; odd, so pixel (16, 16) is the site itself
MID = RES // 2
DIP = math.degrees(math.sqrt(2 * 2.0 / R))  # horizon dip for an eye 2 m above a smooth sphere


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
    return dem_dir / "made_up.tiff"


@pytest.fixture
def wall_dem(tmp_path, monkeypatch):
    """Flat ground at height 0 around the pole, with one straight wall. 40 km across, 20 m pixels."""
    n, px = 2000, 20.0
    y = (n / 2 - np.arange(n) - 0.5) * px  # pixel-centre northing along +y (the 0 E meridian)
    grid = np.zeros((n, n), dtype="float32")
    grid[(y >= WALL_Y) & (y <= WALL_Y + WALL_W), :] = WALL_H
    yield _install(grid, tmp_path, monkeypatch)
    sightline._terrain.cache_clear()


@pytest.fixture
def flat_dem(tmp_path, monkeypatch):
    yield _install(np.zeros((2000, 2000), dtype="float32"), tmp_path, monkeypatch)
    sightline._terrain.cache_clear()


@pytest.fixture
def bump_dem(tmp_path, monkeypatch):
    """Flat ground with one raised column of pixels 50 m east of the site: the height ramps 0 -> 3 m -> 0."""
    n, px = 600, 20.0
    x = (np.arange(n) + 0.5 - n / 2) * px
    grid = np.zeros((n, n), dtype="float32")
    grid[:, np.isclose(x, 50.0)] = 3.0
    yield _install(grid, tmp_path, monkeypatch)
    sightline._terrain.cache_clear()


def exact(size=SIZE, res=RES, lat=-90.0, lon=0.0, eye=2.0):
    """The response and the horizon before it is rounded into bytes, shape (res, res, 72)."""
    la, lo = sightline._site(lat, lon)
    out, info = shadowmap._build(sightline.dem_target(), la, lo, size, res, eye)
    return out, info["alt_deg"].reshape(res, res, -1)


def northing(row, size=SIZE, res=RES):
    return (res / 2 - row - 0.5) * size * 1000.0 / res


def lit(m, alt, az):
    """Exactly what the client does: interpolate the packed horizon between the two neighbouring directions."""
    hz = shadowmap.decode(m)
    a = (az % 360.0) / m["az_step_deg"]
    k0 = int(math.floor(a)) % hz.shape[2]
    k1 = (k0 + 1) % hz.shape[2]
    return alt > hz[:, :, k0] + (hz[:, :, k1] - hz[:, :, k0]) * (a - math.floor(a))


def wall_threshold(y):
    """Lander-frame altitude a body due north must exceed to clear the wall, seen from 2 m up at northing y.
    Written independently of the module: rise over run minus the curvature drop gives the angle above the pixel's
    own level; that level is tilted against the lander's by y / R."""
    s = WALL_TOP_Y - y
    return math.degrees(math.atan((WALL_H - 2.0 - s * s / (2 * R)) / s) - y / R)


def test_wall_shadow_falls_behind_the_wall_and_not_in_front(wall_dem):
    m = shadowmap.shadow_map(-90, 0, SIZE, RES, 2.0)
    assert m["synthetic"] is False and m["res"] == RES and m["size_km"] == SIZE and "local file" in m["source"]
    sun = lit(m, 2.0, 0.0)  # a body 2 degrees up, due north (beyond the wall)
    rows = np.arange(RES)
    y = northing(rows)
    front = y > WALL_Y + WALL_W + 250.0            # between the wall and the body
    behind = (y < WALL_Y - 50.0) & (y > -2500.0)   # within the 8.4 km shadow of a 300 m wall under a 2 degree body
    beyond = y < -4500.0                           # past the end of the shadow
    assert front.sum() >= 4 and behind.sum() >= 14 and beyond.sum() >= 6
    assert sun[front].all()        # every column: the site is at the pole, so "north" differs wildly per pixel
    assert not sun[behind].any()
    assert sun[beyond].all()
    # with the body in the south the shadow falls on the other side: north of the wall, and nowhere south of it
    south = lit(m, 2.0, 180.0)
    assert south[y < WALL_Y - 50.0].all() and not south[front].any()
    assert lit(m, 30.0, 0.0)[(y < 4000.0) | front].all()  # a high body lights all but the foot of the wall
    # and the same wall hides a body to the north-east only as far as its lower apparent height there
    assert not lit(m, 1.0, 47.5)[behind].any()


def test_wall_horizon_has_the_right_angle_in_the_landers_frame(wall_dem):
    _, hz = exact()
    for row in (8, 12, MID, 20, 24, 30):  # centre column: 1.1 km to 12 km behind the wall
        want = wall_threshold(northing(row))
        # a ray's last step before the cliff can fall 2 % short of it, which lowers the angle by up to 2 %
        assert want - 0.03 - 0.022 * want <= hz[row, MID, 0] <= want + 0.03
    # east and west of the centre line the answer is the same: the body's rays are parallel
    assert np.ptp(hz[MID, :, 0]) < 0.01
    # looking away from the wall: only the curve of the Moon, tilted by the pixel's own distance
    assert hz[MID, MID, 36] == pytest.approx(-DIP, abs=0.01)


def test_flat_ground_is_lit_for_a_body_above_the_level_plane(flat_dem):
    m, hz = exact()
    for az in (0.0, 37.5, 90.0, 181.0, 270.0, 359.0):
        assert lit(m, 1.0, az).all()        # 1 degree up: more than the 0.37 degree tilt across this map
        assert not lit(m, -1.0, az).any()   # below the level plane by more than the tilt: hidden by the Moon itself
    # Known answer for the tilt of "level": a pixel y metres north of the lander sees the northern horizon lower
    # by y / R in the lander's frame, and the southern horizon higher by the same amount.
    for row in (0, 8, 24, 32):
        tilt = math.degrees(northing(row) / R)
        assert hz[row, MID, 0] == pytest.approx(-DIP - tilt, abs=0.005)
        assert hz[row, MID, 36] == pytest.approx(-DIP + tilt, abs=0.005)
    east = (RES - 1 - MID) * SIZE * 1000.0 / RES  # the east edge, looking east and west
    assert hz[MID, RES - 1, 18] == pytest.approx(-DIP - math.degrees(east / R), abs=0.005)
    assert hz[MID, RES - 1, 54] == pytest.approx(-DIP + math.degrees(east / R), abs=0.005)
    assert np.allclose(np.array(m["elevation_m"]), 0.0, atol=0.05)


def test_packed_horizon_decodes_to_the_traced_angles(wall_dem):
    m, hz = exact()
    raw = np.frombuffer(base64.b64decode(m["horizon_b64"]), dtype=np.uint8)
    assert raw.size == RES * RES * 72 and m["az_step_deg"] == 5.0
    assert m["horizon_scale"] == 0.25 and m["horizon_offset"] == -16.0
    assert len(m["elevation_m"]) == RES * RES
    got = raw.reshape(RES, RES, 72) * m["horizon_scale"] + m["horizon_offset"]
    assert np.array_equal(got, shadowmap.decode(m))
    clipped = np.clip(hz, -16.0, 47.75)   # the byte holds -16 .. 47.75 in steps of 0.25
    assert np.abs(got - clipped).max() <= 0.125 + 1e-9
    # pixel-major, then azimuth: row 12 of the centre column, direction 0, is the wall seen from there
    j = (12 * RES + MID) * 72
    assert raw[j] * 0.25 - 16.0 == pytest.approx(wall_threshold(northing(12)), abs=0.3)
    # elevation is row-major with row 0 at the north edge: only rows 4 and 5 (5.3 and 5.8 km north) are on the wall
    elev = np.array(m["elevation_m"]).reshape(RES, RES)
    assert np.allclose(elev[[4, 5]], WALL_H, atol=0.05) and np.allclose(np.delete(elev, [4, 5], axis=0), 0.0, atol=0.05)


def test_elevation_layout_north_is_row_zero_and_east_is_the_last_column(tmp_path, monkeypatch):
    """Ground that rises toward +y (north along 0 E) and, more gently, toward +x (east at a site on 0 E)."""
    n, px = 1200, 20.0
    y = (n / 2 - np.arange(n) - 0.5) * px
    x = (np.arange(n) + 0.5 - n / 2) * px
    _install((0.05 * y[:, None] + 0.01 * x[None, :]).astype("float32"), tmp_path, monkeypatch)
    m = shadowmap.shadow_map(-89.9, 0, 4.0, 33, 2.0)  # 3 km from the pole on the 0 E meridian: north is +y, east is +x
    elev = np.array(m["elevation_m"]).reshape(33, 33)
    step = 4000.0 / 33
    assert elev[0, 16] - elev[32, 16] == pytest.approx(0.05 * 32 * step, rel=0.01)   # north edge is higher
    assert elev[16, 32] - elev[16, 0] == pytest.approx(0.01 * 32 * step, rel=0.02)   # east edge is higher
    sightline._terrain.cache_clear()


def test_centre_pixel_agrees_with_the_skyline(wall_dem):
    m, hz = exact()
    sky = np.array(sightline.skyline(-90, 0)["elev_deg"])[::5]
    assert np.abs(hz[MID, MID] - sky).max() < 0.12                      # as traced (coarser steps along each ray)
    assert np.abs(shadowmap.decode(m)[MID, MID] - sky).max() < 0.25     # after rounding into a byte
    assert hz[MID, MID, 0] == pytest.approx(math.degrees((WALL_H - 2.0 - WALL_TOP_Y ** 2 / (2 * R)) / WALL_TOP_Y), abs=0.12)


def test_ground_beside_the_eye_is_not_stepped_over(bump_dem):
    """A 3 m rise 50 m east stands above the level of an eye 2 m up; steps of 20 m would miss its crest."""
    _, hz = exact(size=2.0, res=33)
    assert hz[16, 16, 18] == pytest.approx(math.degrees(math.atan2(1.0, 50.0)), abs=0.04)
    assert hz[16, 16, 54] == pytest.approx(-DIP, abs=0.01)  # nothing to the west
    _, tall = exact(size=2.0, res=33, eye=10.0)  # from 10 m up the same rise is below level
    assert tall[16, 16, 18] < 0


def test_pixels_outside_the_dem_are_blank_and_noted(flat_dem):
    """The made-up DEM is 40 km across. A 16 km map centred 15 km from the pole runs off its edge."""
    m = shadowmap.shadow_map(-89.5, 0, SIZE, RES, 2.0)
    elev = np.array(m["elevation_m"]).reshape(RES, RES)
    hz = shadowmap.decode(m)
    gone = elev == shadowmap.NODATA_M
    assert 0.1 < gone.mean() < 0.5 and gone[0].all() and not gone[MID:].any()   # the north edge is outside
    assert (hz[gone] == 47.75).all()                  # byte 255: never shown as lit
    assert m["note"] and "left blank" in m["note"]
    assert lit(m, 1.0, 180.0)[~gone].all()            # where there is ground, it still works


def test_no_terrain_is_an_error_not_a_made_up_map(tmp_path, monkeypatch, wall_dem):
    with pytest.raises(ValueError, match="80 S"):
        shadowmap.shadow_map(-60, 10, SIZE, RES, 2.0)
    c = TestClient(app)
    r = c.get("/api/terrain/shadow-map", params={"lat": -60, "lon": 10})
    assert r.status_code == 422 and "80 S" in r.json()["detail"]
    wall_dem.write_bytes(b"not a GeoTIFF at all")   # an unreadable file
    r = c.get("/api/terrain/shadow-map", params={"lat": -90, "lon": 0, "size_km": 4, "res": 32})
    assert r.status_code == 422 and "could not be read" in r.json()["detail"]
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "none")   # no DEM and no network
    monkeypatch.setenv("LOLA_REMOTE", "0")
    with pytest.raises(ValueError, match="No terrain file"):
        shadowmap.shadow_map(-89.5, 120, SIZE, RES, 2.0)
    assert c.get("/api/terrain/shadow-map", params={"lat": -89.5, "lon": 120}).status_code == 422


def test_endpoint_and_cache(wall_dem, monkeypatch):
    c = TestClient(app)
    r = c.get("/api/terrain/shadow-map", params={"lat": -90, "lon": 0, "size_km": 8, "res": 33, "observer_m": 2})
    assert r.status_code == 200
    m = r.json()
    assert m["res"] == 33 and m["size_km"] == 8 and m["observer_m"] == 2 and m["synthetic"] is False
    assert len(base64.b64decode(m["horizon_b64"])) == 33 * 33 * 72
    files = list(sightline.CACHE_DIR.glob("shadowmap_*.json"))
    assert len(files) == 1
    with monkeypatch.context() as mp:
        mp.setattr(shadowmap, "_build", lambda *a: pytest.fail("the second request must come from the cache"))
        assert c.get("/api/terrain/shadow-map", params={"lat": -90, "lon": 0, "size_km": 8, "res": 33}).json() == m
    # every parameter is in the key: another size, resolution or eye height is another file
    shadowmap.shadow_map(-90, 0, 8.0, 32, 2.0)
    shadowmap.shadow_map(-90, 0, 6.0, 33, 2.0)
    taller = shadowmap.shadow_map(-90, 0, 8.0, 33, 10.0)
    assert len(list(sightline.CACHE_DIR.glob("shadowmap_*.json"))) == 4
    assert taller["observer_m"] == 10.0
    assert shadowmap.decode(taller)[16, 16, 36] <= shadowmap.decode(m)[16, 16, 36]  # from higher up the horizon dips more
    assert c.get("/api/terrain/shadow-map", params={"lat": -90, "lon": 0, "size_km": 500}).status_code == 422
    assert c.get("/api/terrain/shadow-map", params={"lat": -90, "lon": 0, "res": 1000}).status_code == 422
