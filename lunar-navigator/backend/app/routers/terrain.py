"""Owner: TERRAIN."""
from fastapi import APIRouter, Query

from app.models import CrossSectionRequest, CrossSectionResponse, ElevationGrid, Mask, Profile
from app.services import terrain

router = APIRouter(prefix="/terrain", tags=["terrain"])

Size = Query(20, gt=1, le=100)
Res = Query(128, ge=16, le=512)


def _grid(lat, lon, size_km, res):
    grid, synthetic = terrain.load_elevation(lat, lon, size_km, res)
    return grid, terrain.pixel_size_m(size_km, res), synthetic


@router.get("/elevation", response_model=ElevationGrid)
def elevation(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, px, synthetic = _grid(lat, lon, size_km, res)
    return ElevationGrid(grid=grid.round(1).tolist(), pixel_m=px,
                         min=float(grid.min()), max=float(grid.max()), synthetic=synthetic)


@router.get("/shadow", response_model=Mask)
def shadow(lat: float, lon: float, sun_alt: float, sun_az: float, size_km: float = Size, res: int = Res):
    grid, px, _ = _grid(lat, lon, size_km, res)
    m = terrain.shadow_mask(grid, px, sun_alt, sun_az)
    return Mask(mask=m.tolist(), lit_fraction=float(m.mean()))


@router.get("/rims", response_model=Mask)
def rims(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, _, _ = _grid(lat, lon, size_km, res)
    return Mask(mask=terrain.rim_mask(grid).tolist())


@router.post("/cross-section", response_model=CrossSectionResponse)
def cross_section(req: CrossSectionRequest):
    size_km = max(2 * max(l.length_km for l in req.lines), 2)
    grid, px, synthetic = _grid(req.lat, req.lon, size_km, 256)
    profiles = []
    for line in req.lines:
        d, e = terrain.cross_section(grid, px, line.azimuth, line.length_km)
        profiles.append(Profile(azimuth=line.azimuth, distance_m=d, elevation_m=e))
    return CrossSectionResponse(profiles=profiles, synthetic=synthetic)
