"""Owner: TERRAIN."""
from fastapi import APIRouter, HTTPException, Query
from rasterio.errors import RasterioError

from app.models import CrossSectionRequest, CrossSectionResponse, ElevationGrid, Mask, Profile, PsrGrid
from app.services import terrain

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


@router.get("/rims", response_model=Mask)
def rims(lat: float, lon: float, size_km: float = Size, res: int = Res):
    grid, _, synthetic = _grid(lat, lon, size_km, res)
    return Mask(mask=terrain.rim_mask(grid).tolist(), synthetic=synthetic)


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
