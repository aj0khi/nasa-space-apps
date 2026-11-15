// Procedural textures and components for celestial bodies in 3D views (Sun, Earth, Moon).
// Renders realistic, detailed representations instead of plain solid-color orbs.
import { useEffect, useId, useMemo } from "react";
import * as THREE from "three";

// Cache canvas textures so they are generated only once and shared across 3D scenes
let cachedSunTex: THREE.CanvasTexture | null = null;
let cachedCoronaTex: THREE.CanvasTexture | null = null;
let cachedEarthTex: THREE.CanvasTexture | null = null;
let cachedAtmosphereTex: THREE.CanvasTexture | null = null;
let cachedMoonTex: THREE.CanvasTexture | null = null;

/** Generates a solar photosphere surface texture with convection granulation, sunspots, and limb darkening. */
export function getSunTexture(): THREE.CanvasTexture {
  if (cachedSunTex) return cachedSunTex;

  const w = 512, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Warm glowing base gradient (limb-darkened solar surface)
  const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
  baseGrad.addColorStop(0, "#e65100");
  baseGrad.addColorStop(0.2, "#f57c00");
  baseGrad.addColorStop(0.5, "#ffb300");
  baseGrad.addColorStop(0.8, "#f57c00");
  baseGrad.addColorStop(1, "#e65100");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  // Convective solar granulation (photosphere texture)
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < h; y++) {
    const latFactor = Math.sin((y / h) * Math.PI); // limb darkening toward poles
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const noise = (rnd() - 0.5) * 36;
      const grain = Math.sin(x * 0.3) * Math.cos(y * 0.3) * 12;
      const boost = 25 * latFactor;

      data[idx] = Math.min(255, Math.max(200, data[idx] + noise + grain + boost)); // Red
      data[idx + 1] = Math.min(245, Math.max(130, data[idx + 1] + noise * 0.8 + grain + boost * 0.7)); // Green
      data[idx + 2] = Math.min(180, Math.max(10, data[idx + 2] + noise * 0.3)); // Blue
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Sunspot groups (umbra + penumbra + bright faculae)
  const spots = [
    { x: w * 0.28, y: h * 0.42, r: 10 },
    { x: w * 0.31, y: h * 0.44, r: 6 },
    { x: w * 0.65, y: h * 0.58, r: 12 },
    { x: w * 0.69, y: h * 0.56, r: 7 },
    { x: w * 0.73, y: h * 0.61, r: 5 },
    { x: w * 0.48, y: h * 0.38, r: 8 },
  ];

  for (const s of spots) {
    // Bright faculae surrounding the spot
    const facGrad = ctx.createRadialGradient(s.x, s.y, s.r * 0.8, s.x, s.y, s.r * 2.4);
    facGrad.addColorStop(0, "rgba(255, 255, 210, 0.45)");
    facGrad.addColorStop(1, "rgba(255, 255, 210, 0)");
    ctx.fillStyle = facGrad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Penumbra (warm amber ring)
    const penGrad = ctx.createRadialGradient(s.x, s.y, s.r * 0.3, s.x, s.y, s.r);
    penGrad.addColorStop(0, "#7c2d12");
    penGrad.addColorStop(0.7, "#9a3412");
    penGrad.addColorStop(1, "rgba(234, 88, 12, 0)");
    ctx.fillStyle = penGrad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    // Umbra (dark core)
    ctx.fillStyle = "#2c0e06";
    ctx.beginPath();
    ctx.arc(s.x + (rnd() - 0.5) * 2, s.y + (rnd() - 0.5) * 2, s.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedSunTex = tex;
  return tex;
}

/** Generates a solar corona glow billboard texture with intense radial falloff and coronal rays. */
export function getSunCoronaTexture(): THREE.CanvasTexture {
  if (cachedCoronaTex) return cachedCoronaTex;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  // Multi-stop radial gradient for the solar corona
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
  grad.addColorStop(0.12, "rgba(255, 248, 200, 0.95)");
  grad.addColorStop(0.28, "rgba(255, 200, 70, 0.7)");
  grad.addColorStop(0.48, "rgba(255, 130, 20, 0.35)");
  grad.addColorStop(0.72, "rgba(255, 80, 10, 0.12)");
  grad.addColorStop(1.0, "rgba(255, 40, 0, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.fill();

  // 12 subtle coronal rays / solar streamers
  ctx.save();
  ctx.translate(center, center);
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    ctx.rotate(angle);
    const rayGrad = ctx.createLinearGradient(0, 0, center * 0.95, 0);
    rayGrad.addColorStop(0, "rgba(255, 240, 180, 0.22)");
    rayGrad.addColorStop(0.5, "rgba(255, 170, 40, 0.08)");
    rayGrad.addColorStop(1, "rgba(255, 120, 0, 0)");
    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(center * (0.8 + ((i % 3) * 0.08)), 0);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-angle);
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedCoronaTex = tex;
  return tex;
}

/**
 * Generates an equirectangular Blue Marble Earth texture with oceans, recognizable continents
 * (Africa, Eurasia, Americas, Australia, Antarctica), mountain/desert biomes, and weather clouds.
 */
export function getEarthTexture(): THREE.CanvasTexture {
  if (cachedEarthTex) return cachedEarthTex;

  const w = 1024, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Coordinates helper: lon [-180, 180] -> x [0, w], lat [-90, 90] -> y [h, 0]
  const toX = (lon: number) => ((lon + 180) / 360) * w;
  const toY = (lat: number) => ((90 - lat) / 180) * h;

  // 1. Deep royal ocean base
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, h);
  oceanGrad.addColorStop(0, "#0d2b52");
  oceanGrad.addColorStop(0.3, "#10386b");
  oceanGrad.addColorStop(0.5, "#0b254a");
  oceanGrad.addColorStop(0.7, "#10386b");
  oceanGrad.addColorStop(1, "#0a213f");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, w, h);

  // Helper to draw continent polygons
  const drawLand = (points: [number, number][], fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // Coastal shelf turquoise glow
  ctx.shadowColor = "#1a6f9c";
  ctx.shadowBlur = 8;

  // 2. AFRICA
  drawLand([
    [-6, 36], [10, 37], [25, 32], [33, 31], [43, 12], [51, 12], [42, -5],
    [35, -20], [28, -33], [18, -34], [12, -20], [9, 4], [2, 6], [-17, 15],
    [-13, 28], [-6, 36],
  ], "#2d5e30", "#1e4722");

  // Sahara Desert in North Africa
  drawLand([
    [-15, 28], [-12, 17], [5, 15], [30, 18], [33, 30], [10, 32], [-5, 32],
  ], "#c29753");

  // 3. EURASIA
  // Europe
  drawLand([
    [-9, 36], [-9, 43], [-1, 44], [-5, 48], [3, 51], [8, 54], [18, 54],
    [28, 71], [15, 68], [6, 62], [10, 56], [22, 57], [28, 45], [15, 40],
    [-5, 36],
  ], "#356633", "#224722");

  // British Isles & Scandinavia
  drawLand([[-10, 51], [-5, 58], [-2, 58], [2, 51]], "#356633");
  drawLand([[5, 59], [12, 68], [28, 70], [18, 60]], "#264f26");

  // Asia / Russia taiga
  drawLand([
    [30, 42], [40, 43], [60, 40], [75, 45], [120, 53], [140, 58], [170, 66],
    [180, 68], [170, 72], [100, 76], [60, 72], [35, 70], [30, 50],
  ], "#264926");

  // Arabian Peninsula (desert)
  drawLand([[35, 30], [50, 30], [59, 22], [54, 16], [43, 13], [36, 22]], "#bf9552");

  // India
  drawLand([[68, 24], [73, 30], [88, 24], [83, 16], [78, 8], [73, 16]], "#3a6936");

  // East Asia & China
  drawLand([
    [75, 35], [90, 30], [105, 22], [115, 23], [122, 32], [124, 40], [105, 42],
    [85, 44],
  ], "#3f6a39");

  // Southeast Asia & Indonesia
  drawLand([[100, 20], [108, 12], [104, 2], [98, 8]], "#255725");
  drawLand([[96, -5], [106, -6], [115, -8], [105, 5]], "#255725");
  drawLand([[110, 4], [118, 4], [115, -4], [109, -2]], "#255725");
  drawLand([[132, -2], [150, -8], [140, -3]], "#255725"); // New Guinea

  // Japan
  drawLand([[130, 32], [136, 35], [142, 43], [139, 36]], "#2a5927");

  // 4. NORTH AMERICA
  drawLand([
    [-165, 65], [-140, 70], [-130, 68], [-95, 70], [-80, 60], [-60, 50],
    [-65, 44], [-76, 35], [-81, 25], [-88, 30], [-97, 26], [-90, 20],
    [-105, 22], [-117, 32], [-124, 48], [-135, 57], [-150, 60], [-165, 65],
  ], "#345e32", "#1f4220");

  // Great Plains / Southwest Arid region
  drawLand([
    [-115, 32], [-100, 32], [-102, 45], [-112, 45],
  ], "#9e844a");

  // Greenland (ice cap)
  drawLand([
    [-52, 60], [-40, 65], [-20, 75], [-35, 82], [-55, 78], [-52, 60],
  ], "#eaf4fc", "#c8e2f8");

  // 5. SOUTH AMERICA
  drawLand([
    [-76, 8], [-60, 10], [-50, 0], [-35, -5], [-37, -12], [-48, -28],
    [-58, -38], [-66, -54], [-73, -52], [-72, -40], [-76, -20], [-81, -5],
    [-76, 8],
  ], "#235724", "#18401a");

  // Andes mountain ridge
  drawLand([
    [-78, 5], [-76, -15], [-70, -32], [-68, -50], [-72, -50], [-74, -30],
  ], "#70644b");

  // 6. AUSTRALIA & OCEANIA
  drawLand([
    [114, -22], [128, -15], [136, -12], [142, -11], [150, -23], [153, -28],
    [148, -38], [138, -35], [130, -32], [115, -34], [114, -22],
  ], "#3c6634", "#23441f");

  // Australian Outback (red center)
  drawLand([
    [122, -22], [138, -20], [140, -30], [125, -30],
  ], "#b56934");

  // New Zealand
  drawLand([[172, -35], [178, -38], [174, -42], [168, -46]], "#2a5927");

  // Reset shadow for clouds
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // 7. ANTARCTICA (glacier sheet across south pole)
  ctx.fillStyle = "#edf5fc";
  ctx.beginPath();
  ctx.moveTo(0, toY(-68));
  for (let x = 0; x <= w; x += 32) {
    const lat = -68 + Math.sin(x * 0.05) * 5;
    ctx.lineTo(x, toY(lat));
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // 8. REALISTIC CLOUD PATTERNS
  // Equatorial ITCZ Cloud Belt
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.beginPath();
  for (let x = 0; x <= w; x += 16) {
    const y = toY(2 + Math.sin(x * 0.02) * 6 + Math.cos(x * 0.05) * 3);
    ctx.arc(x, y, 9 + Math.sin(x * 0.1) * 4, 0, Math.PI * 2);
  }
  ctx.fill();

  // Mid-latitude swirling storm spirals
  const drawStormSpiral = (cx: number, cy: number, r: number) => {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 3.5; a += 0.2) {
      const dist = (a / (Math.PI * 3.5)) * r;
      const x = cx + Math.cos(a) * dist;
      const y = cy + Math.sin(a) * dist * 0.6;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  drawStormSpiral(toX(-45), toY(45), 45); // North Atlantic cyclone
  drawStormSpiral(toX(-160), toY(42), 55); // North Pacific storm
  drawStormSpiral(toX(90), toY(-48), 60); // Southern Ocean storm
  drawStormSpiral(toX(-90), toY(-52), 65); // South Pacific storm

  // Wispy cloud bands
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  for (let i = 0; i < 40; i++) {
    const cx = ((i * 37) % w);
    const cy = ((i * 23 + 40) % h);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 35, 12, (i * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedEarthTex = tex;
  return tex;
}

/** Generates a soft azure/cyan atmospheric glow billboard texture for Earth. */
export function getEarthAtmosphereTexture(): THREE.CanvasTexture {
  if (cachedAtmosphereTex) return cachedAtmosphereTex;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;

  // Thin cyan atmospheric rim with rapid falloff
  const grad = ctx.createRadialGradient(center, center, center * 0.65, center, center, center);
  grad.addColorStop(0, "rgba(100, 200, 255, 0.65)");
  grad.addColorStop(0.35, "rgba(70, 160, 255, 0.45)");
  grad.addColorStop(0.7, "rgba(30, 100, 230, 0.15)");
  grad.addColorStop(1.0, "rgba(10, 60, 200, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedAtmosphereTex = tex;
  return tex;
}

/**
 * Generates an equirectangular procedural Moon texture with lunar highlands, major maria
 * (Oceanus Procellarum, Imbrium, Tranquillitatis, Serenitatis, Crisium), and crater Tycho with long rays.
 * Serves as an immediate high-detail base/fallback so the Moon is never a plain gray orb.
 */
export function getMoonProceduralTexture(): THREE.CanvasTexture {
  if (cachedMoonTex) return cachedMoonTex;

  const w = 1024, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const toX = (lon: number) => ((lon + 180) / 360) * w;
  const toY = (lat: number) => ((90 - lat) / 180) * h;

  // 1. Lunar highlands anorthositic crust
  ctx.fillStyle = "#8d9094";
  ctx.fillRect(0, 0, w, h);

  // Mottled surface noise & micro-craters
  let seed = 101;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 24;
    data[i] = Math.min(240, Math.max(90, data[i] + n));
    data[i + 1] = Math.min(240, Math.max(90, data[i + 1] + n));
    data[i + 2] = Math.min(240, Math.max(90, data[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);

  // 2. LUNAR MARIA (dark basaltic plains)
  const drawMare = (cxDeg: number, cyDeg: number, rxDeg: number, ryDeg: number, col = "#4b4d50") => {
    const cx = toX(cxDeg), cy = toY(cyDeg);
    const rx = (rxDeg / 360) * w, ry = (ryDeg / 180) * h;
    const g = ctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, rx);
    g.addColorStop(0, col);
    g.addColorStop(0.7, col);
    g.addColorStop(1, "rgba(100, 102, 105, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  // Near-side major maria
  drawMare(-40, 20, 48, 42, "#444649"); // Oceanus Procellarum
  drawMare(-17, 35, 24, 22, "#3e4043"); // Mare Imbrium
  drawMare(17, 28, 18, 16, "#404245"); // Mare Serenitatis
  drawMare(31, 8, 20, 17, "#424447"); // Mare Tranquillitatis
  drawMare(59, 17, 14, 12, "#3c3e41"); // Mare Crisium
  drawMare(51, -3, 16, 14, "#444649"); // Mare Fecunditatis
  drawMare(35, -15, 12, 10, "#46484b"); // Mare Nectaris
  drawMare(-16, -21, 18, 14, "#434548"); // Mare Nubium
  drawMare(-38, -24, 11, 9, "#47494c"); // Mare Humorum

  // Far-side South Pole-Aitken basin
  drawMare(180, -56, 36, 26, "#54565a");

  // 3. PROMINENT IMPACT CRATERS & EJECTA RAYS
  // Tycho (-43° lat, -11° lon) with dramatic ray system across southern hemisphere
  const tychoX = toX(-11), tychoY = toY(-43);
  ctx.save();
  ctx.strokeStyle = "rgba(235, 240, 250, 0.45)";
  ctx.lineWidth = 1.6;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    ctx.beginPath();
    ctx.moveTo(tychoX, tychoY);
    const rayLen = 140 + ((Math.sin(a * 4) + 1) * 80);
    ctx.lineTo(tychoX + Math.cos(a) * rayLen, tychoY + Math.sin(a) * rayLen);
    ctx.stroke();
  }
  ctx.restore();

  // Tycho crater central peak
  ctx.fillStyle = "#f0f4fa";
  ctx.beginPath();
  ctx.arc(tychoX, tychoY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Copernicus (+10° lat, -20° lon)
  const copX = toX(-20), copY = toY(10);
  ctx.fillStyle = "rgba(240, 244, 255, 0.5)";
  ctx.beginPath();
  ctx.arc(copX, copY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(copX, copY, 5, 0, Math.PI * 2);
  ctx.fill();

  // Aristarchus (+23° lat, -47° lon - brightest spot on the Moon)
  const arisX = toX(-47), arisY = toY(23);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(arisX, arisY, 4, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedMoonTex = tex;
  return tex;
}

/** Creates a crisp text billboard Sprite badge for a celestial body. */
export function makeCelestialBadge(title: string, sub?: string, accent = "#f5d490"): { sprite: THREE.Sprite; aspect: number } {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const fs = 36;
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;

  const fullText = sub ? `${title}  ${sub}` : title;
  const tw = Math.ceil(ctx.measureText(fullText).width);
  c.width = tw + 40;
  c.height = fs + 24;

  // Translucent dark glass rounded badge
  const r = (c.height) / 2;
  ctx.fillStyle = "rgba(10, 15, 26, 0.85)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;

  ctx.beginPath();
  ctx.roundRect(2, 2, c.width - 4, c.height - 4, r);
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(fullText, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = c.width / c.height;
  return { sprite, aspect };
}

/** Props for rendering the Detailed Sun in 3D scenes. */
export interface DetailedSunProps {
  position?: THREE.Vector3;
  radius?: number;
  label?: string;
  sublabel?: string;
  opacity?: number;
  showLineToOrigin?: boolean;
}

/** Detailed Sun 3D component with radiant solar photosphere, corona glow, and optional badge. */
export function DetailedSun({
  position = new THREE.Vector3(0, 0, 0),
  radius = 0.9,
  label = "☀️ Sun",
  sublabel,
  opacity = 1.0,
  showLineToOrigin = false,
}: DetailedSunProps) {
  const sunTex = useMemo(() => getSunTexture(), []);
  const coronaTex = useMemo(() => getSunCoronaTexture(), []);
  const badgeData = useMemo(() => (label ? makeCelestialBadge(label, sublabel, "#ffb300") : null), [label, sublabel]);

  useEffect(() => {
    return () => {
      if (badgeData) {
        badgeData.sprite.material.map?.dispose();
        badgeData.sprite.material.dispose();
      }
    };
  }, [badgeData]);

  const line = useMemo(() => {
    if (!showLineToOrigin) return null;
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position]),
      new THREE.LineBasicMaterial({ color: "#fff1c8", transparent: true, opacity: opacity * 0.55 }),
    );
  }, [position, showLineToOrigin, opacity]);

  const coronaScale = radius * 4.6;
  const badgeHeight = radius * 0.72;
  const badgeWidth = badgeData ? badgeHeight * badgeData.aspect : 1;

  return (
    <group>
      {line && <primitive object={line} />}
      <group position={position}>
        {/* Core solar sphere with photosphere granulation and limb darkening */}
        <mesh>
          <sphereGeometry args={[radius, 32, 24]} />
          <meshBasicMaterial map={sunTex} transparent opacity={opacity} />
        </mesh>
        {/* Corona glow halo billboard */}
        <sprite scale={[coronaScale, coronaScale, 1]}>
          <spriteMaterial
            map={coronaTex}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={opacity * 0.9}
            depthWrite={false}
          />
        </sprite>
        {/* Floating celestial badge */}
        {badgeData && (
          <primitive
            object={badgeData.sprite}
            position={[0, 0, radius * 1.6]}
            scale={[badgeWidth, badgeHeight, 1]}
          />
        )}
      </group>
    </group>
  );
}

/** Props for rendering the Detailed Earth in 3D scenes. */
export interface DetailedEarthProps {
  position?: THREE.Vector3;
  radius?: number;
  label?: string;
  sublabel?: string;
  opacity?: number;
  showLineToOrigin?: boolean;
}

/** Detailed Earth 3D component with Blue Marble continents, clouds, atmospheric glow halo, and badge. */
export function DetailedEarth({
  position = new THREE.Vector3(0, 0, 0),
  radius = 0.75,
  label = "🌍 Earth",
  sublabel,
  opacity = 1.0,
  showLineToOrigin = false,
}: DetailedEarthProps) {
  const earthTex = useMemo(() => getEarthTexture(), []);
  const atmoTex = useMemo(() => getEarthAtmosphereTexture(), []);
  const badgeData = useMemo(() => (label ? makeCelestialBadge(label, sublabel, "#4da3ff") : null), [label, sublabel]);

  useEffect(() => {
    return () => {
      if (badgeData) {
        badgeData.sprite.material.map?.dispose();
        badgeData.sprite.material.dispose();
      }
    };
  }, [badgeData]);

  const line = useMemo(() => {
    if (!showLineToOrigin) return null;
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position]),
      new THREE.LineBasicMaterial({ color: "#4da3ff", transparent: true, opacity: opacity * 0.55 }),
    );
  }, [position, showLineToOrigin, opacity]);

  const atmoScale = radius * 2.7;
  const badgeHeight = radius * 0.72;
  const badgeWidth = badgeData ? badgeHeight * badgeData.aspect : 1;

  return (
    <group>
      {line && <primitive object={line} />}
      <group position={position}>
        {/* Earth Blue Marble sphere */}
        <mesh rotation={[0.4, 1.2, 0]}>
          <sphereGeometry args={[radius, 32, 24]} />
          <meshBasicMaterial map={earthTex} transparent opacity={opacity} />
        </mesh>
        {/* Atmospheric Rayleigh scattering cyan glow halo */}
        <sprite scale={[atmoScale, atmoScale, 1]}>
          <spriteMaterial
            map={atmoTex}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={opacity * 0.85}
            depthWrite={false}
          />
        </sprite>
        {/* Floating celestial badge */}
        {badgeData && (
          <primitive
            object={badgeData.sprite}
            position={[0, 0, radius * 1.6]}
            scale={[badgeWidth, badgeHeight, 1]}
          />
        )}
      </group>
    </group>
  );
}

/** Props for rendering Detailed Sun or Earth in SVG views (SkyDome, SunProfile, SouthPoleMap). */
export interface CelestialSvgProps {
  cx: number;
  cy: number;
  r?: number;
  opacity?: number;
  title?: string;
  className?: string;
}

/** High-detail SVG component for the Sun featuring corona glow, coronal rays, granulation gradient, and sunspots. */
export function DetailedSunSvg({ cx, cy, r = 10, opacity = 1, title, className }: CelestialSvgProps) {
  const rawId = useId();
  const gradId = `sun-grad-${rawId.replace(/:/g, "")}`;
  const coronaId = `sun-corona-${rawId.replace(/:/g, "")}`;

  // 8 ray angles around the solar disc
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <g transform={`translate(${cx}, ${cy})`} opacity={opacity} className={className}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={gradId} cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#fff176" />
          <stop offset="52%" stopColor="#ffb300" />
          <stop offset="82%" stopColor="#f57c00" />
          <stop offset="100%" stopColor="#d84315" />
        </radialGradient>
        <radialGradient id={coronaId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 245, 180, 0.95)" />
          <stop offset="42%" stopColor="rgba(255, 180, 50, 0.45)" />
          <stop offset="75%" stopColor="rgba(255, 100, 20, 0.15)" />
          <stop offset="100%" stopColor="rgba(255, 60, 0, 0)" />
        </radialGradient>
      </defs>
      {/* Outer Corona Glow */}
      <circle r={r * 1.85} fill={`url(#${coronaId})`} />
      {/* Coronal Streamer Rays */}
      {rays.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={Math.sin(rad) * r * 0.9}
            y1={-Math.cos(rad) * r * 0.9}
            x2={Math.sin(rad) * r * 1.55}
            y2={-Math.cos(rad) * r * 1.55}
            stroke="#ffca28"
            strokeWidth={Math.max(1, r * 0.16)}
            strokeLinecap="round"
            opacity={0.8}
          />
        );
      })}
      {/* Photosphere Core */}
      <circle r={r} fill={`url(#${gradId})`} stroke="#ffe082" strokeWidth={Math.max(0.6, r * 0.08)} />
      {/* Active Sunspot Groups */}
      <circle cx={-r * 0.25} cy={-r * 0.12} r={Math.max(0.8, r * 0.13)} fill="#3e1505" opacity={0.8} />
      <circle cx={r * 0.28} cy={r * 0.22} r={Math.max(1, r * 0.17)} fill="#2f0f04" opacity={0.85} />
      <circle cx={r * 0.4} cy={r * 0.15} r={Math.max(0.6, r * 0.09)} fill="#4e1b06" opacity={0.75} />
    </g>
  );
}

/** High-detail SVG component for Earth featuring ocean gradient, atmospheric cyan glow, continents, and cloud spirals. */
export function DetailedEarthSvg({ cx, cy, r = 10, opacity = 1, title, className }: CelestialSvgProps) {
  const rawId = useId();
  const cleanId = rawId.replace(/:/g, "");
  const clipId = `earth-clip-${cleanId}`;
  const oceanId = `earth-ocean-${cleanId}`;
  const atmoId = `earth-atmo-${cleanId}`;

  return (
    <g transform={`translate(${cx}, ${cy})`} opacity={opacity} className={className}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={oceanId} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1e60a5" />
          <stop offset="48%" stopColor="#12437b" />
          <stop offset="82%" stopColor="#0c2d54" />
          <stop offset="100%" stopColor="#071b33" />
        </radialGradient>
        <radialGradient id={atmoId} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="rgba(120, 210, 255, 0.65)" />
          <stop offset="80%" stopColor="rgba(60, 160, 255, 0.25)" />
          <stop offset="100%" stopColor="rgba(20, 80, 240, 0)" />
        </radialGradient>
        <clipPath id={clipId}>
          <circle r={r} />
        </clipPath>
      </defs>
      {/* Atmospheric Rayleigh Scattering Glow Halo */}
      <circle r={r * 1.45} fill={`url(#${atmoId})`} />
      {/* Earth Disc with Continents & Clouds */}
      <g clipPath={`url(#${clipId})`}>
        {/* Ocean Base */}
        <circle r={r} fill={`url(#${oceanId})`} />
        {/* Continents (Americas, Eurasia, Africa, Australia) */}
        {/* North America */}
        <path
          d={`M ${-r * 0.65} ${-r * 0.55} Q ${-r * 0.4} ${-r * 0.6} ${-r * 0.2} ${-r * 0.45} Q ${-r * 0.25} ${-r * 0.1} ${-r * 0.45} ${-r * 0.1} Q ${-r * 0.6} ${-r * 0.3} ${-r * 0.65} ${-r * 0.55} Z`}
          fill="#336e35"
        />
        {/* South America */}
        <path
          d={`M ${-r * 0.4} ${-r * 0.05} Q ${-r * 0.2} 0 ${-r * 0.25} ${r * 0.4} Q ${-r * 0.35} ${r * 0.65} ${-r * 0.45} ${r * 0.4} Q ${-r * 0.5} ${r * 0.15} ${-r * 0.4} ${-r * 0.05} Z`}
          fill="#2b5e2d"
        />
        {/* Eurasia */}
        <path
          d={`M ${-r * 0.05} ${-r * 0.6} Q ${r * 0.35} ${-r * 0.65} ${r * 0.7} ${-r * 0.45} Q ${r * 0.6} ${-r * 0.2} ${r * 0.3} ${-r * 0.25} Q ${r * 0.1} ${-r * 0.35} ${-r * 0.05} ${-r * 0.6} Z`}
          fill="#336e35"
        />
        {/* Africa & Sahara */}
        <path
          d={`M ${r * 0.05} ${-r * 0.25} Q ${r * 0.35} ${-r * 0.2} ${r * 0.35} ${r * 0.1} Q ${r * 0.2} ${r * 0.55} ${r * 0.15} ${r * 0.3} Q ${r * 0.02} ${r * 0.1} ${r * 0.05} ${-r * 0.25} Z`}
          fill="#3a6f3b"
        />
        <ellipse cx={r * 0.2} cy={-r * 0.15} rx={r * 0.12} ry={r * 0.07} fill="#c29753" />
        {/* Antarctica Ice Cap */}
        <ellipse cx={0} cy={r * 0.9} rx={r * 0.75} ry={r * 0.25} fill="#eef6fc" />
        {/* Swirling Clouds */}
        <path
          d={`M ${-r * 0.8} ${-r * 0.2} Q ${-r * 0.3} ${-r * 0.1} ${r * 0.2} ${-r * 0.25} Q ${r * 0.6} ${-r * 0.35} ${r * 0.9} ${-r * 0.2}`}
          stroke="rgba(255, 255, 255, 0.72)"
          strokeWidth={Math.max(1, r * 0.14)}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M ${-r * 0.7} ${r * 0.15} Q ${-r * 0.2} ${r * 0.05} ${r * 0.3} ${r * 0.18} Q ${r * 0.7} ${r * 0.22} ${r * 0.85} ${r * 0.1}`}
          stroke="rgba(255, 255, 255, 0.62)"
          strokeWidth={Math.max(1, r * 0.12)}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M ${-r * 0.5} ${r * 0.45} Q 0 ${r * 0.38} ${r * 0.6} ${r * 0.5}`}
          stroke="rgba(255, 255, 255, 0.55)"
          strokeWidth={Math.max(0.8, r * 0.1)}
          strokeLinecap="round"
          fill="none"
        />
      </g>
      {/* Atmospheric Rim */}
      <circle r={r} fill="none" stroke="#90d5ff" strokeWidth={Math.max(0.6, r * 0.08)} opacity={0.65} />
    </g>
  );
}

// ---------------------------------------------------------------- the 3D Sun, for flat (SVG) maps and diagrams
// One look everywhere: the same photosphere texture, corona glow and "☀️ Sun +x.x°" badge as DetailedSun in 3D.

let cachedSunDiscUrl: string | null = null;
let cachedCoronaUrl: string | null = null;

/** The Sun texture wrapped on a sphere and seen face-on (orthographic), as a transparent PNG. Built once. */
function sunDiscUrl(): string {
  if (cachedSunDiscUrl) return cachedSunDiscUrl;
  const src = getSunTexture().image as HTMLCanvasElement;
  const sw = src.width, sh = src.height;
  const sdata = src.getContext("2d")!.getImageData(0, 0, sw, sh).data;
  const n = 128;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = ((x + 0.5) / n) * 2 - 1, py = 1 - ((y + 0.5) / n) * 2;
      const rr = px * px + py * py;
      if (rr > 1) continue;
      const pz = Math.sqrt(1 - rr);
      const lon = Math.atan2(px, pz), lat = Math.asin(py);
      // face the texture's seam (u = 0), the side without sunspot groups, like the 3D views usually show
      const uf = (((lon / (2 * Math.PI)) % 1) + 1) % 1;
      const u = Math.min(sw - 1, Math.max(0, Math.floor(uf * sw)));
      const v = Math.min(sh - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * sh)));
      const si = (v * sw + u) * 4, di = (y * n + x) * 4;
      img.data[di] = sdata[si];
      img.data[di + 1] = sdata[si + 1];
      img.data[di + 2] = sdata[si + 2];
      img.data[di + 3] = Math.round(255 * Math.min(1, (1 - Math.sqrt(rr)) * n * 0.5)); // anti-aliased edge
    }
  }
  ctx.putImageData(img, 0, 0);
  cachedSunDiscUrl = c.toDataURL();
  return cachedSunDiscUrl;
}

function coronaUrl(): string {
  if (!cachedCoronaUrl) cachedCoronaUrl = (getSunCoronaTexture().image as HTMLCanvasElement).toDataURL();
  return cachedCoronaUrl;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, fontPx: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * fontPx * 0.6;
  measureCtx.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Same wording as the 3D badge: "☀️ Sun  +0.2°". */
export const sunBadgeText = (altitude?: number | null) =>
  altitude == null ? "☀️ Sun" : `☀️ Sun  ${altitude >= 0 ? "+" : "−"}${Math.abs(altitude).toFixed(1)}°`;

export interface SunSvgProps {
  /** Centre, in the parent SVG's units. */
  x: number;
  y: number;
  /** Disc radius, in the parent SVG's units. */
  r: number;
  /** Sun altitude in degrees, shown on the badge; omit for a plain "☀️ Sun" badge. */
  altitude?: number | null;
  /** Where the badge goes (pick the side facing the middle of the drawing so it isn't clipped). */
  badge?: BadgePlace;
  /** Keep the badge inside these x limits (parent units), e.g. the edges of a map tile. */
  clampX?: [number, number];
  /** Faded, e.g. when the Sun is below the horizon (the 3D view uses 0.28). */
  dim?: boolean;
  /** Badge height in parent units (default: just under the disc radius, as in 3D). For small suns on big maps. */
  badgeSize?: number;
  title?: string;
}

/** The 3D view's Sun (photosphere, corona glow, badge) drawn in any SVG. Matches DetailedSun. */
export function SunSvg({ x, y, r, altitude, badge = "above", clampX, dim = false, badgeSize, title }: SunSvgProps) {
  const disc = useMemo(sunDiscUrl, []);
  const corona = useMemo(coronaUrl, []);
  const text = sunBadgeText(altitude);
  const { bx, by, w, h, fs } = badgeLayout(text, x, y, r, badge, badgeSize, clampX);
  const cs = r * 4.6; // corona size relative to the disc, as in 3D
  return (
    <g opacity={dim ? 0.28 : 1} pointerEvents="none">
      {title && <title>{title}</title>}
      {/* corona behind the disc: in 3D it's a sprite at the sphere's centre, so the sphere hides it except at the
          rim. A faint normal copy keeps the halo visible on bright ground, where a screen blend vanishes. */}
      <image href={corona} x={x - cs / 2} y={y - cs / 2} width={cs} height={cs} opacity={0.35} />
      <image href={corona} x={x - cs / 2} y={y - cs / 2} width={cs} height={cs} style={{ mixBlendMode: "screen" }} opacity={0.9} />
      <image href={disc} x={x - r} y={y - r} width={2 * r} height={2 * r} />
      {badge !== "none" && <BadgeSvg x={bx} y={by} w={w} h={h} fs={fs} text={text} accent="#ffb300" />}
    </g>
  );
}

/** Badge geometry shared by SunSvg and EarthSvg: pill size from the text, beside/above/below the body, clamped. */
function badgeLayout(text: string, x: number, y: number, r: number, badge: BadgePlace, badgeSize?: number,
  clampX?: [number, number]) {
  const h = badgeSize ?? r * 0.95; // badge height
  const fs = h * 0.6;
  const w = textWidth(text, 100) * (fs / 100) + h * 0.9;
  const side = badge === "left" ? -1 : badge === "right" ? 1 : 0;
  let bx = side ? x + side * (r * 1.35 + w / 2) : x;
  if (clampX) bx = Math.min(clampX[1] - w / 2, Math.max(clampX[0] + w / 2, bx));
  const gap = r * 1.35 + h / 2;
  const by = side ? y : badge === "below" ? y + gap : y - gap;
  return { bx, by, w, h, fs };
}

type BadgePlace = "above" | "below" | "left" | "right" | "none";

/** The 3D views' text badge (makeCelestialBadge) as SVG: dark glass pill, coloured border, white text. */
function BadgeSvg({ x, y, w, h, fs, text, accent }: { x: number; y: number; w: number; h: number; fs: number; text: string; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(10, 15, 26, 0.85)" stroke={accent}
        strokeWidth={Math.max(0.3, h * 0.07)} />
      <text y={fs * 0.36} textAnchor="middle" fontSize={fs} fontWeight={600} fill="#ffffff"
        fontFamily="system-ui, -apple-system, sans-serif">{text}</text>
    </g>
  );
}

let cachedEarthDiscUrl: string | null = null;
let cachedAtmosphereUrl: string | null = null;

// The face shown in flat views: centred on Africa / Europe, a little north of the equator (the classic "Blue Marble").
const EARTH_FACE_LAT = 15, EARTH_FACE_LON = 20;

/**
 * The 3D views' Earth texture (getEarthTexture, equirectangular: lon −180…180 left→right, lat 90…−90 top→bottom)
 * on a sphere seen face-on (orthographic), centred on EARTH_FACE_LAT / EARTH_FACE_LON, as a transparent PNG. Built once.
 */
function earthDiscUrl(): string {
  if (cachedEarthDiscUrl) return cachedEarthDiscUrl;
  const src = getEarthTexture().image as HTMLCanvasElement;
  const sw = src.width, sh = src.height;
  const sdata = src.getContext("2d")!.getImageData(0, 0, sw, sh).data;
  const n = 160;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const D = Math.PI / 180;
  const cl = Math.cos(EARTH_FACE_LAT * D), sl = Math.sin(EARTH_FACE_LAT * D);
  for (let yy = 0; yy < n; yy++) {
    for (let xx = 0; xx < n; xx++) {
      const px = ((xx + 0.5) / n) * 2 - 1, py = 1 - ((yy + 0.5) / n) * 2;
      const rr = px * px + py * py;
      if (rr > 1) continue;
      const pz = Math.sqrt(1 - rr);
      // inverse orthographic projection
      const lat = Math.asin(Math.max(-1, Math.min(1, py * cl + pz * sl))) / D;
      const lon = EARTH_FACE_LON + Math.atan2(px, pz * cl - py * sl) / D;
      const u = Math.min(sw - 1, Math.floor((((((lon + 180) / 360) % 1) + 1) % 1) * sw));
      const v = Math.min(sh - 1, Math.max(0, Math.floor(((90 - lat) / 180) * sh)));
      const si = (v * sw + u) * 4, di = (yy * n + xx) * 4;
      img.data[di] = sdata[si];
      img.data[di + 1] = sdata[si + 1];
      img.data[di + 2] = sdata[si + 2];
      img.data[di + 3] = Math.round(255 * Math.min(1, (1 - Math.sqrt(rr)) * n * 0.5));
    }
  }
  ctx.putImageData(img, 0, 0);
  cachedEarthDiscUrl = c.toDataURL();
  return cachedEarthDiscUrl;
}

function atmosphereUrl(): string {
  if (!cachedAtmosphereUrl) cachedAtmosphereUrl = (getEarthAtmosphereTexture().image as HTMLCanvasElement).toDataURL();
  return cachedAtmosphereUrl;
}

/** Same wording as the 3D badge: "🌍 Earth  −5.6°". */
export const earthBadgeText = (altitude?: number | null) =>
  altitude == null ? "🌍 Earth" : `🌍 Earth  ${altitude >= 0 ? "+" : "−"}${Math.abs(altitude).toFixed(1)}°`;

/** The 3D view's Earth (Blue Marble sphere, cyan atmosphere, blue badge) drawn in any SVG. Matches DetailedEarth. */
export function EarthSvg({ x, y, r, altitude, badge = "above", clampX, dim = false, badgeSize, title }: SunSvgProps) {
  const disc = useMemo(earthDiscUrl, []);
  const atmo = useMemo(atmosphereUrl, []);
  const text = earthBadgeText(altitude);
  const { bx, by, w, h, fs } = badgeLayout(text, x, y, r, badge, badgeSize, clampX);
  const as = r * 2.7; // atmosphere size relative to the disc, as in 3D
  return (
    <g opacity={dim ? 0.28 : 1} pointerEvents="none">
      {title && <title>{title}</title>}
      {/* atmosphere behind the disc (in 3D the sphere hides the sprite except at the rim), as for the Sun */}
      <image href={atmo} x={x - as / 2} y={y - as / 2} width={as} height={as} opacity={0.35} />
      <image href={atmo} x={x - as / 2} y={y - as / 2} width={as} height={as} style={{ mixBlendMode: "screen" }} opacity={0.85} />
      <image href={disc} x={x - r} y={y - r} width={2 * r} height={2 * r} />
      {badge !== "none" && <BadgeSvg x={bx} y={by} w={w} h={h} fs={fs} text={text} accent="#4da3ff" />}
    </g>
  );
}
