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
    data: str  # base64 bytes, res×res, row 0 = top. 255 = outside map; bit 7 = sunlit; bits 0–6 = brightness
    lit_fraction: float
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
