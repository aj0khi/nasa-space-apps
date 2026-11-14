"""Download NASA's LOLA south-pole elevation map (run once per machine). Owner: TERRAIN.

    cd lunar-navigator/backend && .venv/bin/python scripts/get_lola_dem.py

Fetches LDEM_80S_80M.IMG (115.5 MB) + its label from NASA's Planetary Data System into data/dem/.
Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter (LOLA) gridded data: 80 m/pixel,
80°S → pole, polar stereographic, 16-bit heights × 0.5 m above the 1737.4 km sphere.
The file is git-ignored. Without it the app falls back to the synthetic terrain model.
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img"
DEST = Path(__file__).resolve().parents[1] / "data" / "dem"
FILES = [("LDEM_80S_80M.LBL", "ldem_80s_80m.lbl", None), ("LDEM_80S_80M.IMG", "ldem_80s_80m.img", 7600 * 7600 * 2)]


def fetch(remote: str, local: str, size: int | None) -> None:
    out = DEST / local
    if out.exists() and (size is None or out.stat().st_size == size):
        print(f"✓ {local} already downloaded")
        return
    part = out.with_suffix(out.suffix + ".part")
    with requests.get(f"{BASE}/{remote}", stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0)) or size or 0
        done = 0
        with open(part, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {local}: {done / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
    print()
    if size is not None and part.stat().st_size != size:
        part.unlink()
        sys.exit(f"✗ {local}: unexpected size, download again")
    part.rename(out)
    print(f"✓ {local}")


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for remote, local, size in FILES:
        fetch(remote, local, size)
    print("Done. Restart the backend to use the real terrain.")
