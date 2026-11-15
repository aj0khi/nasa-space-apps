// EXPLORE ON FOOT: drop an explorer on the surface and walk around at eye height, like street view.
// Owner: Visualization.
//   Measured (/api/terrain/elevation; real NASA LOLA heights when the DEM is installed, else the synthetic model):
//     10 km at 20 m around the site · 20 km at ~39 m · 100 km at ~196 m for the skyline and distant shadows.
//   Estimated: small craters and bumps below the data's resolution (lib/regolith.ts) on a patch around you.
//   The Moon's curvature is applied, so distant terrain drops away as it really does (~720 m at 50 km).
//   Sky: the real Sun and Earth at the slider time (/api/ephemeris/state), true scale, real terrain shadows.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../../api/client";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { compass, destination, fmtLat, fmtLon } from "../../lib/geo";
import { detail, sampleTile } from "../../lib/regolith";
import { useApp } from "../../state/store";
import { useExpert } from "../learn/ModeGate";
import { groundMaterial } from "./groundMaterial";
import { DetailedSun, DetailedEarth } from "./celestialBodies";

const TILE_KM = 20;
const TILE_RES = 511; // ~39 m per sample (the backend allows at most 512 across)
// Sharper data near the site: 10 km at 20 m per sample (the resolution of NASA's LOLA south-pole maps).
const FINE_KM = 10, FINE_RES = 501, FINE_M = FINE_KM * 1000;
const FINE_STEP = FINE_M / (FINE_RES - 1), TILE_STEP = (TILE_KM * 1000) / (TILE_RES - 1);
const BLEND_M = 700; // fade from the 20 m data to the 39 m data over the last 700 m of the fine tile
const TILE_M = TILE_KM * 1000;
// Skyline: crater rims tens of km away decide what is lit when the Sun is 1–2° up.
const WIDE_KM = 100, WIDE_RES = 511, WIDE_M = WIDE_KM * 1000;
const R_MOON_M = 1_737_400;
/** How far the surface curves away below a flat plane at this horizontal distance (m). */
const drop = (e: number, n: number) => (e * e + n * n) / (2 * R_MOON_M);
const PATCH_M = 1600; // detailed ground around the explorer
const PATCH_SEG = 320; // 5 m spacing, so estimated craters down to ~10 m show
const RECENTER_M = 450;
const EYE_M = 1.8;
const SKY_M = 95000; // distance at which Sun, Earth and stars are drawn (beyond the 100 km terrain)
// No air on the Moon: direct sunlight is harsh and shadows are nearly black (only faint earthshine fills them).
const SUN_I = 14, AMB_I = 0.04;
const D = Math.PI / 180;

interface Pose { e: number; n: number; yaw: number; pitch: number }

export default function ExploreView({ onBack }: { onBack?: () => void }) {
  const loc = useApp((s) => s.location());
  const time = useApp((s) => s.time);
  const override = useApp((s) => s.sunOverride);
  const expert = useExpert();
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const elev = useLatest(() => (loc ? api.elevation(loc, TILE_KM, TILE_RES).then((d) => ({ k: key, d })) : null), key);
  const hour = hourKey(time);
  const state = useLatest(() => (loc ? api.state(loc, hour) : null), `${key}|${hour}`);
  const sun = state.data ? { alt: override?.alt ?? state.data.sun.altitude, az: override?.az ?? state.data.sun.azimuth } : null;
  const earth = state.data ? { alt: state.data.earth.altitude, az: state.data.earth.azimuth } : null;

  const [pose, setPose] = useState<Pose>({ e: 0, n: -60, yaw: 0, pitch: -4 });
  const jump = useRef<{ e: number; n: number } | null>(null);
  const beacon = useRef<HTMLDivElement>(null); // floating lander marker, positioned every frame by the Scene
  useEffect(() => { jump.current = { e: 0, n: -60 }; }, [key]); // new site → stand next to the lander

  const wideTile = useLatest(() => (loc ? api.elevation(loc, WIDE_KM, WIDE_RES).then((d) => ({ k: key, d })) : null), `wide|${key}`);
  const wide = wideTile.data?.k === key ? wideTile.data.d.grid : null;
  const fineTile = useLatest(() => (loc ? api.elevation(loc, FINE_KM, FINE_RES).then((d) => ({ k: key, d })) : null), `fine|${key}`);
  const grid = elev.data?.k === key ? elev.data.d.grid : undefined;
  const synthetic = elev.data?.k === key ? elev.data.d.synthetic : undefined;
  const fine =fineTile.data?.k === key ? fineTile.data.d.grid : null;
  const ref = grid ? grid[TILE_RES >> 1][TILE_RES >> 1] : 0; // heights relative to the landing site
  // Measured height (20 m data near the site, 39 m beyond, blended) plus estimated detail finer than that data.
  const ground = useMemo(() => {
    if (!grid) return null;
    const coarse = (e: number, n: number) => sampleTile(grid, TILE_M, e, n) - ref + detail(e, n, TILE_STEP) - drop(e, n);
    if (!fine) return coarse;
    return (e: number, n: number) => {
      const d = Math.max(Math.abs(e), Math.abs(n));
      if (d >= FINE_M / 2) return coarse(e, n);
      const f = sampleTile(fine, FINE_M, e, n) - ref + detail(e, n, FINE_STEP) - drop(e, n);
      const t = (d - (FINE_M / 2 - BLEND_M)) / BLEND_M;
      if (t <= 0) return f;
      const w = t * t * (3 - 2 * t);
      return f * (1 - w) + coarse(e, n) * w;
    };
  }, [grid, fine, ref]);

  // Is the explorer in sunlight? March toward the Sun over the measured terrain, out to 50 km, with curvature.
  const lit = useMemo(() => {
    if (!grid || !sun || !ground) return null;
    if (sun.alt <= 0) return false;
    const h0 = ground(pose.e, pose.n) + EYE_M;
    const se = Math.sin(sun.az * D), sn = Math.cos(sun.az * D);
    let maxA = -90;
    for (let d = 20; d < 50000; d *= 1.06) {
      const e = pose.e + se * d, n = pose.n + sn * d;
      const inTile = Math.abs(e) < TILE_M / 2 && Math.abs(n) < TILE_M / 2;
      if (!inTile && (!wide || Math.abs(e) > WIDE_M / 2 || Math.abs(n) > WIDE_M / 2)) break;
      const z = d < 600 ? ground(e, n) : (inTile ? sampleTile(grid, TILE_M, e, n) : sampleTile(wide!, WIDE_M, e, n)) - ref - drop(e, n);
      maxA = Math.max(maxA, Math.atan2(z - h0, d) / D);
    }
    return sun.alt > maxA;
  }, [grid, wide, ref, ground, sun?.alt, sun?.az, Math.round(pose.e / 10), Math.round(pose.n / 10)]);

  if (!loc) return <div className="panel"><p className="muted">Pick a landing site first.</p></div>;
  const here = destination(loc.lat, loc.lon, (Math.atan2(pose.e, pose.n) / D + 360) % 360, Math.hypot(pose.e, pose.n) / 1000);
  const dist = Math.hypot(pose.e, pose.n);

  return (
    <div className="panel explore">
      <div className="topo-head">
        <h3>Explore on foot {elev.loading && <span className="spinner" aria-label="loading" />}</h3>
        <div className="topo-controls" style={{ margin: 0 }}>
          <button onClick={() => { jump.current = { e: 0, n: -60 }; }}>Back to the lander</button>
          {onBack && <button onClick={onBack}>Leave</button>}
        </div>
      </div>
      <div className="explore-stage" tabIndex={0} aria-label="Ground-level view. Drag to look around, W A S D or arrow keys to walk.">
        {!grid || !ground ? <div className="profile-loading">{elev.error ?? "Landing the explorer…"}</div> : (
          <Canvas shadows camera={{ fov: 70, near: 0.5, far: 150000, up: [0, 0, 1], position: [0, -60, 2] }}
            gl={{ antialias: true }} onCreated={({ scene }) => { scene.background = new THREE.Color("#000000"); }}>
            <Scene grid={grid} wide={wide} refH={ref} ground={ground} sun={sun} earth={earth}
              pose={pose} onPose={setPose} jump={jump} beacon={beacon}
              siteName={loc.site?.name ?? "Landing site"} />
          </Canvas>
        )}
        <div className="site-beacon" ref={beacon} hidden aria-hidden="true">
          <svg className="sb-glyph" viewBox="0 0 16 16" width={14} height={14}><path d="M3 5.5 8 11l5-5.5" /></svg>
          <span className="sb-label" />
        </div>
        <div className="explore-hud">
          <div><b>{compass(pose.yaw)}</b> {Math.round(((pose.yaw % 360) + 360) % 360)}° · {lit == null ? "…" : lit ? "☀ you are in sunlight" : "☾ you are in shadow"}</div>
          <div className="muted small">
            {dist < 30 ? "At the lander" : `${(dist / 1000).toFixed(2)} km ${compass(Math.atan2(pose.e, pose.n) / D)} of the site`}
            {ground && ` · ground ${Math.round(ground(pose.e, pose.n) + ref).toLocaleString()} m`}
            {expert && ` · ${fmtLat(here.lat)}, ${fmtLon(here.lon)}`}
          </div>
          {sun && <div className="muted small">Sun {sun.alt > 0 ? `${sun.alt.toFixed(1)}° up in the ${compass(sun.az)}` : "below the horizon"}{earth ? ` · Earth ${earth.alt > 0 ? `${earth.alt.toFixed(1)}° up in the ${compass(earth.az)}` : "below the horizon"}` : ""}</div>}
        </div>
        {grid && <MiniMap grid={grid} pose={pose} onJump={(e, n) => { jump.current = { e, n }; }} />}
      </div>
      <div className="muted small">
        Drag to look around · <b>W/S</b> or <b>↑/↓</b> walk · <b>A/D</b> step sideways · <b>←/→</b> turn · hold <b>Shift</b> for rover speed · click the mini-map to jump.
        {" "}Height data{synthetic === false ? " (NASA LOLA)" : synthetic ? " (synthetic model: the LOLA file is not installed)" : ""}: {fine ? `${Math.round(FINE_STEP)} m per sample within ${FINE_KM / 2} km of the site, ` : "loading the 20 m data near the site… "}{Math.round(TILE_STEP)} m to {TILE_KM / 2} km{wide ? `, ${Math.round(WIDE_M / (WIDE_RES - 1))} m out to ${WIDE_KM / 2} km for the skyline` : ""}. The Moon's curvature is included.
        {" "}<span className="estimate-note">Anything smaller than that (small craters, bumps, grain) is an <b>estimate</b>: it follows real crater statistics but is not measured.</span>
        {" "}Heights are true scale (no exaggeration).
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
interface SceneProps {
  grid: number[][];
  wide: number[][] | null;
  refH: number;
  ground: (e: number, n: number) => number;
  sun: { alt: number; az: number } | null;
  earth: { alt: number; az: number } | null;
  pose: Pose;
  onPose: (p: Pose) => void;
  jump: React.MutableRefObject<{ e: number; n: number } | null>;
  beacon: React.RefObject<HTMLDivElement>;
  siteName: string;
}

const dirVec = (alt: number, az: number) => new THREE.Vector3(Math.sin(az * D) * Math.cos(alt * D), Math.cos(az * D) * Math.cos(alt * D), Math.sin(alt * D));

/** Terrain mesh from a backend tile (site at the centre), heights relative to the site, Moon curvature applied. */
function tileGeometry(grid: number[][], sizeM: number, refH: number) {
  const m = grid.length;
  const g = new THREE.PlaneGeometry(sizeM, sizeM, m - 1, m - 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, grid[Math.floor(i / m)][i % m] - refH - drop(p.getX(i), p.getY(i)));
  g.computeVertexNormals();
  return g;
}

/** Leave out the triangles that lie inside a square hole (shrunk by one cell so the edges overlap the inner mesh). */
function cutHole(g: THREE.BufferGeometry, m: number, sizeM: number, ce: number, cn: number, holeHalf: number) {
  const px = sizeM / (m - 1), inner = holeHalf - px;
  const idx: number[] = [];
  for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) {
    const e0 = -sizeM / 2 + c * px, n0 = sizeM / 2 - r * px;
    if (e0 > ce - inner && e0 + px < ce + inner && n0 - px > cn - inner && n0 < cn + inner) continue;
    const a = r * m + c, b = a + 1, cc = a + m, d = cc + 1;
    idx.push(a, cc, b, cc, d, b);
  }
  g.setIndex(idx);
}

function Scene({ grid, wide, refH, ground, sun, earth, pose, onPose, jump, beacon, siteName }: SceneProps) {
  const { camera, gl } = useThree();
  const [center, setCenter] = useState({ e: 0, n: 0 });
  // ---- terrain: 20 km tile with a hole where the detailed patch sits, inside a 100 km skyline ring
  const far = useMemo(() => tileGeometry(grid, TILE_M, refH), [grid, refH]);
  useMemo(() => cutHole(far, grid.length, TILE_M, center.e, center.n, PATCH_M / 2), [far, grid, center.e, center.n]);
  const ring = useMemo(() => {
    if (!wide) return null;
    const g = tileGeometry(wide, WIDE_M, refH);
    cutHole(g, wide.length, WIDE_M, 0, 0, TILE_M / 2);
    return g;
  }, [wide, refH]);

  // ---- terrain: detailed patch around the explorer (measured + estimated detail)
  const patch = useMemo(() => {
    const g = new THREE.PlaneGeometry(PATCH_M, PATCH_M, PATCH_SEG, PATCH_SEG);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, ground(center.e + p.getX(i), center.n + p.getY(i)));
    g.computeVertexNormals();
    return g;
  }, [ground, center.e, center.n]);

  // ---- materials
  // matte (lunar soil has no shine) with metre-scale roughness that a low Sun picks out
  const photo = useMemo(() => groundMaterial(), []);

  // ---- sky
  const sunDir = sun ? dirVec(sun.alt, sun.az) : null;
  const earthDir = earth ? dirVec(earth.alt, earth.az) : null;
  const stars = useMemo(() => {
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(t) * SKY_M, r * Math.sin(t) * SKY_M, z * SKY_M], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const sky = useRef<THREE.Group>(null);

  // ---- first-person controls
  const st = useRef({ ...pose });
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); el.parentElement?.focus(); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      st.current.yaw -= (e.clientX - drag.x) * 0.25;
      st.current.pitch = Math.max(-80, Math.min(80, st.current.pitch + (e.clientY - drag.y) * 0.2));
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => { drag = null; };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
        keys.current.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
    };
  }, [gl]);

  const landerZ = useMemo(() => ground(0, 0), [ground]);
  const lastReport = useRef(0);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current, k = keys.current;
    if (jump.current) { s.e = jump.current.e; s.n = jump.current.n; jump.current = null; }
    const speed = k.has("shift") ? 120 : 12; // m/s: brisk walk vs rover
    if (k.has("arrowleft")) s.yaw -= 70 * dt;
    if (k.has("arrowright")) s.yaw += 70 * dt;
    const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const side = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    const y = s.yaw * D;
    s.e += (Math.sin(y) * fwd + Math.cos(y) * side) * speed * dt;
    s.n += (Math.cos(y) * fwd - Math.sin(y) * side) * speed * dt;
    const lim = TILE_M / 2 - PATCH_M / 2;
    s.e = Math.max(-lim, Math.min(lim, s.e));
    s.n = Math.max(-lim, Math.min(lim, s.n));

    const z = ground(s.e, s.n) + EYE_M;
    camera.position.set(s.e, s.n, z);
    const p = s.pitch * D;
    camera.up.set(0, 0, 1);
    camera.lookAt(s.e + Math.sin(y) * Math.cos(p), s.n + Math.cos(y) * Math.cos(p), z + Math.sin(p));
    sky.current?.position.copy(camera.position);
    placeBeacon(beacon.current, camera, gl.domElement, landerZ + BEACON_UP_M, Math.hypot(s.e, s.n), siteName);

    const now = performance.now();
    if (now - lastReport.current > 150) {
      lastReport.current = now;
      onPose({ ...s });
      if (Math.hypot(s.e - center.e, s.n - center.n) > RECENTER_M) setCenter({ e: Math.round(s.e / 50) * 50, n: Math.round(s.n / 50) * 50 });
    }
  });

  const sunUp = !!sun && sun.alt > 0;
  // The shadow volume is ±11 km across (the area you can walk) but reaches 60 km toward the Sun, so crater
  // rims up to 50 km away still cast their shadows here.
  const lightPos = sunDir ? sunDir.clone().multiplyScalar(60000) : new THREE.Vector3(0, 0, 1);
  const sunR = SKY_M * Math.tan(0.27 * D) * 2.2, earthR = SKY_M * Math.tan(0.95 * D);

  return (
    <>
      <ambientLight intensity={AMB_I} />
      <directionalLight position={lightPos} intensity={sunUp ? SUN_I : 0} castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-11000} shadow-camera-right={11000}
        shadow-camera-top={11000} shadow-camera-bottom={-11000} shadow-camera-near={100} shadow-camera-far={75000}
        shadow-bias={-0.0004} shadow-normalBias={4} />
      <mesh geometry={far} material={photo} castShadow receiveShadow />
      {ring && <mesh geometry={ring} material={photo} castShadow receiveShadow />}
      <mesh geometry={patch} material={photo} position={[center.e, center.n, 0]} castShadow receiveShadow />
      <Lander z={ground(0, 0)} />
      <group ref={sky}>
        <points geometry={stars}><pointsMaterial color="#cfd6e6" size={1.4} sizeAttenuation={false} /></points>
        {sunDir && (
          <DetailedSun
            position={sunDir.clone().multiplyScalar(SKY_M)}
            radius={sunR}
            label={sunUp ? "☀️ Sun" : undefined}
            opacity={sunUp ? 1.0 : 0.25}
          />
        )}
        {earthDir && (
          <DetailedEarth
            position={earthDir.clone().multiplyScalar(SKY_M)}
            radius={earthR}
            label="🌍 Earth"
            opacity={1.0}
          />
        )}
      </group>
    </>
  );
}

// ---- landing-site marker: a small screen-space pointer (site name + distance) that hovers over the lander at any distance, or sits at the
// edge of the view as an arrow when the lander is off-screen or behind you. Updated straight on the DOM each
// frame (no React re-render).
const BEACON_UP_M = 7; // anchor a little above the lander's top
const BEACON_HIDE_M = 25; // standing at the lander: no marker needed
const EDGE_X = 66, EDGE_Y = 34; // px from the view edges for the off-screen arrow (room for its label at the sides)
const _v = new THREE.Vector3();

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function placeBeacon(el: HTMLDivElement | null, camera: THREE.Camera, canvas: HTMLCanvasElement, z: number, dist: number, name: string) {
  if (!el) return;
  if (dist < BEACON_HIDE_M) { el.hidden = true; return; }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  _v.set(0, 0, z).applyMatrix4(camera.matrixWorldInverse); // camera space: -z is in front
  const behind = _v.z > 0;
  _v.set(0, 0, z).project(camera);
  let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
  const onScreen = !behind && x >= EDGE_X && x <= w - EDGE_X && y >= EDGE_Y && y <= h - EDGE_Y;
  let rot = 0;
  if (!onScreen) {
    // direction from the view centre toward the lander (flipped when it is behind the camera), clamped to the edge
    let dx = x - w / 2, dy = y - h / 2;
    if (behind) { dx = -dx; dy = -dy; }
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    const k = Math.min((w / 2 - EDGE_X) / Math.max(Math.abs(dx), 1e-6), (h / 2 - EDGE_Y) / Math.max(Math.abs(dy), 1e-6));
    x = w / 2 + dx * k; y = h / 2 + dy * k;
    rot = Math.atan2(dy, dx) * (180 / Math.PI) - 90; // the glyph points down (+y) by default
  }
  el.hidden = false;
  el.classList.toggle("edge", !onScreen);
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const glyph = el.firstElementChild as SVGElement | null;
  if (glyph) glyph.style.transform = onScreen ? "" : `rotate(${rot.toFixed(1)}deg)`;
  const label = el.lastElementChild as HTMLElement | null;
  const text = `${name} · ${fmtDist(dist)}`;
  if (label && label.textContent !== text) label.textContent = text;
  if (label) {
    // keep long site names inside the view: slide the label sideways, never the pointer
    const half = label.offsetWidth / 2, lx = Math.max(half + 8, Math.min(w - half - 8, x));
    label.style.marginLeft = `${(lx - x).toFixed(1)}px`;
  }
}

/** A simple lander at the landing site, true scale (~4 m wide, ~4 m tall). */
function Lander({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 2.6]} castShadow>
        <boxGeometry args={[2.4, 2.4, 1.8]} />
        <meshStandardMaterial color="#d8c27a" metalness={0.6} roughness={0.35} />
      </mesh>
      {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b], i) => (
        <mesh key={i} position={[a * 1.6, b * 1.6, 0.9]} rotation={[b * 0.45, -a * 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 2.2, 8]} />
          <meshStandardMaterial color="#bbbbbb" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Top-down mini-map of the 20 km tile: you (with your view direction) and the lander. Click to jump. */
function MiniMap({ grid, pose, onJump }: { grid: number[][]; pose: Pose; onJump: (e: number, n: number) => void }) {
  const img = useMemo(() => {
    const m = grid.length, c = document.createElement("canvas");
    c.width = m; c.height = m;
    const ctx = c.getContext("2d")!, im = ctx.createImageData(m, m);
    let lo = Infinity, hi = -Infinity;
    for (const row of grid) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let r = 0; r < m; r++) for (let q = 0; q < m; q++) {
      const v = grid[r][q], dx = grid[r][Math.min(m - 1, q + 1)] - grid[r][Math.max(0, q - 1)], dy = grid[Math.min(m - 1, r + 1)][q] - grid[Math.max(0, r - 1)][q];
      const shade = Math.max(0, Math.min(1, 0.55 + (dy - dx) / 400));
      const g = 40 + 140 * ((v - lo) / (hi - lo + 1e-6)) * 0.5 + 110 * shade * 0.6;
      const o = (r * m + q) * 4;
      im.data[o] = g; im.data[o + 1] = g; im.data[o + 2] = g * 1.05; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL();
  }, [grid]);
  const S = 170, k = S / TILE_M;
  const x = S / 2 + pose.e * k, y = S / 2 - pose.n * k;
  const y0 = pose.yaw * D;
  const wedge = (a: number) => `${x + Math.sin(y0 + a) * 22},${y - Math.cos(y0 + a) * 22}`;
  return (
    <svg className="explore-mini" width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Mini-map. Click to jump there."
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onJump(((e.clientX - r.left) / r.width - 0.5) * TILE_M, (0.5 - (e.clientY - r.top) / r.height) * TILE_M);
      }}>
      <image href={img} width={S} height={S} preserveAspectRatio="none" />
      <rect x={S / 2 - 5} y={S / 2 - 5} width={10} height={10} fill="none" stroke="#fff" strokeWidth={1.5} />
      <path d={`M${S / 2 - 5},${S / 2}H${S / 2 + 5}M${S / 2},${S / 2 - 5}V${S / 2 + 5}`} stroke="#fff" strokeWidth={1} />
      <path d={`M${x},${y} L${wedge(-0.6)} L${wedge(0.6)} Z`} fill="rgba(232,163,61,0.45)" />
      <circle cx={x} cy={y} r={4} fill="var(--sun)" stroke="#000" />
      <text x={6} y={14} fontSize={11} fill="#fff">N ↑ · 20 km</text>
    </svg>
  );
}
