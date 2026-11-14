// Draw elevation + overlays onto a canvas (top-down, north up, not oblique). Owner: MAP.

/** Simple hillshade from a fixed light so terrain reads as 3D in 2D. */
function hillshade(grid: number[][], px: number, r: number, c: number) {
  const h = grid.length, w = grid[0].length;
  const z = (i: number, j: number) => grid[Math.min(h - 1, Math.max(0, i))][Math.min(w - 1, Math.max(0, j))];
  const dzdx = (z(r, c + 1) - z(r, c - 1)) / (2 * px);
  const dzdy = (z(r + 1, c) - z(r - 1, c)) / (2 * px);
  const shade = (1 - dzdx + dzdy) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
  return Math.max(0, Math.min(1, 0.5 + shade * 0.4));
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
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let v = hillshade(grid, pixel_m, r, c) * 255;
      let [R, G, B] = [v, v, v];
      if (opts.shadow && !opts.shadow[r][c]) [R, G, B] = [v * 0.15, v * 0.15, v * 0.3];
      if (opts.rims && opts.rims[r][c]) [R, G, B] = [255, 170, 60];
      const i = (r * w + c) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
