"""Fetch NASA's 80 m LOLA south-pole DEM once, so real terrain works without a manual 2.7 GB download. Owner: TERRAIN.

When no DEM is present (see terrain._dem_path), the server downloads LDEM_80S_80M (115.5 MB, 80 m/px, 80°S → pole)
from NASA's Planetary Data System in a background thread, converts it to the GeoTIFF the terrain code reads
(heights in metres above the 1737.4 km sphere, with overviews), and moves it into data/dem/ in one step.
Until then, and if anything fails, the app keeps using synthetic terrain. Nothing happens if a DEM already
exists (e.g. the 20 m LDEM_80S_20MPP_ADJ file). Set LUNAR_DEM_AUTO_DOWNLOAD=0 to turn this off.
"""
from __future__ import annotations

import logging
import os
import shutil
import threading
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.windows import Window

from app.services import terrain

log = logging.getLogger(__name__)

PDS_BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img"
FILES = {"LDEM_80S_80M.LBL": None, "LDEM_80S_80M.IMG": 7600 * 7600 * 2}
OUT_NAME = "ldem_80s_80m.tif"
_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("LUNAR_DEM_AUTO_DOWNLOAD", "1") != "0"


def convert_to_geotiff(src_path: Path, out_path: Path, rows_per_chunk: int = 512) -> None:
    """Copy a single-band elevation raster to a tiled float32 GeoTIFF in metres (applies the source's
    scale factor, ignores its offset, so heights are relative to the reference sphere), with overviews."""
    with rasterio.open(src_path) as src:
        if src.count != 1 or src.crs is None:
            raise ValueError(f"expected one elevation band with a coordinate system: {src_path}")
        scale = src.scales[0] or 1.0
        nodata = src.nodata
        profile = dict(driver="GTiff", width=src.width, height=src.height, count=1, dtype="float32",
                       crs=src.crs, transform=src.transform, nodata=float("nan"), tiled=True,
                       blockxsize=512, blockysize=512, compress="deflate", predictor=3)
        with rasterio.open(out_path, "w", **profile) as dst:
            for row in range(0, src.height, rows_per_chunk):
                win = Window(0, row, src.width, min(rows_per_chunk, src.height - row))
                dn = src.read(1, window=win)
                z = dn.astype(np.float32) * np.float32(scale)
                if nodata is not None:
                    z[dn == nodata] = np.nan
                dst.write(z, 1, window=win)
            dst.build_overviews([2, 4, 8, 16, 32], Resampling.average)
            dst.update_tags(ns="rio_overview", resampling="average")


def _download(url: str, out: Path, size: int | None) -> None:
    """Download to `<out>.part`, then rename: an interrupted download never leaves a file that looks complete."""
    part = out.with_name(out.name + ".part")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        expected = size or int(r.headers.get("content-length") or 0) or None
        with open(part, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    got = part.stat().st_size
    if expected is not None and got != expected:
        part.unlink(missing_ok=True)
        raise ValueError(f"{out.name}: got {got} bytes, expected {expected}")
    part.replace(out)


def fetch_if_missing() -> bool:
    """Download + convert the 80 m DEM unless a DEM already exists. Returns True if a DEM is available after."""
    if not _lock.acquire(blocking=False):
        return False  # another fetch is running
    try:
        if terrain._dem_path() is not None:
            return True
        terrain.DEM_DIR.mkdir(parents=True, exist_ok=True)
        work = terrain.DEM_DIR / ".download"  # not a .tif, so the app never reads it half-written
        work.mkdir(exist_ok=True)
        log.info("No terrain DEM found; downloading NASA LOLA 80 m south-pole DEM (115 MB) in the background")
        for name, size in FILES.items():
            target = work / name  # only ever present when fully downloaded (see _download)
            if not (target.exists() and (size is None or target.stat().st_size == size)):
                _download(f"{PDS_BASE}/{name}", target, size)
        tmp = work / "converted.tif.part"
        try:
            convert_to_geotiff(work / "LDEM_80S_80M.LBL", tmp)
        except Exception:
            shutil.rmtree(work, ignore_errors=True)  # bad inputs: start clean next time instead of failing forever
            raise
        tmp.replace(terrain.DEM_DIR / OUT_NAME)  # atomic: appears complete or not at all
        shutil.rmtree(work, ignore_errors=True)
        log.info("Real LOLA terrain ready: %s", terrain.DEM_DIR / OUT_NAME)
        return True
    except Exception:  # never take the server down over optional data
        log.exception("Could not fetch the LOLA DEM; continuing with synthetic terrain")
        return False
    finally:
        _lock.release()


def start_background_fetch() -> None:
    try:
        missing = terrain._dem_path() is None
    except Exception:  # e.g. several DEM files present: leave that for the terrain code to report
        return
    if enabled() and missing:
        threading.Thread(target=fetch_if_missing, name="dem-fetch", daemon=True).start()
