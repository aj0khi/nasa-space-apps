# Data folder (owner: TERRAIN + GEO)

- `kernels/` – JPL ephemeris files. These download automatically on the first API call. Don't commit them.
- `dem/` – put LOLA GeoTIFFs here. Don't commit them (too big). Share them over Drive instead.

## South-pole DEM

Download [LOLA LDEM_80S_20MPP_ADJ.TIF](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF),
covering 80°S to the pole. Put it in `dem/` (with a `.tif` or `.tiff` extension),
or keep it at the repository root as `LDEM_80S_20MPP_ADJ.tiff`. The `dem/` file takes
precedence; keep only one TIFF there. The file is local data and should not be committed.

**No download needed:** with no local file, the backend reads NASA's copy directly over the
internet. The GeoTIFF is tiled with overviews, so only the needed 512×512 tiles are fetched
(first look at an area ~5–8 s, repeat visits cached) and large areas use its lower-resolution
overviews. If NASA is unreachable, terrain falls back to the synthetic model for 5 minutes and
retries. `LOLA_REMOTE=0` turns remote reading off; `LOLA_DEM_URL` points at another copy.
Tests never use the network (`tests/conftest.py`). A local file is still faster and works offline.

The local terrain elevation, cross-section, shadow and rim endpoints sample this DEM.
They report `synthetic: false` when using it. Outside the DEM region, or when no DEM
is present, they return the existing synthetic terrain and report `synthetic: true`.
Requests whose area includes missing DEM data return an error rather than filling it
with invented elevations. Raster pixels are 20 m apart; effective resolution and
height uncertainty vary. Local shadows only account for terrain inside the tile.

On the main FastAPI server, A–H evaluations use the same DEM for site elevation,
estimated slope, cross-section and skyline. The skyline samples a 200 m grid in
one-degree directions up to 50 km, with a 2 m observer height and approximate lunar
curvature. It does not account for terrain farther away. The first request loads and
caches each site's grid. With no DEM, A–H evaluations fall back to their original
synthetic profiles; `terrain_source` identifies which is used. Missing coverage
returns an error. The standalone root backend still uses synthetic profiles.
The A–A′ profile's shadow flags away from the site use only the displayed 16 km
slice and are not a full terrain illumination calculation.

The 2D sunlit-relief layer samples the LOLA DEM on a coarser polar grid, using the
Sun's position at the displayed hour, surface slope, approximate lunar curvature,
and 72 ray samples out to 50 km. Features smaller than a map pixel and blockers
farther away are not captured. Pixels without enough DEM coverage are unknown, not
filled with synthetic terrain. Brightness and shadow-side relief are visually
enhanced and are not calibrated surface reflectance. Unmodeled areas are blank in
relief mode. The separate photo mode shows the fixed LRO WAC mosaic; its
photographed shadows do not move.
Without a DEM, the illumination API still reports its synthetic fallback, but the
2D map leaves relief blank rather than showing that fallback as real shadows. The separate ephemeris-window
skyline model remains synthetic. A–H roughness, terrain feature descriptions and ice proximity are
unverified legacy assumptions, not LOLA measurements. Statuses and shadow estimates
are exploratory, not validated landing guidance.
Credit [Barker et al. (2023)](https://doi.org/10.3847/PSJ/acf3e1) and the
[NASA dataset](https://doi.org/10.60903/gsfcpgda-lola-spole).
