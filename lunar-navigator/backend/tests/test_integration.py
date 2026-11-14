"""The merged server: A–H engine (/backend) + map/terrain API (/lunar-navigator) behind one app.

Network is switched off (NASA JPL Horizons is not called) so these tests are deterministic; the
engine then uses the offline JPL DE421 ephemeris, which matches live Horizons to ~0.01°.
"""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import evaluation  # noqa: F401  (puts /backend on sys.path)
from app.services import ephemeris as ours

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
