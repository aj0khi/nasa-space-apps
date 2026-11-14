"""Site/date viability score. Owner: LEAD (with GEO for thresholds and wording)."""
from __future__ import annotations

import numpy as np

from app.models import Score, Windows

WEIGHTS = {"power": 0.45, "comms": 0.35, "terrain": 0.20}  # TODO(LEAD): tune with GEO
GREEN, YELLOW = 70, 40


def score_site(windows: Windows, slope_deg: float) -> Score:
    reasons: list[str] = []

    # Power: how often the Sun is up, and how high it gets when it is up.
    lit_alts = np.array([p.sun_alt for p in windows.series if p.sun_alt > 0])
    mean_alt = float(lit_alts.mean()) if lit_alts.size else 0.0
    power = 100 * windows.sunlit_fraction * min(1.0, 0.4 + np.sin(np.radians(mean_alt)) * 2)
    where = "above the surrounding terrain" if windows.terrain_horizon else "above the horizon"
    reasons.append(f"Sun {where} {windows.sunlit_fraction:.0%} of the time (avg {mean_alt:.1f}° when up)")

    # Comms: direct-to-Earth line of sight.
    comms = 100 * windows.earth_visible_fraction
    if windows.earth_visible_fraction == 0:
        reasons.append("Earth never visible: needs a relay satellite")
    elif windows.earth_visible_fraction == 1:
        reasons.append("Earth always visible")
    else:
        reasons.append(f"Earth visible {windows.earth_visible_fraction:.0%} of the time")

    # Terrain: landers want < ~8–10° slope.  TODO(TERRAIN): use a local slope stat, not one pixel.
    terrain = float(np.clip(100 - (slope_deg - 5) * 10, 0, 100))
    reasons.append(f"Slope at site {slope_deg:.1f}°")

    total = int(round(WEIGHTS["power"] * power + WEIGHTS["comms"] * comms + WEIGHTS["terrain"] * terrain))
    status = "green" if total >= GREEN else "yellow" if total >= YELLOW else "red"
    return Score(total=total, status=status, power=int(power), comms=int(comms), terrain=int(terrain), reasons=reasons)
