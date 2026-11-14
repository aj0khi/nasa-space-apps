"""A–H landing-site evaluation (GO / CAUTION / NO-GO) from the team's engine in /backend.

Owner of the engine: Diego (backend/evaluator.py, backend/ephemeris.py). This router only
mounts it inside the main API, at exactly the paths documented in system_arch.md, so the
frontend talks to one server. `python backend/main.py` still runs the engine on its own.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

ENGINE_DIR = Path(__file__).resolve().parents[4] / "backend"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from ephemeris import get_ephemeris_source, parse_iso_utc, query_jpl_horizons_live  # noqa: E402, F401
from evaluator import (  # noqa: E402
    compare_scenarios,
    evaluate_all_sites,
    evaluate_site_details,
    get_terrain_db,
)

router = APIRouter(tags=["A–H evaluation (system_arch.md)"])


@router.get("/sites")
def sites(
    date: str | None = Query(default=None, description="ISO-8601 UTC; use 6-hour-aligned times to hit the NASA cache"),
    min_duration_days: float = Query(default=3.0, gt=0, le=30),
) -> dict[str, Any]:
    """All candidate sites A–H with live GO / CAUTION / NO-GO status."""
    return evaluate_all_sites(date_str=date, min_duration_days=min_duration_days)


@router.get("/sites/{site_id}")
def site_details(
    site_id: str,
    date: str | None = Query(default=None),
    min_duration_days: float = Query(default=3.0, gt=0, le=30),
) -> dict[str, Any]:
    """Full inspection data for one site: window, resources, cautions, horizon mask, A–A′ slice."""
    try:
        return evaluate_site_details(site_id, date_str=date, min_duration_days=min_duration_days)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/compare")
def compare(
    site_a: str = Query(default="A"),
    date_a: str | None = Query(default=None),
    site_b: str = Query(default="C"),
    date_b: str | None = Query(default=None),
    min_duration_days: float = Query(default=3.0, gt=0, le=30),
) -> dict[str, Any]:
    """Two scenarios side by side: another site, or the same site on another date."""
    try:
        return compare_scenarios(site_a, date_a, site_b, date_b or date_a, min_duration_days)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/horizons-validate")
def horizons_validate(site_id: str = Query(default="A"), date: str | None = Query(default=None)) -> dict[str, Any]:
    """Cross-check the local Sun position against NASA's live JPL Horizons service."""
    db = get_terrain_db()
    key = site_id.strip().upper()
    if key not in db["sites"]:
        raise HTTPException(status_code=404, detail=f"Unknown site_id '{site_id}'")
    site = db["sites"][key]
    c = site["coordinates"]
    dt = parse_iso_utc(date)
    local = evaluate_site_details(key, date)
    return {
        "site_id": key,
        "site_name": site["name"],
        "timestamp_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "local_ephemeris": local["ephemeris"],
        "nasa_jpl_horizons": query_jpl_horizons_live(c["lat"], c["lon"], c["elevation_m"], dt, target="10"),
    }
