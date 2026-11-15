import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.main import app
from app.services import terrain


@pytest.fixture
def dem(tmp_path, monkeypatch):
    dem_dir = tmp_path / "dem"
    dem_dir.mkdir()
    path = dem_dir / "elevation.tiff"
    x = np.arange(256) * 20 - 2550
    y = 2550 - np.arange(256) * 20
    grid = (1000 + x[None, :] + 2 * y[:, None]).astype("float32")
    with rasterio.open(
        path, "w", driver="GTiff", width=256, height=256, count=1, dtype="float32",
        crs="+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs",
        transform=from_origin(-2560, 2560, 20, 20), nodata=np.nan,
    ) as dst:
        dst.write(grid, 1)
    monkeypatch.setattr(terrain, "DEM_DIR", dem_dir)
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    return path


def test_real_dem_preserves_local_directions(dem):
    grid, synthetic = terrain.load_elevation(-90, 0, size_km=0.4, res=5)

    assert not synthetic
    assert grid[2, 2] == pytest.approx(1000, abs=1)
    assert grid[0, 2] == pytest.approx(1400, abs=1)
    assert grid[2, 4] == pytest.approx(1200, abs=1)


def test_dem_missing_coverage_is_not_filled_with_synthetic_data(dem):
    with pytest.raises(ValueError, match="beyond available DEM coverage"):
        terrain.load_elevation(-90, 0, size_km=10, res=16)

    response = TestClient(app).get(
        "/api/terrain/elevation", params={"lat": -90, "lon": 0, "size_km": 10, "res": 16}
    )
    assert response.status_code == 422


def test_terrain_api_reports_dem_source(dem):
    client = TestClient(app)
    params = {"lat": -90, "lon": 0, "size_km": 2, "res": 16}
    elevation = client.get("/api/terrain/elevation", params=params)
    assert elevation.status_code == 200
    assert elevation.json()["synthetic"] is False
    assert np.ptp(elevation.json()["grid"]) > 0

    shadow = client.get("/api/terrain/shadow", params={**params, "sun_alt": 5, "sun_az": 90})
    assert shadow.status_code == 200
    assert shadow.json()["synthetic"] is False

    profile = client.post(
        "/api/terrain/cross-section",
        json={"lat": -90, "lon": 0, "lines": [{"azimuth": 0, "length_km": 1}]},
    )
    assert profile.status_code == 200
    assert profile.json()["synthetic"] is False
    assert profile.json()["profiles"][0]["elevation_m"][-1] > 1000

    outside = client.get("/api/terrain/elevation", params={**params, "lat": 0})
    assert outside.status_code == 200
    assert outside.json()["synthetic"] is True


def test_missing_dem_keeps_synthetic_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "missing")
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "missing.tiff")

    grid, synthetic = terrain.load_elevation(-89, 0, size_km=2, res=16)
    assert synthetic
    assert np.isfinite(grid).all()
