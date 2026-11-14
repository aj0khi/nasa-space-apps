"""Catalog of other notable landing sites (Apollo, Chang'e, CLPS…). Data owner: GEO (app/data/sites.json).

The A–H south-pole candidates live in /backend (served at /api/sites by routers/evaluation.py)."""
import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.models import Site

router = APIRouter(tags=["catalog"])
SITES_FILE = Path(__file__).resolve().parents[1] / "data" / "sites.json"


@lru_cache(maxsize=1)
def all_sites() -> list[Site]:
    return [Site(**s) for s in json.loads(SITES_FILE.read_text())]


@router.get("/catalog", response_model=list[Site])
def list_sites():
    return all_sites()


@router.get("/catalog/{site_id}", response_model=Site)
def get_site(site_id: str):
    for s in all_sites():
        if s.id == site_id:
            return s
    raise HTTPException(404, f"Unknown site {site_id}")
