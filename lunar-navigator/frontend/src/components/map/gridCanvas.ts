import type { LitRelief } from "../../types";
import { contours } from "../../lib/topo";

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

/** Bilinear sample of a row-major grid at fractional cell coordinates (cell centres at integers), clamped at the edges. */
function bilinear(get: (r: number, c: number) => number, h: number, w: number, y: number, x: number) {
  const yc = Math.min(h - 1, Math.max(0, y)), xc = Math.min(w - 1, Math.max(0, x));
  const r0 = Math.floor(yc), c0 = Math.floor(xc);
  const r1 = Math.min(h - 1, r0 + 1), c1 = Math.min(w - 1, c0 + 1);
  const fy = yc - r0, fx = xc - c0;
  const top = get(r0, c0) * (1 - fx) + get(r0, c1) * fx;
  const bottom = get(r1, c0) * (1 - fx) + get(r1, c1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Sample a 0/1 mask of any size at a position given as a fraction (0..1) of the tile; returns 0..1 (soft at edges). */
function maskAt(m: number[][], u: number, v: number) {
  const h = m.length, w = m[0].length;
  return bilinear((r, c) => (m[r][c] ? 1 : 0), h, w, v * h - 0.5, u * w - 0.5);
}

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function drawGrid(
  canvas: HTMLCanvasElement,
  grid: number[][],
  pixel_m: number,
  opts: {
    shadow?: number[][];
    rims?: number[][];
    trekCanvas?: HTMLCanvasElement | null;
    /** Draw at this many pixels across (smoothly resampled) instead of one pixel per grid cell. */
    outPx?: number;
  } = {},
) {
  if (opts.outPx && opts.outPx !== grid[0].length) return drawGridResampled(canvas, grid, pixel_m, { ...opts, outPx: opts.outPx });
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

/**
 * Same picture as drawGrid, rendered at `outPx` across: terrain shading and imagery are interpolated smoothly,
 * and shadow / rim masks (which may be coarser than the elevation grid) get soft, anti-aliased edges
 * instead of blocky cells.
 */
function drawGridResampled(
  canvas: HTMLCanvasElement,
  grid: number[][],
  pixel_m: number,
  opts: { shadow?: number[][]; rims?: number[][]; trekCanvas?: HTMLCanvasElement | null; outPx: number },
) {
  const h = grid.length, w = grid[0].length, N = opts.outPx;
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d")!;

  const shade = new Float32Array(h * w);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) shade[r * w + c] = hillshade(grid, pixel_m, r, c);
  const shadeAt = (r: number, c: number) => shade[r * w + c];

  let trekData: Uint8ClampedArray | null = null;
  if (opts.trekCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(opts.trekCanvas, 0, 0, N, N);
    trekData = ctx.getImageData(0, 0, N, N).data;
  }

  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const i = (y * N + x) * 4;
      const hs = bilinear(shadeAt, h, w, v * h - 0.5, u * w - 0.5);
      let R: number, G: number, B: number;
      if (trekData) {
        const blend = 0.72 + hs * 0.45;
        R = Math.min(255, trekData[i] * blend);
        G = Math.min(255, trekData[i + 1] * blend);
        B = Math.min(255, trekData[i + 2] * blend);
      } else {
        R = G = B = hs * 255;
      }
      if (opts.shadow) {
        const dark = 1 - smoothstep(0.3, 0.7, maskAt(opts.shadow, u, v)); // 1 = fully in shadow
        if (dark > 0) {
          R += (R * 0.18 - R) * dark;
          G += (G * 0.22 - G) * dark;
          B += (Math.min(255, 16 + B * 0.38) - B) * dark;
        }
      }
      if (opts.rims) {
        const a = 0.7 * smoothstep(0.3, 0.7, maskAt(opts.rims, u, v)); // translucent: terrain stays visible
        if (a > 0) {
          R += (255 - R) * a;
          G += (170 - G) * a;
          B += (60 - B) * a;
        }
      }
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** True when a 0/1 mask has no cells set (e.g. no rims in this tile). */
export const isEmptyMask = (m?: number[][] | null) => !!m && m.every((row) => row.every((v) => !v));

/** Decode a LitRelief into lit flags (1/0) and brightness (0..127), row-major. */
export function decodeLitRelief(r: LitRelief) {
  const bin = atob(r.data), n = r.res;
  const lit = new Uint8Array(n * n), v = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const b = bin.charCodeAt(i);
    lit[i] = b & 128 ? 1 : 0;
    v[i] = b & 127;
  }
  return { n, lit, v };
}

/** Lit flags as rows of 0/1 (for hover readouts). */
export function litRows(r: LitRelief): number[][] {
  const { n, lit } = decodeLitRelief(r);
  return Array.from({ length: n }, (_, row) => Array.from(lit.subarray(row * n, row * n + n)));
}

/**
 * Paint a LitRelief the way the 2D polar map does, smoothly scaled to `outPx` across.
 * - "shadows": warm sunlit ground and cold blue shadow (the 2D map's lit-map palette).
 * - "photo": neutral grey, near-black shadows: roughly what a camera would see at that moment.
 */
export function drawLitRelief(canvas: HTMLCanvasElement, r: LitRelief, outPx: number, mode: "photo" | "shadows") {
  const { n, lit, v } = decodeLitRelief(r);
  const src = document.createElement("canvas");
  src.width = n;
  src.height = n;
  const sctx = src.getContext("2d")!;
  const img = sctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const k = i * 4;
    if (mode === "shadows") {
      if (lit[i]) {
        const g = 55 + v[i] * 1.55;
        img.data[k] = Math.min(255, g * 1.08); img.data[k + 1] = g; img.data[k + 2] = g * 0.84;
      } else {
        const g = v[i] * 2.4;
        img.data[k] = g * 0.55; img.data[k + 1] = g * 0.68; img.data[k + 2] = 18 + g;
      }
    } else {
      const g = lit[i] ? 60 + v[i] * 1.5 : 6 + v[i] * 0.9;
      img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = g;
    }
    img.data[k + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  canvas.width = outPx;
  canvas.height = outPx;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, outPx, outPx);
}

/** SVG path (grid units, 0…n−1) tracing the edge between sunlight and shadow. */
export function sunEdgePath(r: LitRelief): { d: string; n: number } {
  const { n, lit } = decodeLitRelief(r);
  return { d: contours(Float64Array.from(lit), n, [0.5])[0], n };
}
