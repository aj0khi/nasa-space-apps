import base64
from datetime import datetime, timezone

import numpy as np

from app.services import illumination, terrain


def test_solar_direction_moves_shadows_across_dem(monkeypatch, tmp_path):
    path = tmp_path / "dem.tif"
    path.touch()
    monkeypatch.setattr(terrain, "_dem_path", lambda: path)

    def ridge(half_km, res, identity):
        grid = np.zeros((res, res), dtype=np.float32)
        grid[:, res // 2] = 2000
        return grid

    def body(when, name):
        return np.array([1 if when.hour == 0 else -1, 0, 0]), 0.0, 0.0

    def sun_geometry(s, lat, lon):
        return np.full_like(lat, np.radians(1)), np.full_like(lat, s[0]), np.zeros_like(lat)

    monkeypatch.setattr(illumination, "_lola_grid", ridge)
    monkeypatch.setattr(illumination, "body_direction", body)
    monkeypatch.setattr(illumination, "_sun_geometry", sun_geometry)
    illumination._polar_illumination.cache_clear()
    east = illumination.polar_illumination(datetime(2026, 1, 1, 0, tzinfo=timezone.utc), -84, 64)
    west = illumination.polar_illumination(datetime(2026, 1, 1, 1, tzinfo=timezone.utc), -84, 64)
    a = np.frombuffer(base64.b64decode(east["data"]), dtype=np.uint8).reshape(64, 64)
    b = np.frombuffer(base64.b64decode(west["data"]), dtype=np.uint8).reshape(64, 64)
    assert not east["synthetic"]
    assert a[32, 30] != 255 and not a[32, 30] & 128
    assert b[32, 30] != 255 and b[32, 30] & 128
    assert a[32, 34] != 255 and a[32, 34] & 128
    assert b[32, 34] != 255 and not b[32, 34] & 128


def test_missing_dem_along_ray_is_unknown(monkeypatch, tmp_path):
    path = tmp_path / "dem.tif"
    path.touch()
    monkeypatch.setattr(terrain, "_dem_path", lambda: path)

    def partial(half_km, res, identity):
        grid = np.zeros((res, res), dtype=np.float32)
        grid[:, res // 2 + 5:] = np.nan
        return grid

    monkeypatch.setattr(illumination, "_lola_grid", partial)
    monkeypatch.setattr(illumination, "body_direction", lambda when, name: (np.array([1, 0, 0]), 0.0, 0.0))
    monkeypatch.setattr(illumination, "_sun_geometry",
                        lambda s, lat, lon: (np.full_like(lat, np.radians(1)), np.ones_like(lat), np.zeros_like(lat)))
    illumination._polar_illumination.cache_clear()
    result = illumination.polar_illumination(datetime(2026, 1, 1, tzinfo=timezone.utc), -84, 64)
    data = np.frombuffer(base64.b64decode(result["data"]), dtype=np.uint8).reshape(64, 64)
    assert data[32, 32] == 255
    assert result["coverage_fraction"] < 1
