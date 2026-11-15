# Cross section on real terrain (owner: LEAD)

What the "Cross section" panel (`frontend/src/components/profile/SunProfile.tsx`) does, how it was checked, and
where it stops being trustworthy. It lives in the same place as before and keeps the app's look; the logic is new.

## What it shows

1. **A slice of the measured ground.** From `GET /api/terrain/section`, read from the LOLA 20 m south-pole DEM.
   Heights include the Moon's curvature, so a straight ray of light is a straight line on the drawing.
2. **The slice is locked.** When a site opens the slice points at the Sun and then stays put, so the ground does
   not move while the time changes. "Lock to the Sun now" re-aims it. "Follow the Sun" (16 directions, 22.5°
   apart) is still there as an option.
3. **Event view.** "Next sunset" and "Next sunrise" (Earthset and Earthrise in the Earth tab) turn the slice to
   where the body crosses the skyline and move the time to 12 hours before. Dragging the slider then shows it sink
   behind, or rise over, the real terrain at its real angle.
4. **A body off the slice is drawn as off the slice.** A side-on picture cannot show a direction that leaves the
   page. When the Sun is more than 11.25° off the slice line it is drawn hollow at its real elevation, with the
   number of degrees off; no projected angle, sight line or 2-D shadow is drawn.
5. **True ground colours.** `GET /api/terrain/slice-light` ray traces every ground point on the slice through the
   full terrain for the whole lunar day. The colours, the hours-of-sunlight strip and "this slice in shadow" come
   from that. Until it arrives, or if it is unavailable, the panel falls back to shadows from the slice alone and
   says so.
6. **The answer for the lander** (in sunlight, Earth in view, next sunrise or sunset) comes from
   `GET /api/terrain/skyline`: rays from the eye height in every direction, out to 250 km.
7. **Skyline strip** (`SkylineStrip.tsx`): the skyline all around the lander unrolled into a strip, with the Sun's
   and Earth's paths over the lunar day. Where a path is above the ground the body is in view. Clicking a direction
   aims the slice there; clicking a path goes to that moment.
8. **Mini-map** (`SliceMiniMap.tsx`): the terrain from above with the slice line, the body's direction and the
   shadows at the slider time, from `GET /api/terrain/shadow-map`.
9. **Eye height** 2, 5 or 10 m: the height of the solar panel or antenna. **Reach** 8 to 150 km each way.
   **Height scale** 1:1 to x20, with a small 1:1 inset whenever heights are stretched; printed angles are always real.

Nothing else was changed: the other endpoints, the A–H engine and the other panels are as they were.

## How it was checked

- Sun and Earth angles from the app's ephemeris against JPL Horizons (two sites, 30 days): 0.00001°.
- Skyline against an independent full-resolution calculation at six sites: 0.007° RMS, 0.04° worst case. The Sun's
  radius is 0.27°.
- Slice light: at the lander it gives the same answer as the skyline at all 709 hourly steps (two sites); at points
  12 to 27 km along a slice it agrees with a full-accuracy skyline computed at that point at 99.9 to 100 % of steps.
- Shadow map: lit or shaded matched a direct ray march in 360 of 360 pixel and Sun cases; the centre pixel agreed
  with the panel's verdict at 20 of 20 slider positions.
- Skyline strip: event days match an independent calculation to within 0.005 day.
- Reading the DEM from NASA over the network gives the same skyline as the local file.
- 60 backend tests (36 of them for these services, on made-up DEMs with known answers); the panel was driven in a
  headless browser at five sites.

## Limits (the panel states these where they apply)

- **Eye height.** On a crest the skyline in many directions is the lander's own ground a few tens of metres away.
  One extra metre of height moves it by more than a degree in places, and a 20 m DEM does not describe ground that
  close in detail. The panel says when the blocking ground is under 200 m away, and the eye-height control shows
  the effect.
- **The DEM stops at 80°S.** Ground beyond the edge is not included. The panel shows a caution when unseen ground
  could plausibly block the view (IM-1 is 4 km from the edge).
- **Azimuth resolution.** The skyline is reported per whole degree; rise and set times are good to roughly an hour,
  and grazing events can move by several hours.
- **Map and slice resolution.** A 16 km mini-map has 165 m pixels and 5° direction steps, so narrow shadows are
  averaged. Slice colours take the nearest of 201 ray-traced points (1.5 km apart on a 150 km reach).
- **`/api/ephemeris/windows` visibility fields** still use the synthetic terrain and do not agree with the
  ray-traced answer. This panel uses only its altitude and azimuth series.

## Running it

No new dependencies. With the DEM in `backend/data/dem/` a new site takes about 2 s for the verdict, 5 s for the
slice light and under 30 s for the mini-map. With no DEM installed the backend reads NASA's copy over the network:
measured 24 s, 32 s and 36 s for the same three. Everything is cached in `backend/data/cache/` afterwards.
`LOLA_REMOTE=0` turns network reads off; the panel then falls back to the synthetic terrain and labels it.
