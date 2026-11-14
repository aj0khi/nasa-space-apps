// Draw elevation + overlays onto a canvas (top-down, north up, not oblique). Owner: MAP.
//
// Relief shading that stays readable on gentle ground too:
//   1. light from the north-west, 30° up (like a relief map), slopes exaggerated ×3 for the shading only
//   2. contrast stretched to this tile's own range (a 3° plain and a 40° crater wall both get full contrast)
//   3. blended with a height tint: low ground darker, high ground lighter

const LIGHT_ALT = (30 * Math.PI) / 180;
const LIGHT = { x: -Math.SQRT1_2 * Math.cos(LIGHT_ALT), y: -Math.SQRT1_2 * Math.cos(LIGHT_ALT), z: Math.sin(LIGHT_ALT) }; // x = east, y = south (row +)
const SHADE_EXAGGERATION = 3;

/** Brightness 0..1 for every cell. */
export function reliefShade(grid: number[][], pixel_m: number): Float32Array {
  const h = grid.length, w = grid[0].length;
  const z = (i: number, j: number) => grid[Math.min(h - 1, Math.max(0, i))][Math.min(w - 1, Math.max(0, j))];
  const shade = new Float32Array(h * w);
  let sMin = Infinity, sMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const dzdx = ((z(r, c + 1) - z(r, c - 1)) / (2 * pixel_m)) * SHADE_EXAGGERATION;
      const dzdy = ((z(r + 1, c) - z(r - 1, c)) / (2 * pixel_m)) * SHADE_EXAGGERATION;
      const s = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
      shade[r * w + c] = s;
      if (s < sMin) sMin = s;
      if (s > sMax) sMax = s;
      const e = grid[r][c];
      if (e < zMin) zMin = e;
      if (e > zMax) zMax = e;
    }
  }
  const sSpan = sMax - sMin, zSpan = zMax - zMin;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const s = sSpan > 1e-6 ? (shade[i] - sMin) / sSpan : 0.6;
      const t = zSpan > 1e-6 ? (grid[r][c] - zMin) / zSpan : 0.5;
      shade[i] = 0.18 + 0.77 * (0.72 * s + 0.28 * t);
    }
  }
  return shade;
}

export function drawGrid(
  canvas: HTMLCanvasElement,
  grid: number[][],
  pixel_m: number,
  opts: { shadow?: number[][]; rims?: number[][] } = {},
) {
  const h = grid.length, w = grid[0].length;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const shade = reliefShade(grid, pixel_m);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = shade[r * w + c] * 255;
      let [R, G, B] = [v, v, v];
      if (opts.shadow && !opts.shadow[r][c]) [R, G, B] = [v * 0.15, v * 0.15, v * 0.3];
      if (opts.rims && opts.rims[r][c]) [R, G, B] = [255, 170, 60];
      const i = (r * w + c) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** True when a 0/1 mask has no cells set (e.g. no rims in this tile). */
export const isEmptyMask = (m?: number[][]) => !!m && m.every((row) => row.every((v) => !v));
