"""Run: cd backend && pytest -q"""
from datetime import datetime, timezone

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import ephemeris, terrain

client = TestClient(app)


def test_catalog_load():
    r = client.get("/api/catalog")
    assert r.status_code == 200 and len(r.json()) >= 5


def test_apollo11_low_morning_sun():
    # Apollo 11 landed 1969-07-20 20:17 UTC in lunar morning. Sun was ~10° up in the east.
    s = ephemeris.sun_earth_state(0.674, 23.473, datetime(1969, 7, 20, 20, 17, tzinfo=timezone.utc))
    assert 5 < s.sun.altitude < 16
    assert 60 < s.sun.azimuth < 120
    assert s.earth.altitude > 40  # near side, Earth high in the sky


def test_far_side_never_sees_earth():
    w = ephemeris.find_windows(-45.457, 177.588, datetime(2025, 1, 1, tzinfo=timezone.utc), days=30, step_min=120)
    assert w.earth_visible_fraction == 0


def test_lunar_seasons_small_tilt():
    s = ephemeris.lunar_seasons(datetime(2026, 1, 1, tzinfo=timezone.utc))
    keys = {x.key for x in s}
    assert {"south_summer", "south_winter"} <= keys
    for x in s:
        assert abs(x.subsolar_lat) < 1.7  # Moon's axis tilt is ~1.54°


def test_shadow_crater_floor_dark_at_low_sun():
    grid, _ = terrain.load_elevation(0, 0, 20, 64)
    m = terrain.shadow_mask(grid, terrain.pixel_size_m(20, 64), sun_alt=2, sun_az=90)
    assert m.mean() < 0.9 and m.max() == 1


SOUTH_SUMMER = datetime(2026, 11, 14, tzinfo=timezone.utc)


def test_shackleton_floor_is_permanently_shadowed():
    # deep crater floor at the pole: the 4 km walls hide a Sun that never rises more than ~1.5°
    w = ephemeris.find_windows(-89.67, 129.78, SOUTH_SUMMER, days=30, step_min=120)
    assert w.terrain_horizon and w.sunlit_fraction == 0


def test_malapert_summit_gets_lots_of_sun():
    flat = ephemeris.find_windows(-86.0, 0.0, SOUTH_SUMMER, days=30, step_min=120)
    assert flat.sunlit_fraction > 0.4


def test_polar_illumination_map():
    from app.services import illumination
    import base64
    a = illumination.polar_illumination(SOUTH_SUMMER, -84, 128)
    raw = base64.b64decode(a["data"])
    assert len(raw) == 128 * 128
    assert 0.05 < a["lit_fraction"] < 0.95  # some ground lit, some in shadow
    assert abs(a["sun"]["elevation_at_pole"]) < 1.7


def test_cross_section_shape():
    grid, _ = terrain.load_elevation(0, 0, 20, 64)
    d, e = terrain.cross_section(grid, terrain.pixel_size_m(20, 64), 0, 5)
    assert len(d) == len(e) == 200 and np.isfinite(e).all()


def test_rims_only_where_there_are_ridges():
    px = terrain.pixel_size_m(20, 128)
    flat, _ = terrain.load_elevation(-82.01, 70.98, 20, 128)      # open plain between craters
    assert terrain.rim_mask(flat, px).sum() == 0
    crater, _ = terrain.load_elevation(-89.67, 129.78, 20, 128)   # Shackleton: rim ring inside the tile
    m = terrain.rim_mask(crater, px)
    assert m.sum() > 300
    assert m[:3, :].sum() == m[-3:, :].sum() == m[:, :3].sum() == m[:, -3:].sum() == 0  # no tile-edge artefacts
