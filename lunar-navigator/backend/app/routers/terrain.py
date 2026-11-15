"""Owner: TERRAIN."""
import base64
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from rasterio.errors import RasterioError

from app.models import (CrossSectionRequest, CrossSectionResponse, ElevationGrid, LitRelief, Mask, Profile, PsrGrid,
                        Section, ShadowMap, Skyline, SliceLight)
from app.services import sightline, terrain

router = APIRouter(prefix="/terrain", tags=["terrain"])

Size = Query(20, gt=1, le=100)
Res = Query(128, ge=16, le=512)


def _grid(lat, lon, size_km, res):
    try:
        grid, synthetic = terrain.load_elevation(lat, lon, size_km, res)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RasterioError as exc:  # the streamed NASA DEM could not be read
        raise HTTPException(status_code=503, detail=f"LOLA elevation data unavailable: {exc}") from exc
    return grid, terrain.pixel_size_m(size_km, res), synthetic


@router.get("/elevation", response_model=ElevationGrid)
def elevation(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, px, synthetic = _grid(lat, lon, size_km, res)
    return ElevationGrid(grid=grid.round(1).tolist(), pixel_m=px,
                         min=float(grid.min()), max=float(grid.max()), synthetic=synthetic)


@router.get("/shadow", response_model=Mask)
def shadow(lat: float, lon: float, sun_alt: float, sun_az: float, size_km: float = Size, res: int = Res):
    grid, px, synthetic = _grid(lat, lon, size_km, res)
    m = terrain.shadow_mask(grid, px, sun_alt, sun_az)
    return Mask(mask=m.tolist(), lit_fraction=float(m.mean()), synthetic=synthetic)


@router.get("/lighting", response_model=LitRelief)
def lighting(lat: float, lon: float, sun_alt: float, sun_az: float, size_km: float = Size, res: int = Query(256, ge=16, le=512)):
    """Sunlit / shadowed ground with slope brightness, including shadows cast from up to 40 km outside the tile."""
    try:
        data, lit_fraction, synthetic, reach_km = terrain.lit_relief(lat, lon, sun_alt, sun_az, size_km, res)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RasterioError as exc:  # the streamed NASA DEM could not be read
        raise HTTPException(status_code=503, detail=f"LOLA elevation data unavailable: {exc}") from exc
    return LitRelief(res=res, pixel_m=terrain.pixel_size_m(size_km, res), data=base64.b64encode(data.tobytes()).decode(),
                     lit_fraction=lit_fraction, horizon_reach_km=reach_km, synthetic=synthetic)


@router.get("/rims", response_model=Mask)
def rims(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, px, synthetic = _grid(lat, lon, size_km, res)
    return Mask(mask=terrain.rim_mask(grid, px).tolist(), synthetic=synthetic)


@router.get("/psr", response_model=PsrGrid)
def psr(lat: float, lon: float, size_km: float = Size, res: int = Res):
    """Permanently shadowed ground around a point (south of 80°S), on the same grid as /elevation."""
    try:
        grid = terrain.load_psr(lat, lon, size_km, res)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RasterioError as exc:  # network / NASA server trouble: report unavailable rather than fail the view
        raise HTTPException(status_code=503, detail=f"PSR map unavailable: {exc}") from exc
    if grid is None:
        return PsrGrid(available=False)
    return PsrGrid(available=True, mask=grid.round(2).tolist(), psr_fraction=float(grid.mean()),
                   source="NASA LOLA PSR map (Barker et al., PGDA product 90)")


@router.post("/cross-section", response_model=CrossSectionResponse)
def cross_section(req: CrossSectionRequest):
    size_km = max(2 * max(l.length_km for l in req.lines), 2)
    grid, px, synthetic = _grid(req.lat, req.lon, size_km, 256)
    profiles = []
    for line in req.lines:
        d, e = terrain.cross_section(grid, px, line.azimuth, line.length_km)
        profiles.append(Profile(azimuth=line.azimuth, distance_m=d, elevation_m=e))
    return CrossSectionResponse(profiles=profiles, synthetic=synthetic)


# ---- Sight lines for the cross section (owner: LEAD). Additive: the endpoints above are unchanged. ----
@router.get("/skyline", response_model=Skyline)
def skyline(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-360, le=360),
            observer_m: float = Query(2.0, ge=0.5, le=30)):
    """Ray-traced 360° skyline from the LOLA DEM (synthetic fallback when the DEM cannot be used)."""
    try:
        return sightline.skyline(lat, lon, observer_m)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/section", response_model=Section)
def section(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-360, le=360),
            azimuth: float = Query(0.0, ge=-360, le=360), length_km: float = Query(8.0, ge=0.5, le=150)):
    """Ground along a slice through the site on the LOLA DEM (synthetic fallback when the DEM cannot be used)."""
    try:
        return sightline.section(lat, lon, azimuth, length_km)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # the synthetic fallback reads the same DEM and can fail the same way
        raise HTTPException(status_code=503, detail=f"Terrain data could not be read: {exc}") from exc


def _call(service: str, function: str, **kwargs):
    """Run an optional sight-line service. Imported here, not at the top, so an unfinished or broken service
    cannot stop the rest of the API from starting."""
    try:
        module = __import__(f"app.services.{service}", fromlist=[function])
        return getattr(module, function)(**kwargs)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc) or "Not built yet.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Terrain data could not be read: {exc}") from exc


@router.get("/slice-light", response_model=SliceLight)
def slice_light(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-360, le=360),
                azimuth: float = Query(0.0, ge=-360, le=360), length_km: float = Query(8.0, ge=0.5, le=150),
                start: datetime | None = None, days: float = Query(29.53, gt=0, le=60),
                step_min: int = Query(60, ge=10, le=720), observer_m: float = Query(2.0, ge=0.5, le=30),
                points: int = Query(201, ge=21, le=401)):
    """Ray-traced light along a slice: for each ground point and time, is the Sun / Earth in view from there?"""
    return _call("slicelight", "slice_light", lat=lat, lon=lon, azimuth=azimuth, length_km=length_km, start=start,
                 days=days, step_min=step_min, observer_m=observer_m, points=points)


@router.get("/shadow-map", response_model=ShadowMap)
def shadow_map(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-360, le=360),
               size_km: float = Query(16.0, ge=2, le=320), res: int = Query(96, ge=32, le=160),
               observer_m: float = Query(2.0, ge=0.5, le=30)):
    """Terrain around the site with a per-pixel horizon, so a client can draw real shadows for any Sun position."""
    return _call("shadowmap", "shadow_map", lat=lat, lon=lon, size_km=size_km, res=res, observer_m=observer_m)
