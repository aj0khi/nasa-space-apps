"""
Lunar Landing Site Evaluation Engine (`evaluator.py`)

Combines static LOLA topographic data (`sites_terrain.json`) with dynamic
Sun/Earth ephemeris (`ephemeris.py`) to compute:
- Live Go (✓) / No-Go (✗) status for Sites A-H
- Viable landing & sunlit window (start date, end date, remaining days)
- Available Resources & Automated Engineering Cautions
- Conceptual A-A' 2D Terrain Cross-Section sliced along the active Sun azimuth ray
- Side-by-side scenario comparison
"""

from __future__ import annotations
from datetime import datetime, timedelta
import json
import math
from pathlib import Path
from typing import Any, Dict, List

from ephemeris import (
    compute_sun_and_earth_angles,
    get_ephemeris_source,
    parse_iso_utc,
    prefetch_horizons_window,
)
from preprocess_terrain import generate_terrain_data


DATA_PATH = Path(__file__).resolve().parent / "data" / "sites_terrain.json"
_TERRAIN_CACHE: Dict[str, Any] | None = None


def get_terrain_db() -> Dict[str, Any]:
    """Loads `sites_terrain.json` into memory (generating it on first run if needed)."""
    global _TERRAIN_CACHE
    if _TERRAIN_CACHE is not None:
        return _TERRAIN_CACHE

    if not DATA_PATH.exists():
        DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = generate_terrain_data()
        DATA_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        _TERRAIN_CACHE = data
    else:
        _TERRAIN_CACHE = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return _TERRAIN_CACHE


def check_instant_visibility(site: Dict[str, Any], dt: datetime) -> Dict[str, Any]:
    """
    Computes whether the Sun and Earth are unobstructed by surrounding crater rims/ridges
    at a single timestamp `dt`.
    """
    coords = site["coordinates"]
    ephem = compute_sun_and_earth_angles(
        coords["lat"], coords["lon"], dt, elevation_m=float(coords.get("elevation_m", 0.0))
    )
    horizon_360 = site["horizon_angles_deg"]

    sun_az = ephem["sun"]["azimuth_deg"]
    sun_alt = ephem["sun"]["elevation_deg"]
    sun_az_idx = int(round(sun_az)) % 360
    sun_horizon_deg = horizon_360[sun_az_idx]
    sun_margin_deg = round(sun_alt - sun_horizon_deg, 3)
    is_sunlit = sun_margin_deg > -0.15

    earth_az = ephem["earth"]["azimuth_deg"]
    earth_alt = ephem["earth"]["elevation_deg"]
    earth_az_idx = int(round(earth_az)) % 360
    earth_horizon_deg = horizon_360[earth_az_idx]
    earth_margin_deg = round(earth_alt - earth_horizon_deg, 3)
    has_earth_comm = earth_margin_deg > 0.0

    return {
        "ephemeris": ephem,
        "sun_horizon_deg": sun_horizon_deg,
        "sun_margin_deg": sun_margin_deg,
        "is_sunlit": is_sunlit,
        "earth_horizon_deg": earth_horizon_deg,
        "earth_margin_deg": earth_margin_deg,
        "has_earth_comm": has_earth_comm,
    }


def compute_viable_window(
    site: Dict[str, Any], target_dt: datetime, scan_days: int = 15, step_hours: int = 6
) -> Dict[str, Any]:
    """
    Scans backward and forward (`-scan_days` to `+scan_days`) around `target_dt`
    to find the continuous sunlit mission window (`window: Date Range` in wireframe)
    as well as 30-day illumination & DTE communication statistics.
    """
    steps_half = int((scan_days * 24) / step_hours)
    timeline: List[Dict[str, Any]] = []

    for idx in range(-steps_half, steps_half + 1):
        dt_step = target_dt + timedelta(hours=idx * step_hours)
        vis = check_instant_visibility(site, dt_step)
        timeline.append(
            {
                "offset_hours": idx * step_hours,
                "timestamp_utc": dt_step.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "date_label": dt_step.strftime("%b %d %H:%M"),
                "is_sunlit": vis["is_sunlit"],
                "has_earth_comm": vis["has_earth_comm"],
                "sun_alt_deg": vis["ephemeris"]["sun"]["elevation_deg"],
                "sun_horizon_deg": vis["sun_horizon_deg"],
                "sun_margin_deg": vis["sun_margin_deg"],
                "earth_alt_deg": vis["ephemeris"]["earth"]["elevation_deg"],
            }
        )

    center_idx = steps_half
    currently_sunlit = timeline[center_idx]["is_sunlit"]

    if currently_sunlit:
        start_idx = center_idx
        while start_idx > 0 and timeline[start_idx - 1]["is_sunlit"]:
            start_idx -= 1
        end_idx = center_idx
        while end_idx < len(timeline) - 1 and timeline[end_idx + 1]["is_sunlit"]:
            end_idx += 1

        start_dt = target_dt + timedelta(hours=(start_idx - center_idx) * step_hours)
        end_dt = target_dt + timedelta(hours=(end_idx - center_idx) * step_hours)
        remaining_days = round(((end_idx - center_idx) * step_hours) / 24.0, 1)
        total_window_days = round(((end_idx - start_idx) * step_hours) / 24.0, 1)
        next_sunrise_dt = None
        hours_until_sunlight = 0.0
    else:
        next_idx = center_idx
        while next_idx < len(timeline) and not timeline[next_idx]["is_sunlit"]:
            next_idx += 1
        if next_idx < len(timeline):
            end_next = next_idx
            while end_next < len(timeline) - 1 and timeline[end_next + 1]["is_sunlit"]:
                end_next += 1
            start_dt = target_dt + timedelta(hours=(next_idx - center_idx) * step_hours)
            end_dt = target_dt + timedelta(hours=(end_next - center_idx) * step_hours)
            hours_until_sunlight = round((next_idx - center_idx) * step_hours, 1)
            next_sunrise_dt = start_dt.strftime("%Y-%m-%d %H:%M UTC")
            remaining_days = 0.0
            total_window_days = round(((end_next - next_idx) * step_hours) / 24.0, 1)
        else:
            start_dt = target_dt
            end_dt = target_dt
            remaining_days = 0.0
            total_window_days = 0.0
            hours_until_sunlight = float(scan_days * 24)
            next_sunrise_dt = "Beyond +15d scan"

    sunlit_count = sum(1 for item in timeline if item["is_sunlit"])
    comm_count = sum(1 for item in timeline if item["has_earth_comm"])
    sunlit_pct_30d = round((sunlit_count / len(timeline)) * 100.0, 1)
    dte_comm_pct_30d = round((comm_count / len(timeline)) * 100.0, 1)

    return {
        "currently_sunlit": currently_sunlit,
        "window_start_utc": start_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "window_end_utc": end_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "window_label": (
            f"{start_dt.strftime('%b %d')} – {end_dt.strftime('%b %d, %Y')} ({remaining_days}d left)"
            if currently_sunlit
            else f"IN SHADOW (Next light: {next_sunrise_dt})"
        ),
        "remaining_sunlit_days": remaining_days,
        "total_window_days": total_window_days,
        "hours_until_sunlight": hours_until_sunlight,
        "sunlit_pct_30d": sunlit_pct_30d,
        "dte_comm_pct_30d": dte_comm_pct_30d,
        "timeline_6h": timeline,
    }


def generate_cross_section_aa(
    site: Dict[str, Any], sun_az_deg: float, sun_alt_deg: float, sun_horizon_deg: float
) -> Dict[str, Any]:
    """
    Generates the 2D conceptual Terrain Cross-Section (`A — A'`) from the user's sketch!
    Slices from -8 km (Point A', opposite Sun) through 0 km (Landing Site Pad) to +8 km (Point A, toward Sun).
    """
    distances_km = [round(-8.0 + i * 0.4, 2) for i in range(41)]
    base_elev_m = float(site["coordinates"]["elevation_m"])

    opp_az_idx = (int(round(sun_az_deg)) + 180) % 360
    opp_horizon_deg = site["horizon_angles_deg"][opp_az_idx]

    sun_ridge_dist_km = 4.5
    for feat in site["terrain_features"]:
        ang_diff = abs((feat["az"] - sun_az_deg + 180.0) % 360.0 - 180.0)
        if ang_diff <= feat["width"] * 0.6:
            sun_ridge_dist_km = float(feat["dist_km"])
            break

    ridge_peak_m = math.tan(math.radians(max(0.2, sun_horizon_deg))) * (sun_ridge_dist_km * 1000.0)
    opp_peak_m = math.tan(math.radians(max(0.2, opp_horizon_deg))) * 4500.0

    points: List[Dict[str, Any]] = []
    seed = sum(ord(c) for c in site["id"])
    tan_sun = math.tan(math.radians(sun_alt_deg))
    limiting_ray_at_ridge_m = base_elev_m + ridge_peak_m

    for x_km in distances_km:
        sun_side_bump = ridge_peak_m * math.exp(-0.5 * ((x_km - sun_ridge_dist_km) / 1.15) ** 2)
        opp_side_bump = opp_peak_m * math.exp(-0.5 * ((x_km + 4.5) / 1.25) ** 2)
        crater_dip = -140.0 * math.exp(-0.5 * ((x_km - 2.1) / 0.85) ** 2) - 95.0 * math.exp(
            -0.5 * ((x_km + 2.0) / 0.8) ** 2
        )
        micro_wave = 22.0 * math.sin(x_km * 1.4 + seed) * (abs(x_km) / 8.0)

        pad_weight = 1.0 - math.exp(-0.5 * (x_km / 0.45) ** 2)
        terrain_elev_m = base_elev_m + (sun_side_bump + opp_side_bump + crater_dip + micro_wave) * pad_weight

        if x_km >= sun_ridge_dist_km:
            sun_ray_m = terrain_elev_m + 180.0 + (x_km - sun_ridge_dist_km) * 1000.0 * max(0.0, tan_sun)
            in_shadow = False
        else:
            dx_m = (sun_ridge_dist_km - x_km) * 1000.0
            sun_ray_m = limiting_ray_at_ridge_m - dx_m * tan_sun
            in_shadow = sun_ray_m < terrain_elev_m

        points.append(
            {
                "distance_km": x_km,
                "terrain_elevation_m": round(terrain_elev_m, 1),
                "sun_ray_elevation_m": round(sun_ray_m, 1),
                "in_shadow": bool(in_shadow),
            }
        )

    return {
        "section_label": f"Cross-Section A' ({round((sun_az_deg + 180) % 360)}°) → Landing Site {site['id']} → A ({round(sun_az_deg)}° toward Sun)",
        "sun_azimuth_deg": sun_az_deg,
        "sun_elevation_deg": sun_alt_deg,
        "blocking_horizon_deg": sun_horizon_deg,
        "ridge_distance_km": sun_ridge_dist_km,
        "pad_elevation_m": base_elev_m,
        "profile_points": points,
    }


def evaluate_site_Status_and_notes(
    site: Dict[str, Any],
    vis: Dict[str, Any],
    window: Dict[str, Any],
    min_duration_days: float = 3.0,
) -> Dict[str, Any]:
    """
    Applies the engineering decision rules to classify the site into:
    - GO (✓)
    - CAUTION (⚠)
    - NO_GO (✗)
    And populates `Available Resources` and `Cautions` for the right-hand sidebar card.
    """
    slope = float(site["slope_deg"])
    is_sunlit = vis["is_sunlit"]
    has_comm = vis["has_earth_comm"]
    rem_days = window["remaining_sunlit_days"]
    ice_km = float(site["ice_distance_km"])

    resources: List[str] = []
    cautions: List[str] = []

    if is_sunlit:
        resources.append(
            f"Solar Power Active: Sun at +{vis['ephemeris']['sun']['elevation_deg']:.1f}° "
            f"({vis['sun_margin_deg']:+.1f}° vs local horizon)"
        )
        if rem_days < min_duration_days:
            cautions.append(
                f"Short sunlit window remaining ({rem_days} days left < {min_duration_days:.0f}d requirement)"
            )
        elif rem_days < 5.0:
            cautions.append(f"Approaching local sunset in {rem_days} days behind crater rim")
    else:
        cautions.append(
            f"Site in Crater Shadow: Sun is {abs(vis['sun_margin_deg']):.1f}° below blocking ridge "
            f"({vis['sun_horizon_deg']:.1f}° horizon mask)"
        )

    if has_comm:
        resources.append(
            f"Direct-to-Earth (DTE) Comm Link: Earth at +{vis['ephemeris']['earth']['elevation_deg']:.1f}° elevation"
        )
    else:
        cautions.append(
            f"Earth Blocked by Terrain ({vis['earth_margin_deg']:.1f}°): Lunar relay satellite required for comms"
        )

    resources.append(
        f"Volatiles Access: {ice_km} km from {site['psr_name']} (Water Ice PSR)"
    )

    if slope >= 10.0:
        cautions.append(f"Excessive Landing Slope: {slope}° exceeds 10° lander tip-over limit")
    elif slope >= 6.0:
        cautions.append(f"Moderate Terrain Slope: {slope}° requires precision hazard avoidance")
    else:
        resources.append(f"Stable Landing Pad Topography: {slope}° slope (Roughness {site['roughness_m']}m)")

    if not is_sunlit or slope >= 10.0 or rem_days < min_duration_days:
        status = "NO_GO"
        is_go = False
        badge = "✗"
    elif not has_comm or slope >= 6.5 or rem_days < 5.0:
        status = "CAUTION"
        is_go = True
        badge = "✓"
    else:
        status = "GO"
        is_go = True
        badge = "✓"

    if not cautions:
        cautions.append("Nominal: All illumination, DTE communication, and slope constraints met.")

    score = 0.0
    if is_sunlit:
        score += 40.0 + min(25.0, rem_days * 2.2)
    if has_comm:
        score += 15.0
    score += max(0.0, (12.0 - slope) * 1.6)

    return {
        "status": status,
        "is_go": is_go,
        "badge": badge,
        "suitability_score": round(min(100.0, score), 1),
        "resources": resources,
        "cautions": cautions,
    }


def evaluate_all_sites(
    date_str: str | None = None, min_duration_days: float = 3.0
) -> Dict[str, Any]:
    """
    Evaluates all 8 candidate sites (A-H) for the given timestamp.
    Powers the Map Canvas and the `IDEAL LANDING LOCATIONS` (A-H) grid.
    """
    dt = parse_iso_utc(date_str)
    prefetch_horizons_window(dt, scan_days=15, step_hours=6)
    db = get_terrain_db()
    sites_dict = db["sites"]

    pole_ephem = compute_sun_and_earth_angles(-89.99, 0.0, dt)

    results: List[Dict[str, Any]] = []
    for site_id in sorted(sites_dict.keys()):
        site = sites_dict[site_id]
        vis = check_instant_visibility(site, dt)
        window = compute_viable_window(site, dt, scan_days=15, step_hours=6)
        decision = evaluate_site_Status_and_notes(site, vis, window, min_duration_days)

        results.append(
            {
                "id": site["id"],
                "name": site["name"],
                "region": site["region"],
                "mission_context": site["mission_context"],
                "coordinates": site["coordinates"],
                "map_xy": site["map_xy"],
                "slope_deg": site["slope_deg"],
                "status": decision["status"],
                "is_go": decision["is_go"],
                "badge": decision["badge"],
                "suitability_score": decision["suitability_score"],
                "is_sunlit": vis["is_sunlit"],
                "has_earth_comm": vis["has_earth_comm"],
                "sun_azimuth_deg": vis["ephemeris"]["sun"]["azimuth_deg"],
                "sun_elevation_deg": vis["ephemeris"]["sun"]["elevation_deg"],
                "sun_horizon_deg": vis["sun_horizon_deg"],
                "sun_margin_deg": vis["sun_margin_deg"],
                "earth_azimuth_deg": vis["ephemeris"]["earth"]["azimuth_deg"],
                "earth_elevation_deg": vis["ephemeris"]["earth"]["elevation_deg"],
                "earth_margin_deg": vis["earth_margin_deg"],
                "window_label": window["window_label"],
                "window_start_utc": window["window_start_utc"],
                "window_end_utc": window["window_end_utc"],
                "remaining_sunlit_days": window["remaining_sunlit_days"],
                "sunlit_pct_30d": window["sunlit_pct_30d"],
                "dte_comm_pct_30d": window["dte_comm_pct_30d"],
                "resources": decision["resources"],
                "cautions": decision["cautions"],
            }
        )

    go_count = sum(1 for s in results if s["is_go"])
    best_site = max(results, key=lambda s: s["suitability_score"])

    return {
        "query_timestamp_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ephemeris_source": get_ephemeris_source(),
        "min_duration_days": min_duration_days,
        "south_pole_ephemeris": pole_ephem,
        "summary": {
            "total_sites": len(results),
            "viable_sites_count": go_count,
            "recommended_backup_site": best_site["id"],
            "recommended_backup_name": best_site["name"],
        },
        "sites": results,
    }


def evaluate_site_details(
    site_id: str, date_str: str | None = None, min_duration_days: float = 3.0
) -> Dict[str, Any]:
    """
    Returns full inspection data for a single site (A-H), including:
    - Status, Viable Window, Available Resources, Cautions, Coordinates
    - 360-degree Horizon Profile
    - 2D Conceptual Cross-Section A-A' along the Sun's ray
    - 30-day timeline array (6-hour steps)
    """
    dt = parse_iso_utc(date_str)
    prefetch_horizons_window(dt, scan_days=15, step_hours=6)
    db = get_terrain_db()
    key = site_id.strip().upper()
    if key not in db["sites"]:
        raise KeyError(f"Unknown site_id '{site_id}'. Valid IDs are A through H.")

    site = db["sites"][key]
    vis = check_instant_visibility(site, dt)
    window = compute_viable_window(site, dt, scan_days=15, step_hours=6)
    decision = evaluate_site_Status_and_notes(site, vis, window, min_duration_days)
    cross_section = generate_cross_section_aa(
        site,
        vis["ephemeris"]["sun"]["azimuth_deg"],
        vis["ephemeris"]["sun"]["elevation_deg"],
        vis["sun_horizon_deg"],
    )

    return {
        "id": site["id"],
        "name": site["name"],
        "region": site["region"],
        "mission_context": site["mission_context"],
        "query_timestamp_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coordinates": site["coordinates"],
        "slope_deg": site["slope_deg"],
        "roughness_m": site["roughness_m"],
        "ice_distance_km": site["ice_distance_km"],
        "psr_name": site["psr_name"],
        "status": decision["status"],
        "is_go": decision["is_go"],
        "badge": decision["badge"],
        "suitability_score": decision["suitability_score"],
        "ephemeris": vis["ephemeris"],
        "visibility": {
            "is_sunlit": vis["is_sunlit"],
            "sun_horizon_deg": vis["sun_horizon_deg"],
            "sun_margin_deg": vis["sun_margin_deg"],
            "has_earth_comm": vis["has_earth_comm"],
            "earth_horizon_deg": vis["earth_horizon_deg"],
            "earth_margin_deg": vis["earth_margin_deg"],
        },
        "window": window,
        "resources": decision["resources"],
        "cautions": decision["cautions"],
        "horizon_angles_deg": site["horizon_angles_deg"],
        "terrain_features": site["terrain_features"],
        "cross_section_aa": cross_section,
    }


def compare_scenarios(
    site_a: str,
    date_a: str | None,
    site_b: str,
    date_b: str | None,
    min_duration_days: float = 3.0,
) -> Dict[str, Any]:
    """
    Compares two landing scenarios side-by-side:
    - Question 1: "What about another site nearby?" (Site A vs Site C on same date)
    - Question 2: "What about this site on a different date?" (Site A on Date 1 vs Date 2)
    """
    scen_a = evaluate_site_details(site_a, date_a, min_duration_days)
    scen_b = evaluate_site_details(site_b, date_b, min_duration_days)

    winner = "A" if scen_a["suitability_score"] >= scen_b["suitability_score"] else "B"
    best = scen_a if winner == "A" else scen_b

    diffs: List[str] = []
    sun_diff = round(scen_a["window"]["remaining_sunlit_days"] - scen_b["window"]["remaining_sunlit_days"], 1)
    if abs(sun_diff) > 0.2:
        more = f"Scenario 1 ({scen_a['id']})" if sun_diff > 0 else f"Scenario 2 ({scen_b['id']})"
        diffs.append(f"{more} provides +{abs(sun_diff)} more days of continuous sunlight.")

    slope_diff = round(scen_b["slope_deg"] - scen_a["slope_deg"], 1)
    if abs(slope_diff) > 0.5:
        flatter = f"Scenario 1 ({scen_a['id']})" if slope_diff > 0 else f"Scenario 2 ({scen_b['id']})"
        diffs.append(f"{flatter} has flatter terrain by {abs(slope_diff)}°.")

    if scen_a["visibility"]["has_earth_comm"] != scen_b["visibility"]["has_earth_comm"]:
        comm_winner = f"Scenario 1 ({scen_a['id']})" if scen_a["visibility"]["has_earth_comm"] else f"Scenario 2 ({scen_b['id']})"
        diffs.append(f"Only {comm_winner} has direct-to-Earth line-of-sight communication.")

    return {
        "recommended": {
            "scenario": 1 if winner == "A" else 2,
            "site_id": best["id"],
            "site_name": best["name"],
            "date_utc": best["query_timestamp_utc"],
            "suitability_score": best["suitability_score"],
            "key_differences": diffs,
        },
        "scenario_1": scen_a,
        "scenario_2": scen_b,
    }

