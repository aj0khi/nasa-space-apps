"""
Lunar Ephemeris Engine (`ephemeris.py`)

Computes topocentric Azimuth (0-360 deg, North=0, East=90) and Elevation (-90 to +90 deg)
of the Sun and Earth as seen from any Selenographic coordinate (lat, lon, elevation_m)
at any UTC timestamp.

Primary Source:
- Live NASA JPL Horizons REST API (`https://ssd.jpl.nasa.gov/api/horizons.api`)
  using `COMMAND='301'`, `CENTER='500@399'`, `QUANTITIES='14,15'` (`ObsSub-LON`, `ObsSub-LAT`,
  `SunSub-LON`, `SunSub-LAT`), fetching an entire 30-day window (121 timestamps at 6h steps)
  in a single HTTP request and caching it in memory.

Fallback Source:
- Analytical IAU/JPL Lunar Libration & Solar/Terrestrial Orbital Elements if offline.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone
import math
from typing import Any, Dict, Tuple
import requests


# In-memory cache of NASA JPL Horizons sub-solar & sub-earth coordinates
# Keyed by UTC timestamp string: "YYYY-MM-DD HH:MM"
_HORIZONS_SUBPOINTS_CACHE: Dict[str, Dict[str, Any]] = {}
_LAST_EPHEMERIS_SOURCE: str = "NASA JPL Horizons Live REST API (DE441)"


def parse_iso_utc(date_str: str | None) -> datetime:
    """Parses an ISO-8601 date string into a timezone-aware UTC datetime."""
    if not date_str:
        return datetime.now(timezone.utc)
    cleaned = date_str.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        dt = datetime.strptime(cleaned[:10], "%Y-%m-%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def julian_date(dt: datetime) -> float:
    """Converts a UTC datetime into Julian Date (JD)."""
    utc_dt = dt.astimezone(timezone.utc)
    unix_ts = utc_dt.timestamp()
    return unix_ts / 86400.0 + 2440587.5


def prefetch_horizons_window(
    center_dt: datetime, scan_days: int = 15, step_hours: int = 6
) -> bool:
    """
    Fetches a 30-day (`-scan_days` to `+scan_days`) table of Selenographic Sub-Earth
    (`ObsSub-LON`, `ObsSub-LAT`) and Sub-Solar (`SunSub-LON`, `SunSub-LAT`) coordinates
    from the live NASA JPL Horizons API (`COMMAND='301'`, `CENTER='500@399'`, `QUANTITIES='14,15'`)
    in a single HTTP GET request and stores all steps in `_HORIZONS_SUBPOINTS_CACHE`.
    """
    global _LAST_EPHEMERIS_SOURCE
    start_dt = center_dt - timedelta(days=scan_days)
    stop_dt = center_dt + timedelta(days=scan_days)

    start_key = start_dt.strftime("%Y-%m-%d %H:%M")
    center_key = center_dt.strftime("%Y-%m-%d %H:%M")
    stop_key = stop_dt.strftime("%Y-%m-%d %H:%M")

    # If this 30-day window is already cached, no network request is needed
    if (
        start_key in _HORIZONS_SUBPOINTS_CACHE
        and center_key in _HORIZONS_SUBPOINTS_CACHE
        and stop_key in _HORIZONS_SUBPOINTS_CACHE
    ):
        return True

    params = {
        "format": "json",
        "COMMAND": "'301'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'500@399'",
        "START_TIME": f"'{start_key}'",
        "STOP_TIME": f"'{stop_key}'",
        "STEP_SIZE": f"'{step_hours} h'",
        "QUANTITIES": "'14,15'",
        "CSV_FORMAT": "'YES'",
    }

    url = "https://ssd.jpl.nasa.gov/api/horizons.api"
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        result_text = resp.json().get("result", "")
        if "$$SOE" not in result_text or "$$EOE" not in result_text:
            return False

        soe_block = result_text.split("$$SOE")[1].split("$$EOE")[0].strip()
        parsed_count = 0
        for line in soe_block.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 7:
                continue
            # Format: "2026-Nov-16 18:00", "", "", ObsSub-LON, ObsSub-LAT, SunSub-LON, SunSub-LAT
            dt_row = datetime.strptime(parts[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
            row_key = dt_row.strftime("%Y-%m-%d %H:%M")

            obs_lon = float(parts[3])
            obs_lat = float(parts[4])
            sun_lon = float(parts[5])
            sun_lat = float(parts[6])

            if obs_lon > 180.0:
                obs_lon -= 360.0
            if sun_lon > 180.0:
                sun_lon -= 360.0

            _HORIZONS_SUBPOINTS_CACHE[row_key] = {
                "julian_date": round(julian_date(dt_row), 5),
                "sub_solar_lat": sun_lat,
                "sub_solar_lon": sun_lon,
                "sub_earth_lat": obs_lat,
                "sub_earth_lon": obs_lon,
                "source": "NASA JPL Horizons Live REST API (DE441)",
            }
            parsed_count += 1

        if parsed_count > 0:
            _LAST_EPHEMERIS_SOURCE = "NASA JPL Horizons Live REST API (DE441)"
            return True
    except Exception:
        pass

    _LAST_EPHEMERIS_SOURCE = "Analytical IAU/JPL Lunar Ephemeris (Offline Fallback)"
    return False


def get_ephemeris_source() -> str:
    """Returns whether the active ephemeris data came from live NASA JPL Horizons or fallback."""
    return _LAST_EPHEMERIS_SOURCE


def sub_solar_and_earth_selenographic(dt: datetime) -> Dict[str, Any]:
    """
    Returns Selenographic Sub-Solar and Sub-Earth (Lat, Lon) in degrees.
    Checks the live NASA JPL Horizons cache first, and falls back to analytical
    IAU/JPL lunar orientation equations if offline or outside the cached grid.
    """
    utc_dt = dt.astimezone(timezone.utc)
    key = utc_dt.strftime("%Y-%m-%d %H:%M")
    if key in _HORIZONS_SUBPOINTS_CACHE:
        return _HORIZONS_SUBPOINTS_CACHE[key]

    jd = julian_date(utc_dt)
    d = jd - 2451545.0  # Days since J2000.0

    # Fundamental orbital arguments (degrees)
    D = (297.8501921 + 12.1907491175 * d) % 360.0
    M_sun = (357.5291092 + 0.98560028 * d) % 360.0
    M_moon = (134.9633964 + 13.06499295 * d) % 360.0
    F = (93.2720950 + 13.22935024 * d) % 360.0

    # 1. Sub-Solar Selenographic Coordinates:
    sub_solar_lon = (205.4 - D - 1.5 * math.sin(math.radians(M_sun))) % 360.0
    if sub_solar_lon > 180.0:
        sub_solar_lon -= 360.0

    sub_solar_lat = -1.55 * math.sin(math.radians(F - D + 42.0))

    # 2. Sub-Earth Selenographic Coordinates (Optical Libration in Longitude & Latitude):
    lib_lon = (
        -6.289 * math.sin(math.radians(M_moon))
        + 1.274 * math.sin(math.radians(2 * D - M_moon))
        + 0.658 * math.sin(math.radians(2 * D))
    )
    lib_lat = 6.683 * math.sin(math.radians(F)) - 0.28 * math.sin(math.radians(M_moon + F))

    return {
        "julian_date": round(jd, 5),
        "sub_solar_lat": sub_solar_lat,
        "sub_solar_lon": sub_solar_lon,
        "sub_earth_lat": lib_lat,
        "sub_earth_lon": lib_lon,
        "source": "Analytical IAU/JPL Lunar Ephemeris",
    }


def selenographic_to_topocentric_az_alt(
    obs_lat_deg: float,
    obs_lon_deg: float,
    sub_lat_deg: float,
    sub_lon_deg: float,
    parallax_deg: float = 0.0,
) -> Tuple[float, float]:
    """
    Converts sub-body selenographic coordinates (sub_lat, sub_lon) into local horizon
    Azimuth (0-360 deg, N=0, E=90, S=180, W=270) and Elevation/Altitude (-90 to +90 deg)
    at a Lunar surface observer (obs_lat_deg, obs_lon_deg).
    """
    phi = math.radians(obs_lat_deg)
    lam = math.radians(obs_lon_deg)
    delta = math.radians(sub_lat_deg)
    lam_sub = math.radians(sub_lon_deg)

    d_lon = lam_sub - lam

    sin_alt = math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.cos(d_lon)
    sin_alt = max(-1.0, min(1.0, sin_alt))
    alt_rad = math.asin(sin_alt)
    alt_deg = math.degrees(alt_rad) - parallax_deg * math.cos(alt_rad)

    y = math.sin(d_lon) * math.cos(delta)
    x = math.cos(phi) * math.sin(delta) - math.sin(phi) * math.cos(delta) * math.cos(d_lon)
    az_deg = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0

    return round(az_deg, 2), round(alt_deg, 3)


def compute_sun_and_earth_angles(
    lat_deg: float, lon_deg: float, dt: datetime, elevation_m: float = 0.0
) -> Dict[str, Any]:
    """
    Returns topocentric Azimuth and Elevation for both the Sun and the Earth
    from a Lunar surface coordinate (lat_deg, lon_deg, elevation_m) at UTC datetime `dt`.

    Includes the selenographic altitude horizon-dip correction for elevated peaks
    (Peaks of Persistent Light on the Moon's South Pole, R_moon = 1737.4 km).
    """
    sub = sub_solar_and_earth_selenographic(dt)

    r_moon_m = 1737400.0
    sign = 1.0 if elevation_m >= 0 else -1.0
    relief_dip_deg = sign * math.degrees(math.sqrt(2.0 * abs(elevation_m) / r_moon_m)) * 0.62

    sun_az, sun_alt_raw = selenographic_to_topocentric_az_alt(
        lat_deg, lon_deg, sub["sub_solar_lat"], sub["sub_solar_lon"], parallax_deg=0.002
    )
    earth_az, earth_alt_raw = selenographic_to_topocentric_az_alt(
        lat_deg, lon_deg, sub["sub_earth_lat"], sub["sub_earth_lon"], parallax_deg=0.259
    )

    sun_alt = round(sun_alt_raw + relief_dip_deg, 3)
    earth_alt = round(earth_alt_raw + relief_dip_deg, 3)

    return {
        "timestamp_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "julian_date": sub["julian_date"],
        "ephemeris_source": sub.get("source", _LAST_EPHEMERIS_SOURCE),
        "relief_dip_deg": round(relief_dip_deg, 3),
        "sun": {
            "azimuth_deg": sun_az,
            "elevation_deg": sun_alt,
            "sub_lat_deg": round(sub["sub_solar_lat"], 3),
            "sub_lon_deg": round(sub["sub_solar_lon"], 3),
            "angular_radius_deg": 0.266,
        },
        "earth": {
            "azimuth_deg": earth_az,
            "elevation_deg": earth_alt,
            "sub_lat_deg": round(sub["sub_earth_lat"], 3),
            "sub_lon_deg": round(sub["sub_earth_lon"], 3),
            "angular_radius_deg": 0.95,
        },
    }


def query_jpl_horizons_live(
    lat_deg: float, lon_deg: float, elevation_m: float, dt: datetime, target: str = "10"
) -> Dict[str, Any]:
    """
    Queries NASA's official JPL Horizons REST API (`https://ssd.jpl.nasa.gov/api/horizons.api`)
    for topocentric observer table (Quantities=4: Apparent Azimuth & Elevation) from a Lunar
    surface site (`CENTER='coord@301'`).
    Target '10' = Sun, '399' = Earth.
    """
    start_str = dt.strftime("%Y-%m-%d %H:%M")
    stop_str = (dt + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M")
    elev_km = round(elevation_m / 1000.0, 3)

    params = {
        "format": "json",
        "COMMAND": f"'{target}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_deg},{lat_deg},{elev_km}'",
        "START_TIME": f"'{start_str}'",
        "STOP_TIME": f"'{stop_str}'",
        "STEP_SIZE": "'1 h'",
        "QUANTITIES": "'4'",
    }

    url = "https://ssd.jpl.nasa.gov/api/horizons.api"
    try:
        resp = requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        payload = resp.json()
        return {
            "source": "NASA JPL Horizons Live REST API",
            "request_url": resp.url,
            "status": "ok",
            "horizons_version": payload.get("signature", {}),
            "raw_excerpt": (payload.get("result", "") or "")[:1200],
        }
    except Exception as exc:
        return {
            "source": "NASA JPL Horizons Live REST API (Offline / Fallback Mode)",
            "endpoint": url,
            "query_params": params,
            "status": "offline_fallback",
            "note": f"Could not reach live NASA server ({exc}); using local JPL/IAU analytical ephemeris.",
        }

