// NASA Moon Trek WMTS Integration (https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon)
// Provides official OGC RESTful WMTS tile pyramids for:
//   - South Polar Stereographic (IAU2000:30120, /tiles/Moon/SP/...)
//   - Global Equirectangular (EPSG:104903, /tiles/Moon/EQ/...)

import { project, R_MOON_KM } from "./geo";

export type TrekLayerId = "wac" | "lola_shade" | "lola_color" | "lola_slope" | "none";

export interface TrekLayerSpec {
  id: TrekLayerId;
  label: string;
  shortLabel: string;
  title: string;
  productLabel: string;
   fallbackProductLabel?: string;
  maxZoom: number;
  /** Maximum polar stereographic radius (km) covered by primary productLabel */
  coverageRadiusKm: number;
  ext: "png" | "jpg";
  attribution: string;
}

/**
 * In NASA Moon Trek's South Polar (`SP`) `default028mm` TileMatrixSet:
 * - `TopLeftCorner` is `(-1095930 m, +1095930 m)` = `(-1095.93 km, +1095.93 km)`
 * - At zoom level `z`, a `2^z × 2^z` grid of 256×256 px tiles spans `[-1095.93, +1095.93]` km in X and Y.
 * - Because our SVG map uses `x = r·sin(lon)` (+X right) and `y = -r·cos(lon)` (-Y up = +Northing),
 *   SVG `(x, y)` in km maps 1:1 to Moon Trek tile coordinates!
 */
export const SP_TOP_LEFT_KM = 1095.93;
export const SP_FULL_SPAN_KM = SP_TOP_LEFT_KM * 2; // 2191.86 km

export const TREK_SP_LAYERS: Record<Exclude<TrekLayerId, "none">, TrekLayerSpec> = {
  wac: {
    id: "wac",
    label: "LROC WAC Optical Photo",
    shortLabel: "WAC Photo",
    title: "LRO LROC Wide Angle Camera Mosaic (100 m/px)",
    productLabel: "LRO_WAC_Mosaic_SPole60_100mp",
    maxZoom: 4,
    coverageRadiusKm: 931.1, // 60°S to 90°S
    ext: "png",
    attribution: "NASA / GSFC / ASU / Moon Trek (LROC WAC)",
  },
  lola_shade: {
    id: "lola_shade",
    label: "LOLA Laser Hillshade (30m)",
    shortLabel: "LOLA Hillshade",
    title: "LRO LOLA DEM South Pole Shaded Relief (30 m/px)",
    productLabel: "LRO_LOLA_Shade_SPole75_30mp_v04",
    fallbackProductLabel: "LRO_LOLA_Shade_SPole45_100mp_v04",
    maxZoom: 6,
    coverageRadiusKm: 457.44, // 75°S to 90°S (fallback covers 45°S to 90°S)
    ext: "png",
    attribution: "NASA / GSFC / MIT / Moon Trek (LRO LOLA)",
  },
  lola_color: {
    id: "lola_color",
    label: "LOLA Color Elevation (30m)",
    shortLabel: "Color Elevation",
    title: "LRO LOLA DEM Colorized Elevation Hillshade (30 m/px)",
    productLabel: "LRO_LOLA_ClrShade_SPole75_30mp_v04",
    fallbackProductLabel: "LRO_LOLA_ClrShade_SPole45_100mp_v04",
    maxZoom: 6,
    coverageRadiusKm: 457.44,
    ext: "png",
    attribution: "NASA / GSFC / MIT / Moon Trek (LRO LOLA)",
  },
  lola_slope: {
    id: "lola_slope",
    label: "LOLA Slope Hazard (120m)",
    shortLabel: "Slope Map",
    title: "LRO LOLA South Pole Colorized Slope (120 m/px)",
    productLabel: "LRO_LOLA_ClrSlope_SPole75S_120m",
    maxZoom: 4,
    coverageRadiusKm: 457.44,
    ext: "png",
    attribution: "NASA / GSFC / MIT / Moon Trek (LRO LOLA Slope)",
  },
};

export interface PolarTile {
  key: string;
  url: string;
  z: number;
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
}

export function spTileUrl(productLabel: string, z: number, row: number, col: number, ext: "png" | "jpg" = "png"): string {
  return `https://trek.nasa.gov/tiles/Moon/SP/${productLabel}/1.0.0/default/default028mm/${z}/${row}/${col}.${ext}`;
}

export function eqTileUrl(z: number, row: number, col: number): string {
  return `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`;
}

/**
 * Computes the WMTS tiles to render in `SouthPoleMap.tsx` for the active viewport `{ cx, cy, half }`.
 * Returns both a low-resolution base grid (`z = 1`) for instant coverage and the target zoom level (`z = 1..6`).
 */
export function getVisiblePolarTiles(
  layerId: TrekLayerId,
  view: { cx: number; cy: number; half: number },
  outerKm: number,
): PolarTile[] {
  if (layerId === "none") return [];
  const spec = TREK_SP_LAYERS[layerId];

  // Pick zoom level so each 256px tile is roughly 180-360 screen pixels wide
  // Visible viewport width is `2 * view.half` km; on a ~768px canvas we want ~3-4 tiles across
  const desiredTileSpanKm = (2 * view.half) / 2.6;
  const rawZ = Math.round(Math.log2(SP_FULL_SPAN_KM / Math.max(15, desiredTileSpanKm)));
  const targetZ = Math.max(1, Math.min(spec.maxZoom, rawZ));

  const buildGrid = (z: number, productLabel: string, maxRadiusKm: number, maxZForProduct: number): PolarTile[] => {
    const clampedZ = Math.min(z, maxZForProduct);
    const n = 1 << clampedZ;
    const span = SP_FULL_SPAN_KM / n;

    const minX = Math.max(-outerKm, view.cx - view.half);
    const maxX = Math.min(outerKm, view.cx + view.half);
    const minY = Math.max(-outerKm, view.cy - view.half);
    const maxY = Math.min(outerKm, view.cy + view.half);

    const c0 = Math.max(0, Math.floor((minX + SP_TOP_LEFT_KM) / span));
    const c1 = Math.min(n - 1, Math.floor((maxX + SP_TOP_LEFT_KM) / span));
    const r0 = Math.max(0, Math.floor((minY + SP_TOP_LEFT_KM) / span));
    const r1 = Math.min(n - 1, Math.floor((maxY + SP_TOP_LEFT_KM) / span));

    const out: PolarTile[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = -SP_TOP_LEFT_KM + c * span;
        const y = -SP_TOP_LEFT_KM + r * span;
        // Closest distance from tile square [x, x+span] × [y, y+span] to the South Pole (0, 0)
        const nearX = Math.max(x, Math.min(0, x + span));
        const nearY = Math.max(y, Math.min(0, y + span));
        const distFromPole = Math.hypot(nearX, nearY);
        if (distFromPole > Math.min(outerKm * 1.05, maxRadiusKm)) continue;

        out.push({
          key: `${productLabel}-${clampedZ}-${r}-${c}`,
          url: spTileUrl(productLabel, clampedZ, r, c, spec.ext),
          z: clampedZ,
          row: r,
          col: c,
          x,
          y,
          size: span,
        });
      }
    }
    return out;
  };

  const tiles: PolarTile[] = [];

  // If zoomed out to 70°S (outerKm > 457 km) and using a 75°S LOLA layer, include the 45°S fallback backdrop
  if (spec.fallbackProductLabel) {
    tiles.push(...buildGrid(Math.min(targetZ, 3), spec.fallbackProductLabel, 1095.93, 4));
  } else {
    // Low-zoom z=1 base tiles so zooming/panning never flashes empty space
    if (targetZ > 1) {
      tiles.push(...buildGrid(1, spec.productLabel, spec.coverageRadiusKm, spec.maxZoom));
    }
  }

  tiles.push(...buildGrid(targetZ, spec.productLabel, spec.coverageRadiusKm, spec.maxZoom));
  return tiles;
}

// In-memory HTMLImageElement cache so tiles shared across 2D Map, LocalMap, and 3D views load once
const _IMG_CACHE = new Map<string, Promise<HTMLImageElement>>();

export function loadTileImage(url: string): Promise<HTMLImageElement> {
  const existing = _IMG_CACHE.get(url);
  if (existing) return existing;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      _IMG_CACHE.delete(url);
      reject(err);
    };
    img.src = url;
  });
  _IMG_CACHE.set(url, p);
  return p;
}

/**
 * Renders a real NASA Moon Trek satellite image for a `sizeKm × sizeKm` patch centered at `(lat, lon)`,
 * oriented with **local North at the top (`-row`) and local East at the right (`+col`)** to match
 * `LocalMap.tsx` and `Surface3D.tsx`.
 */
export async function renderSiteTrekCanvas(
  lat: number,
  lon: number,
  sizeKm = 20,
  layerId: Exclude<TrekLayerId, "none"> = "wac",
  canvasPx = 512,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasPx;
  canvas.height = canvasPx;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1b1e26";
  ctx.fillRect(0, 0, canvasPx, canvasPx);

  // Polar stereographic coverage for South Pole region (south of -60°)
  if (lat <= -60) {
    const center = project(lat, lon);
    const distFromPole = Math.hypot(center.x, center.y);
    const spec = TREK_SP_LAYERS[layerId];
    const product =
      distFromPole <= spec.coverageRadiusKm
        ? spec.productLabel
        : spec.fallbackProductLabel || TREK_SP_LAYERS.wac.productLabel;
    const z = product === spec.productLabel ? Math.min(spec.maxZoom, 5) : 4;
    const n = 1 << z;
    const spanKm = SP_FULL_SPAN_KM / n;

    // Bounding radius in polar stereographic km (accounting for rotation)
    const radiusKm = sizeKm * 0.75;
    const c0 = Math.max(0, Math.floor((center.x - radiusKm + SP_TOP_LEFT_KM) / spanKm));
    const c1 = Math.min(n - 1, Math.floor((center.x + radiusKm + SP_TOP_LEFT_KM) / spanKm));
    const r0 = Math.max(0, Math.floor((center.y - radiusKm + SP_TOP_LEFT_KM) / spanKm));
    const r1 = Math.min(n - 1, Math.floor((center.y + radiusKm + SP_TOP_LEFT_KM) / spanKm));

    const jobs: Promise<{ img: HTMLImageElement; xKm: number; yKm: number }>[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const url = spTileUrl(product, z, r, c, "png");
        const xKm = -SP_TOP_LEFT_KM + c * spanKm;
        const yKm = -SP_TOP_LEFT_KM + r * spanKm;
        jobs.push(
          loadTileImage(url).then((img) => ({ img, xKm, yKm })),
        );
      }
    }

    const loaded = await Promise.all(jobs);
    const pxPerKm = canvasPx / sizeKm;

    // Transform polar stereographic (xKm, yKm) → local North-up canvas pixels:
    // At south pole stereographic, local East is (cos(lon), sin(lon)) and local North is (sin(lon), -cos(lon)).
    // So rotating the polar map by `-lon` degrees aligns local East with +X (right) and local North with +Y (down = South)!
    // Wait: on the South Pole map:
    //   local East = (+cos(lon), +sin(lon))
    //   local South (toward pole) = (-sin(lon), +cos(lon))
    // Since canvas +X is East and canvas +Y is South (row 0 = North edge), a rotation by `-lon` (in radians)
    // maps `(dx, dy)` in polar map km directly to `(eastKm, southKm)`!
    ctx.save();
    ctx.translate(canvasPx / 2, canvasPx / 2);
    ctx.scale(pxPerKm, pxPerKm);
    ctx.rotate((-lon * Math.PI) / 180);
    for (const item of loaded) {
      ctx.drawImage(item.img, item.xKm - center.x, item.yKm - center.y, spanKm + 0.05, spanKm + 0.05);
    }
    ctx.restore();
    return canvas;
  }

  // Global Equirectangular fallback (e.g. Apollo 11, Mare Tranquillitatis, mid-latitude sites)
  const z = 5;
  const cols = 1 << (z + 1); // 64
  const rows = 1 << z; // 32
  const degPerTile = 180 / rows; // 5.625 deg
  const dLat = (sizeKm / R_MOON_KM) * (180 / Math.PI) * 0.5;
  const dLon = dLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180));

  const minLon = lon - dLon, maxLon = lon + dLon;
  const minLat = lat - dLat, maxLat = lat + dLat;

  const c0 = Math.floor((minLon + 180) / degPerTile);
  const c1 = Math.floor((maxLon + 180) / degPerTile);
  const r0 = Math.max(0, Math.floor((90 - maxLat) / degPerTile));
  const r1 = Math.min(rows - 1, Math.floor((90 - minLat) / degPerTile));

  const jobs: Promise<{ img: HTMLImageElement; r: number; c: number }>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      jobs.push(
        loadTileImage(eqTileUrl(z, r, ((c % cols) + cols) % cols)).then((img) => ({ img, r, c })),
      );
    }
  }
  const loaded = await Promise.all(jobs);
  for (const item of loaded) {
    const tileWest = -180 + item.c * degPerTile;
    const tileNorth = 90 - item.r * degPerTile;
    const x0 = ((tileWest - minLon) / (2 * dLon)) * canvasPx;
    const y0 = ((maxLat - tileNorth) / (2 * dLat)) * canvasPx;
    const w = (degPerTile / (2 * dLon)) * canvasPx;
    const h = (degPerTile / (2 * dLat)) * canvasPx;
    ctx.drawImage(item.img, x0, y0, w + 0.5, h + 0.5);
  }
  return canvas;
}

/**
 * Stitches the global NASA Moon Trek LROC WAC Equirectangular mosaic (`LRO_WAC_Mosaic_Global_303ppd_v02`)
 * at zoom level `z` (`z=1` → 1024×512, `z=2` → 2048×1024) for wrapping a 3D Moon Globe.
 */
export async function renderGlobalMoonCanvas(z: 1 | 2 = 2): Promise<HTMLCanvasElement> {
  const cols = 1 << (z + 1);
  const rows = 1 << z;
  const tilePx = 256;
  const canvas = document.createElement("canvas");
  canvas.width = cols * tilePx;
  canvas.height = rows * tilePx;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#555";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs: Promise<void>[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      jobs.push(
        loadTileImage(eqTileUrl(z, r, c))
          .then((img) => {
            ctx.drawImage(img, c * tilePx, r * tilePx, tilePx, tilePx);
          }),
      );
    }
  }
  await Promise.all(jobs);
  return canvas;
}

