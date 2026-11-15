// BLOCK DIAGRAM: the terrain as a solid block with contour lines drawn on it, cut sides showing the
// height lines, and the flat contour map floating below it with dashed lines dropping from the block's
// front edge, like a geography textbook figure. Owner: Visualization.
//   heights: /api/terrain/elevation · Sun: /api/ephemeris/state
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api } from "../../api/client";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { fmtLat, fmtLon } from "../../lib/geo";
import { contours, levels, niceInterval } from "../../lib/topo";
import { useApp } from "../../state/store";
import { useExpert } from "../learn/ModeGate";
import { engravingMaterial, flatBrightness } from "./engraving";

// Aim for 20 m per sample (the resolution of NASA's LOLA south-pole maps). The backend allows at most 512
// samples across, so 10 km gets 20 m, 20 km ~39 m, 50 km ~98 m. Odd, so the site is exactly the centre sample.
const TARGET_M = 20;
const resFor = (sizeKm: number) => Math.min(511, Math.round((sizeKm * 1000) / TARGET_M) + 1) | 1;
const THICK = 0.12; // block thickness below the lowest point, as a fraction of its width
const SUN_I = 3, AMB_I = 0.35;
const INK = "#2b2419", PAPER = "#efe7d4";

export default function BlockDiagram() {
  const loc = useApp((s) => s.location());
  const time = useApp((s) => s.time);
  const override = useApp((s) => s.sunOverride);
  const expert = useExpert();
  const [sizeKm, setSizeKm] = useState(10);
  const [resetKey, setResetKey] = useState(0);
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const res = resFor(sizeKm);
  const reqKey = `${key}|${sizeKm}`;
  // tag each response with its request, so a new site never shows the previous site's block
  const elev = useLatest(() => (loc ? api.elevation(loc, sizeKm, res).then((d) => ({ k: reqKey, d })) : null), reqKey);
  const tile = elev.data?.k === reqKey ? elev.data.d : null;
  const hour = hourKey(time);
  const state = useLatest(() => (loc ? api.state(loc, hour) : null), `${key}|${hour}`);
  const sun = state.data ? { alt: override?.alt ?? state.data.sun.altitude, az: override?.az ?? state.data.sun.azimuth } : null;
  const where = loc?.site ? `Site ${loc.site.id} · ${loc.site.name}` : loc ? `${fmtLat(loc.lat)}, ${fmtLon(loc.lon)}` : "";

  const info = useMemo(() => {
    const g = tile?.grid;
    if (!g) return null;
    let lo = Infinity, hi = -Infinity;
    for (const r of g) for (const v of r) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const exag = Math.max(1, Math.min(8, (0.3 * sizeKm * 1000) / Math.max(1, hi - lo)));
    const step = niceInterval(hi - lo, 12);
    return { g, lo, hi, exag, step, lv: levels(lo, hi, step) };
  }, [tile, sizeKm]);

  return (
    <div className="panel">
      <div className="topo-head">
        <h3>Block diagram · {where} {tile?.synthetic && <small>(synthetic terrain)</small>} {elev.loading && <span className="spinner" aria-label="loading" />}</h3>
        <div className="topo-controls" style={{ margin: 0 }}>
          <div className="tabs" role="group" aria-label="Area">
            {[10, 20, 50].map((k) => <button key={k} className={sizeKm === k ? "active" : ""} onClick={() => setSizeKm(k)}>{k} km</button>)}
          </div>
          <button onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
        </div>
      </div>
      <div className="block-stage">
        {!info || !loc ? <div className="profile-loading">{elev.error ?? (loc ? `Cutting the block for ${where}…` : "Pick a landing site first.")}</div> : (
          <Canvas shadows camera={{ position: [sizeKm * 1.35, -sizeKm * 1.9, sizeKm * 1.15], up: [0, 0, 1], fov: 40 }}
            onCreated={({ scene }) => { scene.background = new THREE.Color(PAPER); }}>
            <Block info={info} sizeKm={sizeKm} sun={sun} resetKey={`${resetKey}|${reqKey}`} />
          </Canvas>
        )}
      </div>
      <div className="muted small">
        {expert && info
          ? `Contours every ${info.step} m · ${Math.round(info.lo).toLocaleString()} to ${Math.round(info.hi).toLocaleString()} m · ${Math.round((sizeKm * 1000) / (res - 1))} m per sample · heights ×${info.exag.toFixed(1)} · Sun ${sun ? `${sun.alt.toFixed(1)}° from ${Math.round(sun.az)}°` : "…"}. `
          : `${sizeKm} km of ground cut out around the site, about ${Math.round((sizeKm * 1000) / (res - 1))} m between height samples. The numbers up the side are real heights; the map underneath is what you get by flattening the contour lines straight down. `}
        Drag to turn · scroll to zoom.
      </div>
    </div>
  );
}

interface Info { g: number[][]; lo: number; hi: number; exag: number; step: number; lv: number[] }

/** A text label that always faces the camera (no font library needed). */
function makeLabel(text: string, heightWorld: number) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d")!;
  const fs = 44;
  ctx.font = `${fs}px Georgia, serif`;
  c.width = Math.ceil(ctx.measureText(text).width) + 12; c.height = fs + 12;
  ctx.fillStyle = PAPER; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, c.width, c.height); ctx.globalAlpha = 1;
  ctx.font = `${fs}px Georgia, serif`; ctx.fillStyle = INK; ctx.textBaseline = "middle";
  ctx.fillText(text, 6, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false }));
  s.scale.set((heightWorld * c.width) / c.height, heightWorld, 1);
  s.center.set(0, 0.5);
  return s;
}

function Block({ info, sizeKm, sun, resetKey }: { info: Info; sizeKm: number; sun: { alt: number; az: number } | null; resetKey: string }) {
  const { camera, gl } = useThree();
  const { g, lo, exag, step, lv } = info;
  const m = g.length, half = sizeKm / 2, px = sizeKm / (m - 1);
  const base = THICK * sizeKm; // block bottom at z = 0
  const Z = (h: number) => base + ((h - lo) / 1000) * exag;
  const mapZ = -0.55 * sizeKm;

  // top surface
  const top = useMemo(() => {
    const geo = new THREE.PlaneGeometry(sizeKm, sizeKm, m - 1, m - 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Z(g[Math.floor(i / m)][i % m]));
    geo.computeVertexNormals();
    return geo;
  }, [g, sizeKm, exag]);

  // four cut sides: a strip from the bottom (z = 0) up to the surface along each edge
  const sides = useMemo(() => {
    const edges: [number, number, number][][] = [[], [], [], []];
    for (let i = 0; i < m; i++) {
      const x = -half + i * px, y = half - i * px;
      edges[0].push([x, half, Z(g[0][i])]); // north
      edges[1].push([x, -half, Z(g[m - 1][i])]); // south
      edges[2].push([-half, y, Z(g[i][0])]); // west
      edges[3].push([half, y, Z(g[i][m - 1])]); // east
    }
    const pos: number[] = [];
    for (const e of edges) for (let i = 0; i + 1 < e.length; i++) {
      const [a, b] = [e[i], e[i + 1]];
      pos.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], b[2], a[0], a[1], 0, b[0], b[1], b[2], a[0], a[1], a[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }, [g, sizeKm, exag]);

  // flat contour map below, drawn like the textbook figure
  const mapTex = useMemo(() => {
    const S = 1024, c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, S, S);
    const z = new Float64Array(m * m);
    for (let r = 0; r < m; r++) for (let q = 0; q < m; q++) z[r * m + q] = g[r][q];
    const paths = contours(z, m, lv);
    ctx.save(); ctx.scale(S / (m - 1), S / (m - 1)); ctx.strokeStyle = INK; ctx.lineCap = "round";
    paths.forEach((d, k) => { ctx.lineWidth = (Math.round(lv[k] / step) % 5 === 0 ? 3.2 : 1.8) * ((m - 1) / S); ctx.stroke(new Path2D(d)); });
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.strokeRect(3, 3, S - 6, S - 6);
    // the site: plus sign in a box
    ctx.lineWidth = 4; ctx.strokeRect(S / 2 - 16, S / 2 - 16, 32, 32);
    ctx.beginPath(); ctx.moveTo(S / 2 - 16, S / 2); ctx.lineTo(S / 2 + 16, S / 2); ctx.moveTo(S / 2, S / 2 - 16); ctx.lineTo(S / 2, S / 2 + 16); ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [g, lv, step]);

  // dashed drop lines from where contours cross the block's front (south) and east edges down to the map
  const drops = useMemo(() => {
    const pts: number[] = [];
    const add = (x: number, y: number, h: number) => pts.push(x, y, Z(h), x, y, mapZ);
    for (let i = 1; i < m; i++) for (const l of lv) {
      const s0 = g[m - 1][i - 1], s1 = g[m - 1][i];
      if ((s0 - l) * (s1 - l) < 0) add(-half + (i - 1 + (l - s0) / (s1 - s0)) * px, -half, l);
      const e0 = g[i - 1][m - 1], e1 = g[i][m - 1];
      if ((e0 - l) * (e1 - l) < 0) add(half, half - (i - 1 + (l - e0) / (e1 - e0)) * px, l);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: INK, dashSize: sizeKm / 90, gapSize: sizeKm / 120, transparent: true, opacity: 0.7 }));
    line.computeLineDistances();
    return line;
  }, [g, lv, sizeKm, exag]);

  // real heights up the front-right (south-east) corner, like the numbers on a textbook block diagram
  const labels = useMemo(() => {
    const grp = new THREE.Group();
    const labelH = sizeKm * 0.05;
    const gap = (step / 1000) * exag; // vertical distance between two contour levels on the block
    const every = Math.max(1, Math.ceil((labelH * 1.4) / gap)); // never let labels overlap
    lv.forEach((l, k) => {
      if (k % every) return;
      const s = makeLabel(`${Math.round(l).toLocaleString()} m`, labelH);
      s.position.set(half + sizeKm * 0.03, -half - sizeKm * 0.03, Z(l));
      grp.add(s);
    });
    return grp;
  }, [lv, step, sizeKm, exag, lo]);

  const engrTop = useMemo(() => engravingMaterial({ interval: (step / 1000) * exag, hatch: sizeKm / 160 }), [step, exag, sizeKm]);
  const engrSide = useMemo(() => {
    const e = engravingMaterial({ interval: (step / 1000) * exag, hatch: sizeKm / 60 });
    e.material.side = THREE.DoubleSide;
    return e;
  }, [step, exag, sizeKm]);
  useEffect(() => {
    // sides are lit evenly so their height lines read like the printed figure
    engrTop.uniforms.uFlat.value = flatBrightness(sun?.alt ?? 30, sun && sun.alt > 0 ? SUN_I : 0, AMB_I);
    engrSide.uniforms.uFlat.value = 0.18;
  }, [sun?.alt, engrTop, engrSide]);

  // orbit controls (created in an effect so React StrictMode's dev remount gets a live instance)
  const [controls, setControls] = useState<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.minDistance = sizeKm * 0.3; c.maxDistance = sizeKm * 5;
    setControls(c);
    return () => c.dispose();
  }, [camera, gl, sizeKm]);
  useEffect(() => {
    if (!controls) return;
    camera.position.set(sizeKm * 1.35, -sizeKm * 1.9, sizeKm * 1.15);
    controls.target.set(0, 0, mapZ * 0.25);
    controls.update();
  }, [controls, resetKey, sizeKm]);

  const light = sun ? new THREE.Vector3(Math.sin(sun.az * Math.PI / 180) * Math.cos(sun.alt * Math.PI / 180), Math.cos(sun.az * Math.PI / 180) * Math.cos(sun.alt * Math.PI / 180), Math.sin(sun.alt * Math.PI / 180)).multiplyScalar(sizeKm * 3) : new THREE.Vector3(1, -1, 1);
  const r = sizeKm * 0.8;

  return (
    <>
      <ambientLight intensity={AMB_I} />
      <directionalLight position={light} intensity={sun && sun.alt > 0 ? SUN_I : 0} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r} shadow-camera-far={sizeKm * 8} shadow-bias={-0.0005} />
      <directionalLight position={[sizeKm, -sizeKm * 2, sizeKm]} intensity={0.6} />
      <mesh geometry={top} material={engrTop.material} castShadow receiveShadow />
      <mesh geometry={sides} material={engrSide.material} />
      <mesh position={[0, 0, mapZ]}>
        <planeGeometry args={[sizeKm, sizeKm]} />
        <meshBasicMaterial map={mapTex} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={drops} />
      <primitive object={labels} />
      {/* the site: a post standing on the block, and its spot on the map */}
      <mesh position={[0, 0, Z(g[(m - 1) / 2][(m - 1) / 2]) + sizeKm * 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[sizeKm * 0.004, sizeKm * 0.004, sizeKm * 0.06, 8]} />
        <meshBasicMaterial color="#c0392b" />
      </mesh>
    </>
  );
}
