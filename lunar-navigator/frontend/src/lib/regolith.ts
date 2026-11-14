// Ground detail finer than the elevation data: an ESTIMATE, not a measurement. Owner: Visualization.
//
// Real lunar terrain below the DEM's resolution is dominated by small impact craters (their sizes
// follow a power law: many small, few large) plus gentle rolling of the regolith. We add both on top
// of the measured heights. Everything is seeded by position, so the same spot always looks the same.
// Fresh simple craters: depth ≈ 0.2 × diameter, rim ≈ 0.04 × diameter (Pike 1977).

const frac = (x: number) => x - Math.floor(x);

/** Deterministic 0…1 hash of an integer cell and a salt. */
function hash(ix: number, iy: number, salt: number) {
  return frac(Math.sin(ix * 127.1 + iy * 311.7 + salt * 74.7) * 43758.5453);
}

function valueNoise(x: number, y: number, salt: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy - 0.5;
}

/** Gentle rolling: ~±4 m over hundreds of metres, fading to ~±0.3 m bumps at 20 m. */
function rolling(e: number, n: number) {
  let z = 0, amp = 6, wl = 400;
  for (let o = 0; o < 5; o++) {
    z += amp * valueNoise(e / wl, n / wl, o);
    amp *= 0.5;
    wl *= 0.5;
  }
  return z;
}

// Crater layers: cell size (m), chance a cell holds a crater, diameter range (m).
const LAYERS = [
  { cell: 45, p: 0.7, dMin: 15, dMax: 50, salt: 11 }, // smallest ≈ 2 mesh cells across at 7.5 m spacing
  { cell: 260, p: 0.45, dMin: 45, dMax: 160, salt: 23 },
];

function craterHeight(r: number, D: number) {
  const depth = 0.2 * D, rim = 0.04 * D;
  if (r < 1) return (rim + depth) * r * r - depth;
  return r < 3 ? rim * r ** -3 : 0;
}

function craters(e: number, n: number) {
  let z = 0;
  for (const L of LAYERS) {
    const cx = Math.floor(e / L.cell), cy = Math.floor(n / L.cell);
    const reach = Math.ceil((1.5 * L.dMax) / L.cell);
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const gx = cx + i, gy = cy + j;
        if (hash(gx, gy, L.salt) > L.p) continue;
        // power-law size: many small, few large
        const D = L.dMin * (L.dMax / L.dMin) ** (hash(gx, gy, L.salt + 1) ** 2.2);
        const px = (gx + hash(gx, gy, L.salt + 2)) * L.cell, py = (gy + hash(gx, gy, L.salt + 3)) * L.cell;
        const r = Math.hypot(e - px, n - py) / (D / 2);
        if (r < 3) z += craterHeight(r, D) * (0.5 + 0.5 * hash(gx, gy, L.salt + 4)); // older craters are shallower
      }
    }
  }
  return z;
}

/** Estimated extra height (m) at east/north (m from the site). */
export const detail = (e: number, n: number) => rolling(e, n) + craters(e, n);

/** Bilinear height (m) from a backend tile: row 0 = north edge, col 0 = west edge, site at the centre. */
export function sampleTile(grid: number[][], sizeM: number, e: number, n: number) {
  const m = grid.length, px = sizeM / (m - 1), half = sizeM / 2;
  const c = Math.max(0, Math.min(m - 1.0001, (e + half) / px));
  const r = Math.max(0, Math.min(m - 1.0001, (half - n) / px));
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
  return (grid[r0][c0] * (1 - fc) + grid[r0][c0 + 1] * fc) * (1 - fr) + (grid[r0 + 1][c0] * (1 - fc) + grid[r0 + 1][c0 + 1] * fc) * fr;
}
