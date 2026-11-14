"""
Lunar Landing Site Navigator — Backend API Server (`main.py`)

Exposes REST API endpoints:
- GET /api/health
- GET /api/sites?date=2026-11-14T12:00:00Z&min_duration_days=3.0
- GET /api/sites/{site_id}?date=2026-11-14T12:00:00Z&min_duration_days=3.0
- GET /api/compare?site_a=A&date_a=...&site_b=C&date_b=...
- GET /api/horizons-validate?site_id=A&date=2026-11-14T12:00:00Z

Also serves the frontend UI from `../frontend/index.html` at `http://localhost:8000/`
Works out-of-the-box with standard Python (`python3 backend/main.py`) OR via FastAPI (`uvicorn main:app --reload`).
"""

from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

from ephemeris import parse_iso_utc, query_jpl_horizons_live
from evaluator import (
    compare_scenarios,
    evaluate_all_sites,
    evaluate_site_details,
    get_terrain_db,
)


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def handle_api_route(path: str, query: Dict[str, list[str]]) -> tuple[int, Dict[str, Any]]:
    """Routes API requests and returns `(status_code, json_dict)`."""
    def q_str(key: str, default: str | None = None) -> str | None:
        vals = query.get(key)
        return vals[0] if vals else default

    def q_float(key: str, default: float) -> float:
        val = q_str(key)
        if val is None:
            return default
        try:
            return float(val)
        except ValueError:
            return default

    if path == "/api/health":
        db = get_terrain_db()
        return 200, {
            "status": "ok",
            "service": "Lunar Landing Site Navigator API",
            "dataset": db["dataset"],
            "sites_loaded": list(db["sites"].keys()),
        }

    if path == "/api/sites":
        date_str = q_str("date")
        min_days = q_float("min_duration_days", 3.0)
        return 200, evaluate_all_sites(date_str=date_str, min_duration_days=min_days)

    match_site = re.match(r"^/api/sites/([A-Za-z0-9_-]+)(?:/details)?$", path)
    if match_site:
        site_id = match_site.group(1)
        date_str = q_str("date")
        min_days = q_float("min_duration_days", 3.0)
        try:
            return 200, evaluate_site_details(
                site_id=site_id, date_str=date_str, min_duration_days=min_days
            )
        except KeyError as exc:
            return 404, {"error": str(exc)}

    if path == "/api/compare":
        site_a = q_str("site_a", "A") or "A"
        date_a = q_str("date_a")
        site_b = q_str("site_b", "C") or "C"
        date_b = q_str("date_b") or date_a
        min_days = q_float("min_duration_days", 3.0)
        try:
            return 200, compare_scenarios(site_a, date_a, site_b, date_b, min_days)
        except KeyError as exc:
            return 404, {"error": str(exc)}

    if path == "/api/horizons-validate":
        site_id = (q_str("site_id", "A") or "A").upper()
        date_str = q_str("date")
        dt = parse_iso_utc(date_str)
        db = get_terrain_db()
        if site_id not in db["sites"]:
            return 404, {"error": f"Unknown site_id '{site_id}'"}
        site = db["sites"][site_id]
        coords = site["coordinates"]
        local_eval = evaluate_site_details(site_id, date_str)
        horizons_sun = query_jpl_horizons_live(
            coords["lat"], coords["lon"], coords["elevation_m"], dt, target="10"
        )
        return 200, {
            "site_id": site_id,
            "site_name": site["name"],
            "timestamp_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "local_ephemeris": local_eval["ephemeris"],
            "nasa_jpl_horizons": horizons_sun,
        }

    return 404, {"error": f"Unknown endpoint '{path}'"}


try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse

    app = FastAPI(
        title="Lunar Landing Site Navigator API",
        description="2026 NASA Space Apps Challenge Backend — Ephemeris & LOLA Terrain Evaluator",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def api_health() -> Dict[str, Any]:
        _, data = handle_api_route("/api/health", {})
        return data

    @app.get("/api/sites")
    def api_sites(
        date: str | None = Query(default=None, description="ISO-8601 UTC timestamp"),
        min_duration_days: float = Query(default=3.0),
    ) -> Dict[str, Any]:
        return evaluate_all_sites(date_str=date, min_duration_days=min_duration_days)

    @app.get("/api/sites/{site_id}")
    @app.get("/api/sites/{site_id}/details")
    def api_site_details(
        site_id: str,
        date: str | None = Query(default=None),
        min_duration_days: float = Query(default=3.0),
    ) -> Dict[str, Any]:
        try:
            return evaluate_site_details(site_id, date_str=date, min_duration_days=min_duration_days)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    @app.get("/api/compare")
    def api_compare(
        site_a: str = Query(default="A"),
        date_a: str | None = Query(default=None),
        site_b: str = Query(default="C"),
        date_b: str | None = Query(default=None),
        min_duration_days: float = Query(default=3.0),
    ) -> Dict[str, Any]:
        try:
            return compare_scenarios(site_a, date_a, site_b, date_b or date_a, min_duration_days)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

    @app.get("/api/horizons-validate")
    def api_horizons(
        site_id: str = Query(default="A"),
        date: str | None = Query(default=None),
    ) -> Dict[str, Any]:
        code, data = handle_api_route(
            "/api/horizons-validate",
            {"site_id": [site_id], "date": [date] if date else []},
        )
        if code != 200:
            raise HTTPException(status_code=code, detail=data.get("error"))
        return data

    @app.get("/")
    def serve_root() -> Any:
        index_file = FRONTEND_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"message": "Lunar Landing Site Navigator API running. Visit /api/sites"}

except ImportError:
    app = None  # type: ignore[assignment]


class NavigatorHTTPRequestHandler(BaseHTTPRequestHandler):
    """Zero-dependency HTTP handler for `/api/*` and static frontend files."""

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            status_code, payload = handle_api_route(path, query)
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path in ("/", "/index.html"):
            index_file = FRONTEND_DIR / "index.html"
            if index_file.exists():
                content = index_file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error": "Not found"}')

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[API] {self.address_string()} - {format % args}")


def run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    get_terrain_db()
    server = ThreadingHTTPServer((host, port), NavigatorHTTPRequestHandler)
    print(f"Lunar Landing Site Navigator Backend running on http://localhost:{port}")
    print(f"  - All Sites (A-H):  http://localhost:{port}/api/sites?date=2026-11-16T18:00:00Z")
    print(f"  - Site A Details:   http://localhost:{port}/api/sites/A?date=2026-11-16T18:00:00Z")
    print(f"  - Compare A vs C:   http://localhost:{port}/api/compare?site_a=A&site_b=C&date_a=2026-11-16T18:00:00Z")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()


if __name__ == "__main__":
    run_server()

