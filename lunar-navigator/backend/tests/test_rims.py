"""Rim detection: absolute curvature rule (with pixel size) and the older relative fallback."""
import numpy as np

from app.services import terrain


def _crater(res=128, size_km=20.0):
    return terrain._synthetic_crater(size_km, res), terrain.pixel_size_m(size_km, res)


def test_flat_tile_has_no_rims():
    grid = np.zeros((128, 128))
    assert terrain.rim_mask(grid, terrain.pixel_size_m(20, 128)).sum() == 0


def test_crater_rim_found_near_its_radius():
    grid, px = _crater()
    mask = terrain.rim_mask(grid, px)
    assert mask.any()
    rows, cols = np.nonzero(mask)
    c = (grid.shape[0] - 1) / 2
    r_km = np.hypot(rows - c, cols - c) * px / 1000
    # the synthetic crater's rim sits at 30 % of the 20 km tile = 6 km from the centre
    assert abs(np.median(r_km) - 6.0) < 1.5


def test_border_is_ignored():
    grid, px = _crater()
    mask = terrain.rim_mask(grid, px)
    assert mask[0].sum() == mask[-1].sum() == mask[:, 0].sum() == mask[:, -1].sum() == 0


def test_without_pixel_size_keeps_old_relative_rule():
    grid, _ = _crater()
    share = terrain.rim_mask(grid).mean()
    assert 0.06 < share < 0.10  # top 8 % most convex cells, as before
