"""Checks against NASA's real LOLA south-pole elevation data. Skipped if it hasn't been downloaded."""
from datetime import datetime, timezone

import numpy as np

from app.services import ephemeris, illumination, polar_dem, terrain


def test_dem_orientation_matches_known_craters(real_dem):
    # every named crater centre must be a deep hole compared with its rim (catches flipped/rotated reads)
    for c in polar_dem.features()["craters"]:
        x, y = polar_dem.project(c["lat"], c["lon"])
        r = c["diameter_km"] / 2
        a = np.linspace(0, 2 * np.pi, 36, endpoint=False)
        centre = polar_dem.elevation_m(np.array([x]), np.array([y]), res_km=0.32)[0]
        rim = polar_dem.elevation_m(x + r * np.cos(a), y + r * np.sin(a), res_km=0.32).mean()
        assert centre < rim - 500, c["name"]


def test_tiles_report_real_data(real_dem):
    _, synthetic = terrain.load_elevation(-89.45, -138.0, 20, 64)
    assert synthetic is False
    _, synthetic = terrain.load_elevation(-75.0, 0.0, 20, 64)  # north of LOLA coverage → model
    assert synthetic is True


def test_shackleton_floor_never_sees_the_sun(real_dem):
    w = ephemeris.find_windows(-89.67, 129.78, datetime(2026, 11, 14, tzinfo=timezone.utc), days=30, step_min=120)
    assert w.sunlit_fraction == 0


def test_real_shadow_map(real_dem):
    a = illumination.polar_illumination(datetime(2026, 11, 14, 18, tzinfo=timezone.utc), -84, 128)
    assert a["synthetic"] is False and 0.05 < a["lit_fraction"] < 0.95
