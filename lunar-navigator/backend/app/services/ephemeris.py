"""Sun & Earth positions as seen from a point on the Moon. Owner: ASTRO.

Uses Skyfield + JPL DE421 + the lunar principal-axis frame (MOON_ME_DE421, the same frame LOLA maps use).
Kernels (~20 MB) download on first use into backend/data/kernels/.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np
from skyfield import almanac
from skyfield.api import Loader
from skyfield.planetarylib import PlanetaryConstants

from app.models import BodyPosition, Event, Season, SeriesPoint, SunEarthState, Windows

KERNEL_DIR = Path(__file__).resolve().parents[2] / "data" / "kernels"
KERNEL_DIR.mkdir(parents=True, exist_ok=True)
load = Loader(str(KERNEL_DIR))


@lru_cache(maxsize=1)
def _kernels():
    ts = load.timescale()
    eph = load("de421.bsp")
    pc = PlanetaryConstants()
    pc.read_text(load("moon_080317.tf"))
    pc.read_text(load("pck00008.tpc"))
    pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
    frame = pc.build_frame_named("MOON_ME_DE421")
    return ts, eph, pc, frame


def _site(lat: float, lon: float):
    _, eph, pc, frame = _kernels()
    return eph["moon"] + pc.build_latlon_degrees(frame, lat, lon)


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


PHASE_NAMES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
               "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"]


def sun_earth_state(lat: float, lon: float, when: datetime) -> SunEarthState:
    ts, eph, _, _ = _kernels()
    t = ts.from_datetime(_utc(when))
    site = _site(lat, lon)
    obs = site.at(t)

    def pos(body) -> BodyPosition:
        alt, az, dist = obs.observe(eph[body]).apparent().altaz()
        return BodyPosition(altitude=alt.degrees, azimuth=az.degrees, distance_km=dist.km)

    # Earth's lit fraction seen from the Moon: phase angle at Earth between Sun and Moon.
    e = eph["earth"].at(t)
    to_sun = e.observe(eph["sun"]).position.km
    to_moon = e.observe(eph["moon"]).position.km
    cos_a = np.dot(to_sun, to_moon) / (np.linalg.norm(to_sun) * np.linalg.norm(to_moon))

    phase_deg = almanac.moon_phase(eph, t).degrees
    name = PHASE_NAMES[int(((phase_deg + 22.5) % 360) // 45)]

    return SunEarthState(
        time=_utc(when),
        sun=pos("sun"),
        earth=pos("earth"),
        earth_phase_illum=float((1 + cos_a) / 2),
        moon_phase_name=name,
    )


def horizon_elevation(lat: float, lon: float, azimuth_deg: np.ndarray) -> np.ndarray:
    """Local horizon height (deg) in each direction.

    TODO(ASTRO+TERRAIN): build from the DEM (terrain.horizon_profile) so crater walls block the Sun.
    Flat horizon for now.
    """
    return np.zeros_like(azimuth_deg)


def _events(times: list[datetime], alt: np.ndarray, horizon: np.ndarray) -> list[Event]:
    above = alt > horizon
    out: list[Event] = []
    for i in np.nonzero(above[1:] != above[:-1])[0]:
        # linear interpolation of crossing time
        d0, d1 = alt[i] - horizon[i], alt[i + 1] - horizon[i + 1]
        frac = d0 / (d0 - d1) if d0 != d1 else 0.5
        t = times[i] + (times[i + 1] - times[i]) * float(frac)
        out.append(Event(type="rise" if above[i + 1] else "set", time=t))
    return out


def find_windows(lat: float, lon: float, start: datetime, days: float = 30, step_min: int = 30) -> Windows:
    ts, eph, _, _ = _kernels()
    start = _utc(start)
    n = int(days * 24 * 60 / step_min) + 1
    t0 = ts.from_datetime(start)
    t = ts.tt_jd(t0.tt + np.arange(n) * step_min / 1440.0)
    times = [start + timedelta(minutes=step_min * i) for i in range(n)]

    obs = _site(lat, lon).at(t)
    s_alt, s_az, _ = obs.observe(eph["sun"]).apparent().altaz()
    e_alt, e_az, _ = obs.observe(eph["earth"]).apparent().altaz()
    s_alt, s_az, e_alt, e_az = s_alt.degrees, s_az.degrees, e_alt.degrees, e_az.degrees

    s_hz = horizon_elevation(lat, lon, s_az)
    e_hz = horizon_elevation(lat, lon, e_az)
    sun_ev = _events(times, s_alt, s_hz)
    earth_ev = _events(times, e_alt, e_hz)

    # downsample the series so the frontend payload stays small (~500 points)
    stride = max(1, n // 500)
    series = [SeriesPoint(time=times[i], sun_alt=s_alt[i], sun_az=s_az[i], earth_alt=e_alt[i], earth_az=e_az[i])
              for i in range(0, n, stride)]

    return Windows(
        sun_events=sun_ev,
        earth_events=earth_ev,
        sunlit_fraction=float(np.mean(s_alt > s_hz)),
        earth_visible_fraction=float(np.mean(e_alt > e_hz)),
        next_sunset=next((e.time for e in sun_ev if e.type == "set"), None),
        next_earthset=next((e.time for e in earth_ev if e.type == "set"), None),
        series=series,
    )


def lunar_seasons(start: datetime, days: int = 360) -> list[Season]:
    """Next lunar 'seasons' after `start`.

    The Moon's spin axis is tilted only ~1.54°, so the subsolar latitude swings between about ±1.54°
    over ~346.6 days. At the south pole that small swing decides which rims get light.
    Southern summer = Sun furthest south (best light at the south pole).
    """
    ts, eph, _, frame = _kernels()
    start = _utc(start)
    scan0 = start - timedelta(days=30)  # look back a little so turning points near `start` are seen whole
    n = (days + 60) * 4  # every 6 hours
    t0 = ts.from_datetime(scan0)
    t = ts.tt_jd(t0.tt + np.arange(n) / 4.0)
    lat = (eph["sun"] - eph["moon"]).at(t).frame_latlon(frame)[0].degrees
    at = lambda i: scan0 + timedelta(hours=6 * int(i))  # noqa: E731

    # Smooth over ~1 month to remove small wiggles, then find turning points and zero crossings.
    k = 112
    sm = np.convolve(lat, np.ones(k) / k, mode="same")
    d = np.diff(sm)
    candidates: list[Season] = []
    for i in range(k, n - k):
        if d[i - 1] < 0 <= d[i]:
            j = i - k // 2 + int(np.argmin(lat[i - k // 2:i + k // 2]))
            candidates.append(Season(key="south_summer", name="Southern summer", time=at(j), subsolar_lat=float(lat[j])))
        elif d[i - 1] > 0 >= d[i]:
            j = i - k // 2 + int(np.argmax(lat[i - k // 2:i + k // 2]))
            candidates.append(Season(key="south_winter", name="Southern winter", time=at(j), subsolar_lat=float(lat[j])))
    sign = np.sign(sm)
    for i in np.nonzero(sign[k:n - k - 1] != sign[k + 1:n - k])[0] + k:
        north = sm[i + 1] > sm[i]
        candidates.append(Season(
            key="equinox_north" if north else "equinox_south",
            name="Equinox (Sun heading north)" if north else "Equinox (Sun heading south)",
            time=at(i + 1), subsolar_lat=float(lat[i + 1])))

    out: dict[str, Season] = {}
    for s in sorted(candidates, key=lambda s: s.time):
        if s.time >= start - timedelta(days=15) and s.key not in out:
            out[s.key] = s
    return sorted(out.values(), key=lambda s: s.time)


def earth_moon_distance_km(when: datetime) -> float:
    ts, eph, _, _ = _kernels()
    t = ts.from_datetime(_utc(when))
    return float(eph["earth"].at(t).observe(eph["moon"]).distance().km)
