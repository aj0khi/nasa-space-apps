// 3D terrain & 3D Lunar Globe powered by NASA Moon Trek WMTS textures and real Sun/Earth lighting. Owner: SKY3D.
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { renderGlobalMoonCanvas, renderSiteTrekCanvas, TrekLayerId } from "../../lib/moontrek";
import { go } from "../../router";
import { normLon, useApp } from "../../state/store";

const VERT_EXAGGERATION = 3;
const SKY_KM = 16; // how far out the Sun and Earth markers are drawn (scene units are km)
const HOME_TERRAIN: [number, number, number] = [0, -25, 18];
const HOME_GLOBE: [number, number, number] = [0, -18, 12];
const GLOBE_RADIUS = 8;

/** Unit vector toward a body, in the scene's x = east, y = north, z = up frame. */
function skyDir(alt: number, az: number) {
  const a = THREE.MathUtils.degToRad(alt), z = THREE.MathUtils.degToRad(az);
  return new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a));
}

/** Selenographic (lat, lon) → 3D point on a sphere of radius R (z = North/South pole axis, +x = 0° Prime Meridian toward Earth). */
function latLonToSphere(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  // Standard Three.js SphereGeometry UV mapping:
  // u = 0.5 + lon / (2π), v = 0.5 + lat / π when rotated with Y as polar axis,
  // Since our camera has up=[0,0,1], we orient the globe with +Z = North Pole, -Z = South Pole, +X = 0° lon (Earth-facing).
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
  );
}

/** Drag to orbit, scroll to zoom, right-drag to pan. `resetKey` changes → back to the starting view. */
function Controls({ resetKey, mode }: { resetKey: number; mode: "terrain" | "globe" }) {
  const { camera, gl } = useThree();
  // Created in the effect (not useMemo) so StrictMode's dev-only unmount/remount gets a fresh, connected instance.
  const [controls, setControls] = useState<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement); // uses camera.up (z), so the ground stays level
    c.enableDamping = false;
    setControls(c);
    return () => c.dispose();
  }, [camera, gl]);
  useEffect(() => {
    if (!controls) return;
    if (mode === "globe") {
      controls.minDistance = 10;
      controls.maxDistance = 45;
      controls.maxPolarAngle = Math.PI; // allow orbiting all the way under the South Pole!
      camera.position.set(...HOME_GLOBE);
    } else {
      controls.minDistance = 4;
      controls.maxDistance = 70;
      controls.maxPolarAngle = Math.PI / 2 - 0.02; // don't go under the ground
      camera.position.set(...HOME_TERRAIN);
    }
    controls.target.set(0, 0, 0);
    controls.update();
  }, [resetKey, mode, camera, controls]);

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
  const loc = useApp((s) => s.location()) ?? { lat: -89.45, lon: 222.0 };
  const sites = useApp((s) => s.sites());
  const selectedId = useApp((s) => s.selectedId);
  const evaluation = useApp((s) => s.evaluation);

  const [viewMode, setViewMode] = useState<"terrain" | "globe">("terrain");
  const [trekLayer, setTrekLayer] = useState<Exclude<TrekLayerId, "none"> | "plain">("lola_shade");
  const [siteTex, setSiteTex] = useState<THREE.CanvasTexture | null>(null);
  const [globeTex, setGlobeTex] = useState<THREE.CanvasTexture | null>(null);

  const key = `${loc.lat},${loc.lon}`;
  const elev = useApi(() => api.elevation(loc, 20, 96), [key]);
  const state = useApi(() => api.state(loc, time.toISOString()), [key, time.getTime()], 200);

  // Load NASA Moon Trek texture for the 20 km × 20 km 3D terrain mesh
  useEffect(() => {
    if (trekLayer === "plain") {
      setSiteTex(null);
      return;
    }
    let cancelled = false;
    renderSiteTrekCanvas(loc.lat, loc.lon, 20, trekLayer, 512)
      .then((canvas) => {
        if (cancelled) return;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        setSiteTex(tex);
      })
      .catch(() => {
        if (!cancelled) setSiteTex(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, trekLayer]);

  // Load NASA Moon Trek Global LROC WAC mosaic for the 3D Moon Globe (progressive z=1 then z=2)
  useEffect(() => {
    if (viewMode !== "globe" || globeTex) return;
    let cancelled = false;
    renderGlobalMoonCanvas(1).then((c1) => {
      if (cancelled) return;
      const t1 = new THREE.CanvasTexture(c1);
      t1.colorSpace = THREE.SRGBColorSpace;
      t1.needsUpdate = true;
      setGlobeTex(t1);
      renderGlobalMoonCanvas(2).then((c2) => {
        if (cancelled) return;
        const t2 = new THREE.CanvasTexture(c2);
        t2.colorSpace = THREE.SRGBColorSpace;
        t2.anisotropy = 4;
        t2.needsUpdate = true;
        setGlobeTex(t2);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [viewMode, globeTex]);

  const geom = useMemo(() => {
    if (!elev.data) return null;
    const { grid, pixel_m } = elev.data;
    const n = grid.length, size = (n - 1) * pixel_m / 1000; // km
    const g = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
    const pos = g.attributes.position;
    const ref = grid[Math.floor(n / 2)][Math.floor(n / 2)];
    for (let i = 0; i < pos.count; i++) pos.setZ(i, ((grid[Math.floor(i / n)][i % n] - ref) / 1000) * VERT_EXAGGERATION);
    g.computeVertexNormals();
    return g;
  }, [elev.data]);

  const [resetKey, setResetKey] = useState(0);
  const siteZ = 0;
  const earth = state.data?.earth;
  const sun = state.data?.sun;

  const light = useMemo(() => {
    if (!sun) return new THREE.Vector3(0, 10, 10);
    const alt = THREE.MathUtils.degToRad(sun.altitude), az = THREE.MathUtils.degToRad(sun.azimuth);
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)).multiplyScalar(30);
  }, [sun]);

  // Global Sun & Earth vectors in selenographic coordinates for the 3D Moon Globe
  const subSolarLat = evaluation?.south_pole_ephemeris?.sun.sub_lat_deg ?? -1.5;
  const subSolarLon = evaluation?.south_pole_ephemeris?.sun.sub_lon_deg ?? 90;
  const subEarthLat = evaluation?.south_pole_ephemeris?.earth.sub_lat_deg ?? 0;
  const subEarthLon = evaluation?.south_pole_ephemeris?.earth.sub_lon_deg ?? 0;
  const globeSunPos = useMemo(() => latLonToSphere(subSolarLat, subSolarLon, 28), [subSolarLat, subSolarLon]);
  const globeEarthPos = useMemo(() => latLonToSphere(subEarthLat, subEarthLon, 22), [subEarthLat, subEarthLon]);

  return (
    <div className="panel" style={{ height, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>
          {viewMode === "terrain" ? `3D Site Terrain (height ×${VERT_EXAGGERATION})` : "3D Moon Globe (NASA Moon Trek LROC WAC)"}
        </h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs" role="group" aria-label="3D Mode">
            <button className={viewMode === "terrain" ? "active" : ""} onClick={() => setViewMode("terrain")}>
              Site Terrain (20 km)
            </button>
            <button className={viewMode === "globe" ? "active" : ""} onClick={() => setViewMode("globe")}>
              Full Moon Globe
            </button>
          </div>
          {viewMode === "terrain" && (
            <div className="tabs" role="group" aria-label="3D Surface Texture">
              <button className={trekLayer === "lola_shade" ? "active" : ""} onClick={() => setTrekLayer("lola_shade")}>
                LOLA Relief
              </button>
              <button className={trekLayer === "wac" ? "active" : ""} onClick={() => setTrekLayer("wac")}>
                WAC Photo
              </button>
              <button className={trekLayer === "lola_color" ? "active" : ""} onClick={() => setTrekLayer("lola_color")}>
                Color Elev
              </button>
              <button className={trekLayer === "plain" ? "active" : ""} onClick={() => setTrekLayer("plain")}>
                Plain Mesh
              </button>
            </div>
          )}
          <button onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
        </div>
      </div>

      <Canvas style={{ flex: 1, minHeight: 0, cursor: "grab" }} shadows camera={{ position: HOME_TERRAIN, up: [0, 0, 1], fov: 45 }}>
        <Controls resetKey={resetKey} mode={viewMode} />

        {viewMode === "terrain" ? (
          <>
            <ambientLight intensity={siteTex ? 0.32 : 0.15} />
            <directionalLight position={light} intensity={sun && sun.altitude > 0 ? 2.1 : 0.15} castShadow
              shadow-mapSize={[2048, 2048]} shadow-camera-left={-15} shadow-camera-right={15}
              shadow-camera-top={15} shadow-camera-bottom={-15} />
            {geom && (
              <mesh key={siteTex ? siteTex.uuid : "plain"} geometry={geom} castShadow receiveShadow>
                <meshStandardMaterial
                  map={siteTex ?? undefined}
                  color={siteTex ? "#ffffff" : "#9a9a9a"}
                  roughness={0.95}
                />
              </mesh>
            )}
            {/* lander marker at the center */}
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
          </>
        ) : (
          <>
            <ambientLight intensity={0.18} />
            <directionalLight position={globeSunPos} intensity={2.4} />
            {/* 3D Moon sphere rotated so +Z is North Pole, -Z is South Pole, +X is 0° Prime Meridian */}
            <group rotation={[Math.PI / 2, Math.PI, 0]}>
              <mesh key={globeTex ? globeTex.uuid : "globe-plain"}>
                <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
                <meshStandardMaterial
                  map={globeTex ?? undefined}
                  color={globeTex ? "#ffffff" : "#888888"}
                  roughness={0.95}
                />
              </mesh>
            </group>
            {/* South Pole axis ring */}
            <mesh position={[0, 0, -GLOBE_RADIUS * 0.992]}>
              <ringGeometry args={[0.85, 0.92, 48]} />
              <meshBasicMaterial color="#4da3ff" transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
            {/* Candidate Sites A-H markers on the South Pole of the 3D Globe */}
            {sites.map((s) => {
              const p = latLonToSphere(s.coordinates.lat, normLon(s.coordinates.lon), GLOBE_RADIUS * 1.012);
              const isSel = s.id === selectedId;
              const col = s.status === "GO" ? "#3cc86e" : s.status === "CAUTION" ? "#e8a33d" : "#e5534b";
              return (
                <mesh
                  key={s.id}
                  position={p}
                  onClick={(e) => {
                    e.stopPropagation();
                    go.site(s.id);
                  }}
                >
                  <sphereGeometry args={[isSel ? 0.22 : 0.14, 16, 16]} />
                  <meshBasicMaterial color={isSel ? "#ffffff" : col} />
                </mesh>
              );
            })}
            {/* Sun & Earth indicators in space around the Moon */}
            <mesh position={globeSunPos.clone().normalize().multiplyScalar(15)}>
              <sphereGeometry args={[0.8, 24, 16]} />
              <meshBasicMaterial color="#e8a33d" />
            </mesh>
            <mesh position={globeEarthPos.clone().normalize().multiplyScalar(14)}>
              <sphereGeometry args={[0.6, 24, 16]} />
              <meshBasicMaterial color="#4da3ff" />
            </mesh>
          </>
        )}
      </Canvas>

      <div className="muted small">
        Drag to rotate · scroll to zoom · right-drag to pan.{" "}
        <span style={{ color: "var(--sun)" }}>●</span> Sun{sun ? ` ${sun.altitude.toFixed(1)}° ${sun.altitude > 0 ? "above" : "below"} the horizon` : ""} ·{" "}
        <span style={{ color: "var(--earth)" }}>●</span> Earth{earth ? ` ${earth.altitude.toFixed(1)}° ${earth.altitude > 0 ? "above" : "below"} the horizon` : ""} ·{" "}
        {viewMode === "terrain"
          ? "NASA Moon Trek WMTS texture draped over local 3D topography · white marker = landing site."
          : "NASA Moon Trek Global LROC WAC Mosaic (LRO_WAC_Mosaic_Global_303ppd_v02) · click a South Pole marker to select a site."}
      </div>
    </div>
  );
}
