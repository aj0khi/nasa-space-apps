"""Owner: TERRAIN."""
from fastapi import APIRouter, HTTPException, Query

from app.models import CrossSectionRequest, CrossSectionResponse, ElevationGrid, Mask, Profile, Section, Skyline
from app.services import sightline, terrain

router = APIRouter(prefix="/terrain", tags=["terrain"])

Size = Query(20, gt=1, le=100)
Res = Query(128, ge=16, le=512)


def _grid(lat, lon, size_km, res):
    try:
        grid, synthetic = terrain.load_elevation(lat, lon, size_km, res)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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


@router.get("/rims", response_model=Mask)
def rims(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, _, synthetic = _grid(lat, lon, size_km, res)
    return Mask(mask=terrain.rim_mask(grid).tolist(), synthetic=synthetic)


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
def skyline(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-360, le=360)):
    """Ray-traced 360° skyline from the LOLA DEM (synthetic fallback when the DEM cannot be used)."""
    try:
        return sightline.skyline(lat, lon)
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
