// EXPLORE ON FOOT: drop an explorer on the surface and walk around at eye height, like street view.
// Owner: Visualization.
//   Measured: 20 km elevation tile (/api/terrain/elevation, ~78 m per sample) → the far terrain and horizon.
//   Estimated: small craters and bumps below that resolution (lib/regolith.ts) on a 2.4 km patch around you.
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
import { engravingMaterial, flatBrightness } from "./engraving";
import { groundMaterial } from "./groundMaterial";

const TILE_KM = 20;
const TILE_RES = 511; // ~39 m per sample (the backend allows at most 512 across)
// Sharper data near the site: 10 km at 20 m per sample (the resolution of NASA's LOLA south-pole maps).
const FINE_KM = 10, FINE_RES = 501, FINE_M = FINE_KM * 1000;
const FINE_STEP = FINE_M / (FINE_RES - 1), TILE_STEP = (TILE_KM * 1000) / (TILE_RES - 1);
const BLEND_M = 700; // fade from the 20 m data to the 39 m data over the last 700 m of the fine tile
const TILE_M = TILE_KM * 1000;
const PATCH_M = 1600; // detailed ground around the explorer
const PATCH_SEG = 320; // 5 m spacing, so estimated craters down to ~10 m show
const RECENTER_M = 450;
const EYE_M = 1.8;
const SKY_M = 60000; // distance at which Sun, Earth and stars are drawn
// No air on the Moon: direct sunlight is harsh and shadows are nearly black (only faint earthshine fills them).
const SUN_I = 14, AMB_I = 0.04;
const D = Math.PI / 180;

type Look = "photo" | "engraving";
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

  const [look, setLook] = useState<Look>("photo");
  const [pose, setPose] = useState<Pose>({ e: 0, n: -60, yaw: 0, pitch: -4 });
  const jump = useRef<{ e: number; n: number } | null>(null);
  useEffect(() => { jump.current = { e: 0, n: -60 }; }, [key]); // new site → stand next to the lander

  const fineTile = useLatest(() => (loc ? api.elevation(loc, FINE_KM, FINE_RES).then((d) => ({ k: key, d })) : null), `fine|${key}`);
  const grid = elev.data?.k === key ? elev.data.d.grid : undefined;
  const fine =fineTile.data?.k === key ? fineTile.data.d.grid : null;
  const ref = grid ? grid[TILE_RES >> 1][TILE_RES >> 1] : 0; // heights relative to the landing site
  // Measured height (20 m data near the site, 39 m beyond, blended) plus estimated detail finer than that data.
  const ground = useMemo(() => {
    if (!grid) return null;
    const coarse = (e: number, n: number) => sampleTile(grid, TILE_M, e, n) - ref + detail(e, n, TILE_STEP);
    if (!fine) return coarse;
    return (e: number, n: number) => {
      const d = Math.max(Math.abs(e), Math.abs(n));
      if (d >= FINE_M / 2) return coarse(e, n);
      const f = sampleTile(fine, FINE_M, e, n) - ref + detail(e, n, FINE_STEP);
      const t = (d - (FINE_M / 2 - BLEND_M)) / BLEND_M;
      if (t <= 0) return f;
      const w = t * t * (3 - 2 * t);
      return f * (1 - w) + coarse(e, n) * w;
    };
  }, [grid, fine, ref]);

  // Is the explorer in sunlight? March toward the Sun over the measured terrain.
  const lit = useMemo(() => {
    if (!grid || !sun || !ground) return null;
    if (sun.alt <= 0) return false;
    const h0 = ground(pose.e, pose.n) + EYE_M;
    const se = Math.sin(sun.az * D), sn = Math.cos(sun.az * D);
    let maxA = -90;
    for (let d = 20; d < 12000; d *= 1.08) {
      const e = pose.e + se * d, n = pose.n + sn * d;
      if (Math.abs(e) > TILE_M / 2 || Math.abs(n) > TILE_M / 2) break;
      const h = (d < 600 ? ground(e, n) : sampleTile(grid, TILE_M, e, n) - ref) - h0;
      maxA = Math.max(maxA, Math.atan2(h, d) / D);
    }
    return sun.alt > maxA;
  }, [grid, ref, ground, sun?.alt, sun?.az, Math.round(pose.e / 10), Math.round(pose.n / 10)]);

  if (!loc) return <div className="panel"><p className="muted">Pick a landing site first.</p></div>;
  const here = destination(loc.lat, loc.lon, (Math.atan2(pose.e, pose.n) / D + 360) % 360, Math.hypot(pose.e, pose.n) / 1000);
  const dist = Math.hypot(pose.e, pose.n);

  return (
    <div className="panel explore">
      <div className="topo-head">
        <h3>Explore on foot {elev.loading && <span className="spinner" aria-label="loading" />}</h3>
        <div className="topo-controls" style={{ margin: 0 }}>
          <div className="tabs" role="group" aria-label="Look">
            <button className={look === "photo" ? "active" : ""} onClick={() => setLook("photo")}>Realistic</button>
            <button className={look === "engraving" ? "active" : ""} onClick={() => setLook("engraving")}>Engraving</button>
          </div>
          <button onClick={() => { jump.current = { e: 0, n: -60 }; }}>Back to the lander</button>
          {onBack && <button onClick={onBack}>Leave</button>}
        </div>
      </div>
      <div className="explore-stage" tabIndex={0} aria-label="Ground-level view. Drag to look around, W A S D or arrow keys to walk.">
        {!grid || !ground ? <div className="profile-loading">{elev.error ?? "Landing the explorer…"}</div> : (
          <Canvas shadows camera={{ fov: 70, near: 0.5, far: 150000, up: [0, 0, 1], position: [0, -60, 2] }}
            gl={{ antialias: true }} onCreated={({ scene }) => { scene.background = new THREE.Color(look === "photo" ? "#000000" : "#efe7d4"); }}>
            <Scene grid={grid} refH={ref} ground={ground} look={look} sun={sun} earth={earth}
              pose={pose} onPose={setPose} jump={jump} />
          </Canvas>
        )}
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
        {" "}Height data: {fine ? `${Math.round(FINE_STEP)} m per sample within ${FINE_KM / 2} km of the site, ` : "loading the 20 m data near the site… "}{Math.round(TILE_STEP)} m beyond.
        {" "}<span className="estimate-note">Anything smaller than that (small craters, bumps, grain) is an <b>estimate</b>: it follows real crater statistics but is not measured.</span>
        {" "}Heights are true scale (no exaggeration).
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
interface SceneProps {
  grid: number[][];
  refH: number;
  ground: (e: number, n: number) => number;
  look: Look;
  sun: { alt: number; az: number } | null;
  earth: { alt: number; az: number } | null;
  pose: Pose;
  onPose: (p: Pose) => void;
  jump: React.MutableRefObject<{ e: number; n: number } | null>;
}

const dirVec = (alt: number, az: number) => new THREE.Vector3(Math.sin(az * D) * Math.cos(alt * D), Math.cos(az * D) * Math.cos(alt * D), Math.sin(alt * D));

function Scene({ grid, refH, ground, look, sun, earth, pose, onPose, jump }: SceneProps) {
  const { camera, gl, scene } = useThree();
  const [center, setCenter] = useState({ e: 0, n: 0 });
  useEffect(() => { scene.background = new THREE.Color(look === "photo" ? "#000000" : "#efe7d4"); }, [look, scene]);
  // ---- terrain: far tile (measured) with a hole where the detailed patch sits
  const far = useMemo(() => {
    const m = grid.length;
    const g = new THREE.PlaneGeometry(TILE_M, TILE_M, m - 1, m - 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, grid[Math.floor(i / m)][i % m] - refH);
    g.computeVertexNormals();
    return g;
  }, [grid, refH]);
  useMemo(() => {
    // drop triangles that lie fully inside the patch (shrunk by one tile cell so the edges overlap)
    const m = grid.length, px = TILE_M / (m - 1), inner = PATCH_M / 2 - px;
    const idx: number[] = [];
    for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) {
      const e0 = -TILE_M / 2 + c * px, n0 = TILE_M / 2 - r * px;
      const inside = e0 > center.e - inner && e0 + px < center.e + inner && n0 - px > center.n - inner && n0 < center.n + inner;
      if (inside) continue;
      const a = r * m + c, b = a + 1, cc = a + m, d = cc + 1;
      idx.push(a, cc, b, cc, d, b);
    }
    far.setIndex(idx);
  }, [far, grid, center.e, center.n]);

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
  const engr = useMemo(() => engravingMaterial({ interval: 4, hatch: 3 }), []);
  const engrFar = useMemo(() => engravingMaterial({ interval: 50, hatch: 40 }), []);
  useEffect(() => {
    const f = flatBrightness(sun?.alt ?? 0, sun && sun.alt > 0 ? SUN_I : 0, AMB_I * (look === "engraving" ? 4 : 1));
    engr.uniforms.uFlat.value = f;
    engrFar.uniforms.uFlat.value = f;
  }, [sun?.alt, engr, engrFar, look]);
  const mat = look === "photo" ? photo : engr.material;
  const matFar = look === "photo" ? photo : engrFar.material;

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

    const now = performance.now();
    if (now - lastReport.current > 150) {
      lastReport.current = now;
      onPose({ ...s });
      if (Math.hypot(s.e - center.e, s.n - center.n) > RECENTER_M) setCenter({ e: Math.round(s.e / 50) * 50, n: Math.round(s.n / 50) * 50 });
    }
  });

  const sunUp = !!sun && sun.alt > 0;
  const lightPos = sunDir ? sunDir.clone().multiplyScalar(30000) : new THREE.Vector3(0, 0, 1);
  const sunR = SKY_M * Math.tan(0.27 * D) * 2.2, earthR = SKY_M * Math.tan(0.95 * D);

  return (
    <>
      <ambientLight intensity={AMB_I * (look === "engraving" ? 4 : 1)} />
      <directionalLight position={lightPos} intensity={sunUp ? SUN_I : 0} castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-11000} shadow-camera-right={11000}
        shadow-camera-top={11000} shadow-camera-bottom={-11000} shadow-camera-near={1} shadow-camera-far={70000}
        shadow-bias={-0.0004} shadow-normalBias={4} />
      <mesh geometry={far} material={matFar} castShadow receiveShadow />
      <mesh geometry={patch} material={mat} position={[center.e, center.n, 0]} castShadow receiveShadow />
      <Lander z={ground(0, 0)} />
      <group ref={sky}>
        {look === "photo" && <points geometry={stars}><pointsMaterial color="#cfd6e6" size={1.4} sizeAttenuation={false} /></points>}
        {sunDir && (
          <mesh position={sunDir.clone().multiplyScalar(SKY_M)}>
            <sphereGeometry args={[sunR, 24, 16]} />
            <meshBasicMaterial color={look === "photo" ? "#fff6d8" : "#e8a33d"} />
          </mesh>
        )}
        {earthDir && (
          <mesh position={earthDir.clone().multiplyScalar(SKY_M)}>
            <sphereGeometry args={[earthR, 32, 20]} />
            <meshBasicMaterial color="#4d8fff" />
          </mesh>
        )}
      </group>
    </>
  );
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
