"""
Automated verification tests for the Lunar Landing Site Navigator Backend.
"""

from __future__ import annotations
from main import handle_api_route


def run_tests() -> None:
    print("=== 1. Testing GET /api/sites (Nov 16, 2026 18:00 UTC) ===")
    code, res = handle_api_route("/api/sites", {"date": ["2026-11-16T18:00:00Z"]})
    assert code == 200
    print(f"Viable Sites: {res['summary']['viable_sites_count']} / {res['summary']['total_sites']}")
    print(f"Recommended Backup: Site {res['summary']['recommended_backup_site']} ({res['summary']['recommended_backup_name']})")
    for s in res["sites"]:
        print(
            f"  [{s['id']} {s['badge']}] {s['name']:28s} | {s['status']:7s} | "
            f"Sun: {s['sun_elevation_deg']:+5.2f}° (Mask: {s['sun_horizon_deg']:+5.2f}°) | "
            f"Earth: {s['earth_elevation_deg']:+5.2f}° | Window: {s['window_label']}"
        )

    print("\n=== 2. Testing GET /api/sites/A (Selected Site + Cross-Section A-A') ===")
    code_a, detail_a = handle_api_route("/api/sites/A", {"date": ["2026-11-16T18:00:00Z"]})
    assert code_a == 200
    print("Site A Status:", detail_a["status"], detail_a["badge"])
    print("Window:", detail_a["window"]["window_label"])
    print("Resources:", detail_a["resources"])
    print("Cautions:", detail_a["cautions"])
    print(
        f"Cross-Section A-A': {len(detail_a['cross_section_aa']['profile_points'])} points | "
        f"{detail_a['cross_section_aa']['section_label']}"
    )

    print("\n=== 3. Testing GET /api/compare (What if launch slips by 8 days?) ===")
    code_cmp, cmp_res = handle_api_route(
        "/api/compare",
        {
            "site_a": ["A"],
            "date_a": ["2026-11-16T18:00:00Z"],
            "site_b": ["C"],
            "date_b": ["2026-11-24T18:00:00Z"],
        },
    )
    assert code_cmp == 200
    print("Recommended Scenario:", cmp_res["recommended"])
    print("\nAll backend tests passed!")


if __name__ == "__main__":
    run_tests()

