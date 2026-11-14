"""Shared test setup.

Most tests pin the terrain to the synthetic model so they give the same answers whether or not the
NASA LOLA DEM has been downloaded. Tests that need the real data use the `real_dem` fixture and are
skipped when the file isn't there.
"""
import os

os.environ["LUNAR_SYNTHETIC_TERRAIN"] = "1"  # read by polar_dem at import time

import pytest  # noqa: E402

from app.services import illumination, polar_dem  # noqa: E402


def _reset(force_synthetic: bool) -> None:
    polar_dem.set_force_synthetic(force_synthetic)
    illumination._polar_illumination.cache_clear()


@pytest.fixture
def real_dem():
    _reset(False)
    if not polar_dem.real_dem_available():
        _reset(True)
        pytest.skip("NASA LOLA DEM not downloaded (python scripts/get_lola_dem.py)")
    yield
    _reset(True)
