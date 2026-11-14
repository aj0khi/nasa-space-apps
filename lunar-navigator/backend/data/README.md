# Data folder (owner: TERRAIN + GEO)

- `kernels/`: JPL ephemeris files. Download automatically on the first API call. Git-ignored.
- `dem/`: NASA LOLA south-pole elevation map. Git-ignored, so **each teammate downloads it once**:

```bash
cd lunar-navigator/backend && .venv/bin/python scripts/get_lola_dem.py
```

That fetches `LDEM_80S_80M.IMG` (115.5 MB) from NASA's Planetary Data System:
LRO / LOLA gridded data, 80 m per pixel, 80°S to the pole, polar stereographic (the same projection
as our map), heights = value × 0.5 m above the 1737.4 km reference sphere. `app/services/polar_dem.py`
reads it directly. Map shadows, site horizons, windows, scores, cross sections and 3D all use it.

Without the file (or north of 80°S) the app uses the synthetic terrain model and says "synthetic terrain".
Tests pin the synthetic model so they pass either way; `tests/test_real_dem.py` runs when the file is present.
