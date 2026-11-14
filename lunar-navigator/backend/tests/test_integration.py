"""The merged server: A–H engine (/backend) + map/terrain API (/lunar-navigator) behind one app.

Network is switched off (NASA JPL Horizons is not called) so these tests are deterministic; the
engine then uses the offline JPL DE421 ephemeris, which matches live Horizons to ~0.01°.
"""
from datetime import datetime, timezone

import pytest
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.routers import evaluation  # noqa: F401  (puts /backend on sys.path)
from app.services import ephemeris as ours
from app.services import site_terrain, terrain

import ephemeris as engine_ephemeris  # the /backend engine

client = TestClient(app)
WHEN = "2026-11-16T18:00:00Z"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    engine_ephemeris._HORIZONS_SUBPOINTS_CACHE.clear()
    monkeypatch.setattr(engine_ephemeris, "prefetch_horizons_window", lambda *a, **k: False)
    monkeypatch.setattr("evaluator.prefetch_horizons_window", lambda *a, **k: False)


def test_health_reports_both_engines():
    h = client.get("/api/health").json()
    assert h["ok"] and h["evaluation_sites"] == list("ABCDEFGH")


def test_all_sites_contract():
    r = client.get("/api/sites", params={"date": WHEN})
    assert r.status_code == 200
    d = r.json()
    assert [s["id"] for s in d["sites"]] == list("ABCDEFGH")
    for s in d["sites"]:
        assert s["status"] in {"GO", "CAUTION", "NO_GO"}
        assert s["badge"] in {"✓", "✗"}
        assert {"lat", "lon", "elevation_m"} <= s["coordinates"].keys()
        assert isinstance(s["is_sunlit"], bool) and isinstance(s["has_earth_comm"], bool)
        assert s["resources"] and s["cautions"]
    assert d["summary"]["total_sites"] == 8
    assert d["summary"]["recommended_backup_site"] in "ABCDEFGH"


def test_site_details_contract():
    d = client.get("/api/sites/a", params={"date": WHEN, "min_duration_days": 5}).json()  # lower-case id works
    assert d["id"] == "A"
    assert len(d["window"]["timeline_6h"]) == 121
    assert len(d["horizon_angles_deg"]) == 360
    assert {"window_label", "window_start_utc", "window_end_utc", "sunlit_pct_30d", "dte_comm_pct_30d"} <= d["window"].keys()
    assert client.get("/api/sites/Z").status_code == 404


def test_compare_contract():
    d = client.get("/api/compare", params={"site_a": "A", "date_a": WHEN, "site_b": "C", "date_b": "2026-11-24T18:00:00Z"}).json()
    assert d["recommended"]["scenario"] in (1, 2)
    assert d["scenario_1"]["id"] == "A" and d["scenario_2"]["id"] == "C"


def test_catalog_did_not_shadow_evaluation_routes():
    # /api/sites must be the A–H evaluation (system_arch.md), not the old catalog list
    assert isinstance(client.get("/api/sites", params={"date": WHEN}).json(), dict)
    assert isinstance(client.get("/api/catalog").json(), list)


def test_engine_and_map_agree_on_the_sun():
    """The GO/NO-GO engine and the shadow map must describe the same sky."""
    when = datetime(2026, 11, 16, 18, tzinfo=timezone.utc)
    for s in client.get("/api/sites", params={"date": WHEN}).json()["sites"]:
        c = s["coordinates"]
        lon = ((c["lon"] + 180) % 360) - 180
        e = engine_ephemeris.compute_sun_and_earth_angles(c["lat"], lon, when, elevation_m=0)
        o = ours.sun_earth_state(c["lat"], lon, when)
        assert abs(e["sun"]["elevation_deg"] - o.sun.altitude) < 0.05, s["id"]
        assert abs(((e["sun"]["azimuth_deg"] - o.sun.azimuth + 180) % 360) - 180) < 0.2, s["id"]
        assert abs(e["earth"]["elevation_deg"] - o.earth.altitude) < 0.05, s["id"]


def test_site_evaluation_uses_shared_dem(monkeypatch, tmp_path):
    dem = tmp_path / "dem.tif"
    dem.touch()
    grid = np.full((501, 501), 1000.0, dtype=np.float32)
    grid[:, 280:] = 1800.0
    monkeypatch.setattr(terrain, "_dem_path", lambda: dem)
    monkeypatch.setattr(terrain, "load_elevation", lambda *args: (grid, False))
    site_terrain._site_grid.cache_clear()

    response = client.get("/api/sites/A", params={"date": WHEN})
    assert response.status_code == 200
    data = response.json()
    assert data["terrain_source"] == "LOLA"
    assert data["horizon_limit_km"] == 50
    assert data["coordinates"]["elevation_m"] == 1000
    assert data["horizon_angles_deg"][90] > data["horizon_angles_deg"][0] + 5
    assert data["cross_section_aa"]["pad_elevation_m"] == 1000
    assert data["cross_section_aa"]["profile_points"][20]["in_shadow"] is not data["visibility"]["is_sunlit"]
    assert all("unverified" not in item.lower() for item in data["resources"])
    assert any("unverified" in item.lower() for item in data["cautions"])


def test_site_evaluation_reports_missing_dem_and_coverage(monkeypatch, tmp_path):
    monkeypatch.setattr(terrain, "_dem_path", lambda: None)
    result = client.get("/api/sites/A", params={"date": WHEN})
    assert result.status_code == 200
    assert result.json()["terrain_source"] == "synthetic"
    assert result.json()["horizon_limit_km"] is None

    dem = tmp_path / "dem.tif"
    dem.touch()
    monkeypatch.setattr(terrain, "_dem_path", lambda: dem)

    def missing_coverage(*args):
        raise ValueError("Missing DEM coverage")

    monkeypatch.setattr(terrain, "load_elevation", missing_coverage)
    site_terrain._site_grid.cache_clear()
    result = client.get("/api/sites/A", params={"date": WHEN})
    assert result.status_code == 422
    assert result.json()["detail"] == "Missing DEM coverage"
