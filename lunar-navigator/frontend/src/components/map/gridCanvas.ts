// Draw elevation + NASA Moon Trek satellite imagery + overlays onto a canvas (top-down, north up). Owner: MAP.

/** Simple hillshade from a fixed light so terrain reads as 3D in 2D when offline. */
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
  opts: { shadow?: number[][]; rims?: number[][]; trekCanvas?: HTMLCanvasElement | null } = {},
) {
  const h = grid.length, w = grid[0].length;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  let trekData: Uint8ClampedArray | null = null;
  if (opts.trekCanvas) {
    ctx.drawImage(opts.trekCanvas, 0, 0, w, h);
    trekData = ctx.getImageData(0, 0, w, h).data;
  }

  const img = ctx.createImageData(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = (r * w + c) * 4;
      const hs = hillshade(grid, pixel_m, r, c);
      let R: number, G: number, B: number;
      if (trekData) {
        // Blend real NASA Moon Trek imagery with subtle local slope hillshade
        const blend = 0.72 + hs * 0.45;
        R = Math.min(255, trekData[i] * blend);
        G = Math.min(255, trekData[i + 1] * blend);
        B = Math.min(255, trekData[i + 2] * blend);
      } else {
        const v = hs * 255;
        R = v;
        G = v;
        B = v;
      }

      if (opts.shadow && !opts.shadow[r][c]) {
        R = R * 0.18;
        G = G * 0.22;
        B = Math.min(255, 16 + B * 0.38);
      }
      if (opts.rims && opts.rims[r][c]) {
        R = 255;
        G = 170;
        B = 60;
      }
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
