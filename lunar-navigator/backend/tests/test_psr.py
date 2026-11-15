import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from app.main import app
from app.services import terrain

POLAR = "+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs"


@pytest.fixture
def psr(tmp_path, monkeypatch):
    """A 5.12 km PSR map centred on the pole: the west half (x < 0) is permanently shadowed."""
    psr_dir = tmp_path / "dem" / "psr"
    psr_dir.mkdir(parents=True)
    path = psr_dir / "psr.tif"
    x = np.arange(256) * 20 - 2550
    grid = np.broadcast_to((x < 0).astype("float32")[None, :], (256, 256)).copy()
    with rasterio.open(path, "w", driver="GTiff", width=256, height=256, count=1, dtype="float32",
                       crs=POLAR, transform=from_origin(-2560, 2560, 20, 20), nodata=np.nan) as dst:
        dst.write(grid, 1)
    monkeypatch.setattr(terrain, "PSR_DIR", psr_dir)
    return path


def test_psr_grid_matches_source(psr):
    # at the pole looking along 0° longitude, map x (90°E) is local east → the west half of the grid is PSR
    grid = terrain.load_psr(-90, 0, size_km=2, res=21)
    assert grid.shape == (21, 21)
    assert grid[:, :8].min() == pytest.approx(1.0)
    assert grid[:, -8:].max() == pytest.approx(0.0)


def test_psr_endpoint(psr):
    body = TestClient(app).get("/api/terrain/psr", params={"lat": -90, "lon": 0, "size_km": 2, "res": 21}).json()
    assert body["available"] is True
    assert 0.4 < body["psr_fraction"] < 0.6
    assert len(body["mask"]) == 21


def test_psr_unavailable_without_source(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "PSR_DIR", tmp_path / "missing")
    body = TestClient(app).get("/api/terrain/psr", params={"lat": -89, "lon": 0}).json()
    assert body == {"available": False, "mask": None, "psr_fraction": None, "source": None}


def test_psr_north_of_coverage_is_unavailable(psr):
    assert terrain.load_psr(-75, 0, size_km=2, res=21) is None


def test_remote_dem_path_used_when_no_local_file(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "none")
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "none.tiff")
    monkeypatch.setattr(terrain, "REMOTE_DEM", "https://example.invalid/dem.tif")
    assert terrain._dem_path() == "/vsicurl/https://example.invalid/dem.tif"
    assert terrain.dem_identity(terrain._dem_path()) == ("/vsicurl/https://example.invalid/dem.tif", 0, 0)
