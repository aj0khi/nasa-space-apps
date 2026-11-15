"""Shared API schemas. Owner: LEAD. Mirror every change in frontend/src/types.ts and docs/API.md."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ---------- Sites ----------
class Resources(BaseModel):
    water_ice: Literal["none", "low", "possible", "likely", "confirmed"] = "none"
    psr_distance_km: float | None = None
    notes: str = ""


class Site(BaseModel):
    id: str
    name: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    program: str
    country: str
    year: int | None = None
    category: Literal["historic", "artemis", "clps", "international", "custom"]
    resources: Resources = Resources()
    verified: bool = False


# ---------- Ephemeris ----------
class BodyPosition(BaseModel):
    altitude: float  # degrees above local horizon
    azimuth: float   # degrees clockwise from local north
    distance_km: float


class SunEarthState(BaseModel):
    time: datetime
    sun: BodyPosition
    earth: BodyPosition
    earth_phase_illum: float  # 0..1, fraction of Earth's disk lit, seen from the Moon
    moon_phase_name: str      # as seen from Earth


class Event(BaseModel):
    type: Literal["rise", "set"]
    time: datetime


class SeriesPoint(BaseModel):
    time: datetime
    sun_alt: float
    sun_az: float
    earth_alt: float
    earth_az: float
    sun_horizon: float = 0.0    # terrain horizon height in the Sun's direction (deg)
    earth_horizon: float = 0.0  # terrain horizon height in Earth's direction (deg)


class Windows(BaseModel):
    sun_events: list[Event]
    earth_events: list[Event]
    sunlit_fraction: float
    earth_visible_fraction: float
    next_sunset: datetime | None
    next_earthset: datetime | None
    sun_visible_now: bool = False    # Sun above the terrain at the start time
    earth_visible_now: bool = False
    terrain_horizon: bool = False    # True when crater walls / mountains were taken into account
    series: list[SeriesPoint]



class SunInfo(BaseModel):
    subsolar_lat: float
    subsolar_lon: float
    elevation_at_pole: float


class EarthInfo(BaseModel):
    sub_lat: float
    sub_lon: float
    elevation_at_pole: float


class Illumination(BaseModel):
    time: datetime
    res: int
    half_km: float
    min_lat: float
    data: str  # 255 = outside map or unknown; bit 7 = sunlit; bits 0–6 = brightness
    lit_fraction: float | None
    coverage_fraction: float
    horizon_limit_km: float
    pixel_km: float
    sun: SunInfo
    earth: EarthInfo
    synthetic: bool


class Season(BaseModel):
    key: Literal["south_summer", "south_winter", "equinox_north", "equinox_south"]
    name: str
    time: datetime
    subsolar_lat: float  # degrees; negative = Sun south of the lunar equator


# ---------- Terrain ----------
class ElevationGrid(BaseModel):
    grid: list[list[float]]
    pixel_m: float
    min: float
    max: float
    synthetic: bool


class Mask(BaseModel):
    mask: list[list[int]]
    lit_fraction: float | None = None
    synthetic: bool


class LitRelief(BaseModel):
    """Sunlight on a terrain tile. `data` = base64 of res×res bytes, row 0 = north edge:
    bit 7 set = sunlit, bits 0-6 = brightness (sunlit: how squarely the slope faces the Sun; shadow: dim hillshade)."""
    res: int
    pixel_m: float
    data: str
    lit_fraction: float
    horizon_reach_km: float
    synthetic: bool


class PsrGrid(BaseModel):
    """Permanently shadowed regions from NASA's LOLA PSR map (Barker et al.). Cells hold the shadowed fraction 0..1."""
    available: bool
    mask: list[list[float]] | None = None
    psr_fraction: float | None = None
    source: str | None = None


class CrossSectionLine(BaseModel):
    azimuth: float = 0
    length_km: float = 10


class CrossSectionRequest(BaseModel):
    lat: float
    lon: float
    lines: list[CrossSectionLine] = Field(default_factory=lambda: [CrossSectionLine()], max_length=4)


class Profile(BaseModel):
    azimuth: float
    distance_m: list[float]
    elevation_m: list[float]


class CrossSectionResponse(BaseModel):
    profiles: list[Profile]
    synthetic: bool = False


# ---------- Sight lines (cross section). Owner: LEAD ----------
class Skyline(BaseModel):
    """Ray-traced terrain skyline at a site: the Sun or Earth is in view when above it at its azimuth."""
    lat: float
    lon: float
    observer_m: float
    elev_deg: list[float]  # 360 values; index = azimuth in whole degrees, clockwise from north; mean over that degree
    elev_max_deg: list[float] | None = None  # highest skyline inside that degree (compare with the Sun's lower limb)
    elev_min_deg: list[float] | None = None  # lowest skyline inside that degree (compare with the Sun's upper limb)
    dist_km: list[float | None]  # distance to the terrain that sets the highest skyline in that direction
    seen_km: list[float] | None = None  # how far the DEM reaches in that direction; below reach_km = lower bound only
    edge_needs_m: list[float | None] | None = None  # where the DEM ends early: elevation ground past the edge would need to raise the skyline
    dem_top_m: float | None = None  # highest ground in the whole DEM, for judging edge_needs_m
    reach_km: float  # how far the rays were marched
    site_elevation_m: float | None = None
    synthetic: bool = False
    source: str
    note: str | None = None


class Section(BaseModel):
    """Ground along a straight slice through a site, toward `azimuth` (positive x) and behind it."""
    azimuth: float
    length_km: float
    x_m: list[float]
    z_m: list[float]  # height above the lander's ground point; includes the Moon's curvature when `curvature`
    elevation_m: list[float]
    site_elevation_m: float
    curvature: bool
    synthetic: bool = False
    source: str
    note: str | None = None


class SliceLight(BaseModel):
    """For every ground point along a slice and every time step: is the Sun / Earth in view from there?"""
    azimuth: float
    length_km: float
    observer_m: float
    x_m: list[float]         # N positions along the slice, same convention as Section.x_m, evenly spaced
    times: list[str]         # T instants (ISO, UTC), the same grid as /ephemeris/windows for the same start/days/step
    sun: list[str]           # T strings of N characters: '1' = Sun's centre above that point's ray-traced skyline
    earth: list[str]         # same for Earth
    sun_hours: list[float]   # per point: hours with the Sun in view over the whole series
    earth_hours: list[float]
    synthetic: bool = False
    source: str
    note: str | None = None


class ShadowMap(BaseModel):
    """Terrain around a site plus, per pixel, how high a body must be in each direction to be seen from there."""
    lat: float
    lon: float
    size_km: float           # the map is size_km across, centred on the site, north of the site at the top
    res: int                 # res x res pixels
    observer_m: float
    az_step_deg: float       # the horizon is given every az_step_deg of azimuth (0, step, 2*step ...)
    elevation_m: list[float]  # res*res heights, row-major, row 0 = north edge, column 0 = west edge
    horizon_b64: str         # base64 of uint8[res*res*(360/az_step_deg)], pixel-major then azimuth
    horizon_scale: float     # angle (deg) = value * horizon_scale + horizon_offset
    horizon_offset: float    # angles are in the LANDER's level frame: compare directly with the body's altitude at the site
    synthetic: bool = False
    source: str
    note: str | None = None


# ---------- Score ----------
Status = Literal["green", "yellow", "red"]


class Score(BaseModel):
    total: int
    status: Status
    power: int
    comms: int
    terrain: int
    reasons: list[str]


# ---------- Mission ----------
Vehicle = Literal["crewed_lander", "robotic_lander", "rover_delivery"]


class MissionRequest(BaseModel):
    site_id: str | None = None
    lat: float
    lon: float
    vehicle: Vehicle = "robotic_lander"
    departure: datetime


class MissionPlan(BaseModel):
    site_id: str | None
    lat: float
    lon: float
    vehicle: Vehicle
    departure: datetime
    arrival: datetime
    transit_days: float
    distance_km: float
    landing_state: SunEarthState
    score: Score
