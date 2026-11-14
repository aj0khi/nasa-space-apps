# Data folder (owner: TERRAIN + GEO)

- `kernels/` – JPL ephemeris files. These download automatically on the first API call. Don't commit them.
- `dem/` – put LOLA GeoTIFFs here. Don't commit them (too big). Share them over Drive instead.

## Getting a south-pole DEM
1. Go to NASA PGDA → "LOLA south pole DEMs" (pgda.gsfc.nasa.gov/products/90). Download the **20 m/px** product (it's manageable in size) for the region 85°S–90°S.
2. Or use NASA Moon Trek (trek.nasa.gov/moon). Layer: "LRO LOLA DEM South Pole". Use the export/download tool to grab a crop around your site.
3. Save it as `dem/south_pole_20m.tif`, then implement the TODO in `app/services/terrain.py::load_elevation`.

Without a DEM, the API returns a synthetic crater (`"synthetic": true`).
