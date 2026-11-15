# Cross section on real terrain (owner: LEAD)

What the "Cross section" panel (`frontend/src/components/profile/SunProfile.tsx`) now does, how it was checked,
and where it stops being trustworthy. The panel, its controls and its look are unchanged; the logic underneath is new.

## What changed

1. **The ground is measured.** The slice comes from `GET /api/terrain/section`, read from the LOLA 20 m south-pole
   DEM (`LDEM_80S_20MPP_ADJ`). Heights include the Moon's curvature, so a straight ray of light is a straight line
   on the drawing.
2. **16 fixed slice directions.** The A end points along one of 16 directions, 22.5° apart. The date and time pick
   the direction nearest the Sun (or Earth), so the ground stays still until the Sun has moved on to the next one.
   The Sun itself is not limited to 16 positions; it is at most 11.25° off the slice.
3. **True scale and the real angle.** Slices up to 15 km each way are drawn 1:1. The Sun's or Earth's real angle
   above the lander's horizontal is printed on the drawing. Longer slices stretch the heights so the relief shows,
   say so, and still print the real angle. 1:1 can always be chosen.
4. **In sunlight / in view is ray traced.** The answer for the lander comes from `GET /api/terrain/skyline`: rays
   marched from 2 m above the ground in every direction, out to 250 km. The body is in view when the centre of its
   disc is above that skyline at its azimuth. The colours along the slice still show only shadows cast by ground on
   that one line, and the panel says so.
5. **Next sunrise or sunset** (and Earthrise or Earthset) from the hourly positions against the same skyline.
6. **Long view.** Reach of 8, 30, 100 or 150 km each way. When the terrain that hides the body is beyond the slice,
   a button widens it.

Nothing else was changed: the other endpoints, the A–H engine and the other panels are as they were.

## How it was checked

- Sun and Earth angles from the app's ephemeris against JPL Horizons (two sites, 30 days): largest difference
  0.00001°.
- Skyline against an independent full-resolution calculation at six sites: 0.007° RMS, 0.04° worst case.
  The Sun's radius is 0.27°.
- Slice heights against direct 20 m sampling: 0.03 m RMS within 10 km, about 1 m to 55 km, about 4 m beyond.
- Reading the DEM from NASA over the network gives the same skyline as the local file (difference 0.0000°).
- `backend/tests/test_sightline.py`: 11 tests on made-up DEMs with known answers.
- The panel was driven in a headless browser: the slice only ever takes the 16 directions, one step at a time, and
  the verdict matches an independent calculation.

## Limits (the panel states these where they apply)

- **Eye height.** The model looks from 2 m above the ground. On a crest, the skyline in many directions is the
  lander's own ground a few tens of metres away, and one extra metre of height moves it by more than a degree in
  places. A 20 m DEM does not describe ground that close in detail. Where the blocking ground is under 200 m away
  the panel says the answer depends on mast height.
- **The DEM stops at 80°S.** Toward the north, ground beyond the edge is not included. `seen_km` reports how far
  the data reaches, and the panel shows a caution when unseen ground could plausibly block the view (IM-1 is 4 km
  from the edge).
- **Azimuth resolution.** The skyline is reported per whole degree and interpolated; rise and set times are good
  to roughly an hour, and grazing events (the Sun skimming a ridge) can move by several hours.
- **`/api/ephemeris/windows` visibility fields** still use the synthetic terrain and do not agree with the ray
  traced answer. This panel ignores them and uses only the altitude and azimuth series.

## Running it

No new dependencies. With no DEM installed the backend reads NASA's copy over the network (about 10 to 25 s for
the first open of a site, cached afterwards in `backend/data/cache/`). With the DEM in `backend/data/dem/` the
first open takes about 2 s. `LOLA_REMOTE=0` turns network reads off; the panel then falls back to the synthetic
terrain and labels it.
