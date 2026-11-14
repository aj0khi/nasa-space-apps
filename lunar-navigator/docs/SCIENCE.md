# Science Notes (owner: GEO)

## Fixes to our brainstorm notes ⚠️
| Note said | Correct version |
|---|---|
| "14 hrs of night and 14 hrs of day" | About **14.75 Earth *days*** of daylight and the same of night. One lunar day (synodic month) is **29.53 Earth days**. |
| "24 hrs of darkness" at the south pole | Some crater floors are **permanently shadowed regions (PSRs)**. They are dark for billions of years, not 24 hours. |
| "Rims will always have light" | Some south‑pole rims and ridges are lit **80–90%+** of the time, but none are lit 100% of the time. Plan for darkness that can last days. |
| "Weather on the moon" | No atmosphere, so no weather. Show **surface conditions** instead: temperature (about +120 °C in equatorial noon sun, about −170 °C at night, as low as about −240 °C inside PSRs), illumination, and dust. |
| "Tilt difference" | Moon spin axis tilt ≈ **1.54°** to the ecliptic vs Earth's **23.44°**. That tiny tilt is why the sun skims the horizon at the poles and PSRs exist. |
| "Month difference" | Sidereal month 27.32 days, synodic month (one lunar day, sunrise to sunrise) 29.53 days. |
| "Lunar season" | The Moon has very weak seasons because of the 1.54° tilt. At the poles, though, a 1.5° change in sun height decides whether a rim is lit. |
| "Lunar phases (replace N/S/E/W)" | Phase is what Earth sees. For a site, show **local solar time** (lunar morning, noon, evening or night) plus the Earth phase as seen *from* the Moon, which is the opposite of the Moon phase. |

## Key concepts for explainer cards
- **Why rims?** Sun stays near the horizon at the poles. High rims catch light for power, and the dark floors nearby hold water ice. You get the best of both.
- **Shadows → heights.** Height ≈ shadow length × tan(sun elevation). Low sun means long shadows, which makes small bumps easy to measure.
- **Earth in the sky.** The Moon is tidally locked, so Earth barely moves in the sky. On the near side it's always up. On the far side it never rises. Near the edge (limb) it rises and sets slowly because of **libration**. No Earth in view means no direct comms.
- **Power.** Solar panel output ∝ sin(sun elevation) on flat panels. Vertical panels at the poles work better.

## Data sources
| Data | Source |
|---|---|
| Sun/Earth/Moon positions | JPL DE421 ephemeris + lunar PA frame via **Skyfield** (auto‑downloaded) |
| Elevation | **LRO LOLA** DEMs. South pole 5–20 m/px polar stereographic (PGDA: pgda.gsfc.nasa.gov) |
| Imagery / basemap | **NASA Moon Trek** (trek.nasa.gov/moon) WMTS tiles, LROC WAC mosaic |
| PSRs & illumination | LOLA/LROC PSR maps, Mazarico et al. 2011 illumination maps |
| Landing sites | NASA Artemis III candidate regions (2022, updated 2024), NSSDCA mission pages |

## Site list TODOs
- [ ] Verify every coordinate in `backend/app/data/sites.json` and set `"verified": true`
- [ ] Add Artemis III candidate regions with exact centers
- [ ] Add resource notes (ice likelihood, PSR distance, slope)
