// 3D terrain lit by a directional light at the sun's real alt/az. Owner: SKY3D (stretch).
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";

const VERT_EXAGGERATION = 3;
const SKY_KM = 16; // how far out the Sun and Earth markers are drawn (scene units are km)
const HOME: [number, number, number] = [0, -25, 18];

/** Unit vector toward a body, in the scene's x = east, y = north, z = up frame. */
function skyDir(alt: number, az: number) {
  const a = THREE.MathUtils.degToRad(alt), z = THREE.MathUtils.degToRad(az);
  return new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a));
}

/** Drag to orbit, scroll to zoom, right-drag to pan. `resetKey` changes → back to the starting view. */
function Controls({ resetKey }: { resetKey: number }) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement); // uses camera.up (z), so the ground stays level
    c.enableDamping = false;
    c.minDistance = 4;
    c.maxDistance = 70;
    c.maxPolarAngle = Math.PI / 2 - 0.02; // don't go under the ground
    return c;
  }, [camera, gl]);
  useEffect(() => () => controls.dispose(), [controls]);
  useEffect(() => {
    camera.position.set(...HOME);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [resetKey, camera, controls]);
  return null;
}

/** Sun or Earth drawn in its true direction. A line drops to the site so the direction reads in 3D. */
function SkyBody({ alt, az, color, radius }: { alt: number; az: number; color: string; radius: number }) {
  const pos = useMemo(() => skyDir(alt, az).multiplyScalar(SKY_KM), [alt, az]);
  const up = alt > 0;
  const line = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: up ? 0.6 : 0.2 }),
  ), [pos, color, up]);
  return (
    <group>
      <mesh position={pos}>
        <sphereGeometry args={[radius, 24, 16]} />
        <meshBasicMaterial color={color} transparent opacity={up ? 1 : 0.25} />
      </mesh>
      <primitive object={line} />
    </group>
  );
}

export default function Surface3D({ height = 380 }: { height?: number }) {
  const time = useApp((s) => s.time);
  const loc = useApp((s) => s.location());
  const key = loc ? `${loc.lat},${loc.lon}` : "";
  const elev = useApi(() => (loc ? api.elevation(loc, 20, 96) : null), [key]);
  const state = useApi(() => (loc ? api.state(loc, time.toISOString()) : null), [key, time.getTime()], 200);

  const geom = useMemo(() => {
    if (!elev.data) return null;
    const { grid, pixel_m } = elev.data;
    const n = grid.length, size = (n - 1) * pixel_m / 1000; // km
    const g = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
    const pos = g.attributes.position;
    // Heights relative to the landing site, so the site sits at z = 0 where the camera, lander and Sun/Earth
    // markers are anchored. (The regional terrain model is in real metres, e.g. Malapert's summit is ~5 km up.)
    const ref = grid[Math.floor(n / 2)][Math.floor(n / 2)];
    for (let i = 0; i < pos.count; i++) pos.setZ(i, ((grid[Math.floor(i / n)][i % n] - ref) / 1000) * VERT_EXAGGERATION);
    g.computeVertexNormals();
    return g;
  }, [elev.data]);

  const [resetKey, setResetKey] = useState(0);
  // The mesh is drawn relative to the site's height (see geom), so the lander sits on the surface at z = 0.
  const siteZ = 0;
  const earth = state.data?.earth;

  // Plane is in x(east)/y(north)/z(up) before we rotate it; light direction from sun alt/az.
  const sun = state.data?.sun;
  const light = useMemo(() => {
    if (!sun) return new THREE.Vector3(0, 10, 10);
    const alt = THREE.MathUtils.degToRad(sun.altitude), az = THREE.MathUtils.degToRad(sun.azimuth);
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)).multiplyScalar(30);
  }, [sun]);

  return (
    <div className="panel" style={{ height, display: "flex", flexDirection: "column" }}>
      <h3>3D view (height ×{VERT_EXAGGERATION}) <button onClick={() => setResetKey((k) => k + 1)}>Reset view</button></h3>
      <Canvas style={{ flex: 1, minHeight: 0, cursor: "grab" }} shadows camera={{ position: HOME, up: [0, 0, 1], fov: 45 }}>
        <Controls resetKey={resetKey} />
        <ambientLight intensity={0.12} />
        <directionalLight position={light} intensity={sun && sun.altitude > 0 ? 2 : 0} castShadow
          shadow-mapSize={[2048, 2048]} shadow-camera-left={-15} shadow-camera-right={15}
          shadow-camera-top={15} shadow-camera-bottom={-15} />
        {geom && (
          <mesh geometry={geom} castShadow receiveShadow>
            <meshStandardMaterial color="#9a9a9a" roughness={1} />
          </mesh>
        )}
        {/* lander: not to scale (a real lander would be far smaller than one pixel here) */}
        <group position={[0, 0, siteZ]}>
          <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.28, 0.7, 12]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0, 0.06]}>
            <ringGeometry args={[0.55, 0.7, 32]} />
            <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
          </mesh>
        </group>
        {sun && <SkyBody alt={sun.altitude} az={sun.azimuth} color="#e8a33d" radius={0.9} />}
        {earth && <SkyBody alt={earth.altitude} az={earth.azimuth} color="#4da3ff" radius={0.7} />}
      </Canvas>
      <div className="muted small">
        Drag to rotate · scroll to zoom · right-drag to pan.{" "}
        <span style={{ color: "var(--sun)" }}>●</span> Sun{sun ? ` ${sun.altitude.toFixed(1)}° ${sun.altitude > 0 ? "above" : "below"} the horizon` : ""} ·{" "}
        <span style={{ color: "var(--earth)" }}>●</span> Earth{earth ? ` ${earth.altitude.toFixed(1)}° ${earth.altitude > 0 ? "above" : "below"} the horizon` : ""} ·
        white marker = landing site (not to scale). Faded = below the horizon.
      </div>
    </div>
  );
}
