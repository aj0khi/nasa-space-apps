"""Automatic DEM fetch: conversion, skip-if-present, atomic hand-off, opt-out. No network: downloads are mocked."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.services import dem_fetch, terrain

CRS = "+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m +no_defs"


def _write_pds_like(path, dn):
    """Small int16 raster with the LOLA product's encoding: height = DN × 0.5 m, nodata = -32768."""
    with rasterio.open(path, "w", driver="GTiff", width=dn.shape[1], height=dn.shape[0], count=1, dtype="int16",
                       crs=CRS, transform=from_origin(-1000, 1000, 80, 80), nodata=-32768) as d:
        d.write(dn, 1)
        d.scales = (0.5,)
        d.offsets = (1737400.0,)


@pytest.fixture
def dem_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(terrain, "DEM_DIR", tmp_path / "dem")
    monkeypatch.setattr(terrain, "LOCAL_DEM", tmp_path / "absent.tiff")
    return tmp_path / "dem"


def test_convert_applies_scale_and_nodata(tmp_path):
    dn = np.arange(64 * 64, dtype=np.int16).reshape(64, 64)
    dn[0, 0] = -32768
    src = tmp_path / "src.tif"
    _write_pds_like(src, dn)
    out = tmp_path / "out.tif"
    dem_fetch.convert_to_geotiff(src, out, rows_per_chunk=10)  # several chunks, uneven last one
    with rasterio.open(out) as d:
        z = d.read(1)
        assert d.dtypes[0] == "float32" and d.crs is not None
        assert d.transform == from_origin(-1000, 1000, 80, 80)
        assert d.overviews(1)
    assert np.isnan(z[0, 0])
    assert z[0, 1] == 0.5 and z[63, 63] == pytest.approx(0.5 * (64 * 64 - 1))


def test_fetch_downloads_converts_and_moves_into_place(dem_dir, monkeypatch):
    monkeypatch.setattr(dem_fetch, "FILES", {"LDEM_80S_80M.LBL": None})
    calls = []

    def fake_download(url, out, size):
        calls.append(url)
        _write_pds_like(out, np.full((32, 32), 200, dtype=np.int16))

    monkeypatch.setattr(dem_fetch, "_download", fake_download)
    assert terrain._dem_path() is None
    assert dem_fetch.fetch_if_missing() is True
    assert calls == [f"{dem_fetch.PDS_BASE}/LDEM_80S_80M.LBL"]
    assert terrain._dem_path() == dem_dir / dem_fetch.OUT_NAME
    assert not (dem_dir / ".download").exists()
    with rasterio.open(terrain._dem_path()) as d:
        assert float(d.read(1).mean()) == 100.0


def test_fetch_skips_when_a_dem_exists(dem_dir, monkeypatch):
    dem_dir.mkdir()
    _write_pds_like(dem_dir / "existing.tif", np.zeros((8, 8), dtype=np.int16))
    monkeypatch.setattr(dem_fetch, "_download", lambda *a: pytest.fail("must not download"))
    assert dem_fetch.fetch_if_missing() is True
    assert sorted(p.name for p in dem_dir.iterdir()) == ["existing.tif"]


def test_failed_download_leaves_no_dem(dem_dir, monkeypatch):
    def boom(*a):
        raise OSError("network down")

    monkeypatch.setattr(dem_fetch, "_download", boom)
    assert dem_fetch.fetch_if_missing() is False
    assert terrain._dem_path() is None


def test_opt_out(dem_dir, monkeypatch):
    monkeypatch.setenv("LUNAR_DEM_AUTO_DOWNLOAD", "0")
    started = []
    monkeypatch.setattr(dem_fetch.threading, "Thread", lambda **kw: started.append(kw) or pytest.fail("started"))
    dem_fetch.start_background_fetch()
    assert started == []


class _Resp:
    """Minimal stand-in for a streamed requests response."""
    def __init__(self, chunks, length=None):
        self.chunks, self.headers = chunks, ({"content-length": str(length)} if length else {})
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def raise_for_status(self): pass
    def iter_content(self, _n):
        for c in self.chunks:
            if isinstance(c, Exception):
                raise c
            yield c


def test_interrupted_download_leaves_nothing_that_looks_complete(tmp_path, monkeypatch):
    out = tmp_path / "LDEM_80S_80M.LBL"
    monkeypatch.setattr(dem_fetch.requests, "get", lambda *a, **k: _Resp([b"abc", ConnectionError("cut")]))
    with pytest.raises(ConnectionError):
        dem_fetch._download("http://x", out, None)
    assert not out.exists()


def test_short_download_is_rejected_by_content_length(tmp_path, monkeypatch):
    out = tmp_path / "LDEM_80S_80M.LBL"
    monkeypatch.setattr(dem_fetch.requests, "get", lambda *a, **k: _Resp([b"abc"], length=10))
    with pytest.raises(ValueError):
        dem_fetch._download("http://x", out, None)
    assert not out.exists() and not (tmp_path / "LDEM_80S_80M.LBL.part").exists()


def test_complete_download_is_renamed_into_place(tmp_path, monkeypatch):
    out = tmp_path / "LDEM_80S_80M.LBL"
    monkeypatch.setattr(dem_fetch.requests, "get", lambda *a, **k: _Resp([b"ab", b"c"], length=3))
    dem_fetch._download("http://x", out, None)
    assert out.read_bytes() == b"abc"


def test_bad_input_is_cleared_so_the_next_start_retries(dem_dir, monkeypatch):
    monkeypatch.setattr(dem_fetch, "FILES", {"LDEM_80S_80M.LBL": None})
    monkeypatch.setattr(dem_fetch, "_download", lambda url, out, size: out.write_bytes(b"not a raster"))
    assert dem_fetch.fetch_if_missing() is False
    assert not (dem_dir / ".download").exists() and terrain._dem_path() is None
