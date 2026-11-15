"""Lit relief on hand-made terrain (no DEM needed): shadows, far shadows, slope brightness, encoding."""
import numpy as np
import pytest

from app.services import terrain

N, SIZE = 65, 20.0
PX = terrain.pixel_size_m(SIZE, N)


@pytest.fixture
def tiles(monkeypatch):
    """Replace the elevation source with given tile / wide grids."""
    def use(tile, wide=None, wide_size=SIZE + 2 * terrain.LIGHT_REACH_KM):
        wide_res = None if wide is None else wide.shape[0]
        monkeypatch.setattr(terrain, "_lighting_grids", lambda *a: (
            tile, PX, wide, 0.0 if wide is None else terrain.pixel_size_m(wide_size, wide_res),
            wide_size * 500.0, True))
    return use


def lit(out):
    return (out & 128) > 0


def test_flat_ground_is_lit_and_sun_below_horizon_is_dark(tiles):
    tiles(np.zeros((N, N)))
    out, frac, *_ = terrain.lit_relief(-85, 0, 2.0, 90, SIZE, N)
    assert out.shape == (N, N) and out.dtype == np.uint8 and frac == 1.0
    out, frac, *_ = terrain.lit_relief(-85, 0, -2.0, 90, SIZE, N)
    assert frac == 0.0


def test_ridge_shadows_the_side_away_from_the_sun(tiles):
    g = np.zeros((N, N))
    g[:, N // 2 - 1: N // 2 + 2] = 500.0  # north-south wall, 500 m high, ~0.9 km thick, through the centre
    tiles(g)
    out, *_ = terrain.lit_relief(-85, 0, 5.0, 90, SIZE, N)  # Sun in the east
    west, east = lit(out)[:, : N // 2 - 1], lit(out)[:, N // 2 + 2:]
    assert east.all()
    # 500 m / tan(5°) ≈ 5.7 km of shadow west of the wall
    shadow_cols = (~west).all(axis=0).sum()
    assert abs(shadow_cols * PX / 1000 - 5.7) < 1.0


def test_mountain_outside_the_tile_casts_shadow(tiles):
    wn = 129
    wide_size = SIZE + 2 * terrain.LIGHT_REACH_KM
    wide = np.zeros((wn, wn))
    wpx = terrain.pixel_size_m(wide_size, wn)
    col = int((wn - 1) / 2 + 15_000 / wpx)  # 15 km east of the site, outside the 20 km tile
    wide[:, col - 1: col + 2] = 3000.0
    tiles(np.zeros((N, N)), wide, wide_size)
    out, frac, _, reach = terrain.lit_relief(-85, 0, 3.0, 90, SIZE, N)
    assert reach == terrain.LIGHT_REACH_KM and frac < 0.2


def test_slopes_facing_the_sun_are_brighter(tiles):
    x = np.linspace(-1, 1, N)
    g = np.tile(np.where(x < 0, 0.0, 400 * x), (N, 1))  # flat west half, slope rising to the east
    tiles(g)
    # ground rising toward the east faces west
    out, *_ = terrain.lit_relief(-85, 0, 10.0, 90, SIZE, N)  # Sun in the east: the slope faces away
    away = (out[N // 2, 3 * N // 4] & 127)
    out, *_ = terrain.lit_relief(-85, 0, 10.0, 270, SIZE, N)  # Sun in the west: the slope faces it
    toward = (out[N // 2, 3 * N // 4] & 127)
    assert toward > away
