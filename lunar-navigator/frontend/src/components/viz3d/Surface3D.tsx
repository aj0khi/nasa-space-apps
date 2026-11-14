// 3D terrain lit by a directional light at the sun's real alt/az. Owner: SKY3D (stretch).
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useApp } from "../../state/store";

const VERT_EXAGGERATION = 3;

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
    for (let i = 0; i < pos.count; i++) pos.setZ(i, (grid[Math.floor(i / n)][i % n] / 1000) * VERT_EXAGGERATION);
    g.computeVertexNormals();
    return g;
  }, [elev.data]);

  // Plane is in x(east)/y(north)/z(up) before we rotate it; light direction from sun alt/az.
  const sun = state.data?.sun;
  const light = useMemo(() => {
    if (!sun) return new THREE.Vector3(0, 10, 10);
    const alt = THREE.MathUtils.degToRad(sun.altitude), az = THREE.MathUtils.degToRad(sun.azimuth);
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)).multiplyScalar(30);
  }, [sun]);

  return (
    <div className="panel" style={{ height, display: "flex", flexDirection: "column" }}>
      <h3>3D view (height ×{VERT_EXAGGERATION})</h3>
      <Canvas style={{ flex: 1, minHeight: 0 }} shadows camera={{ position: [0, -25, 18], up: [0, 0, 1], fov: 45 }}>
        <ambientLight intensity={0.03} />
        <directionalLight position={light} intensity={sun && sun.altitude > 0 ? 2 : 0} castShadow
          shadow-mapSize={[2048, 2048]} shadow-camera-left={-15} shadow-camera-right={15}
          shadow-camera-top={15} shadow-camera-bottom={-15} />
        {geom && (
          <mesh geometry={geom} castShadow receiveShadow>
            <meshStandardMaterial color="#9a9a9a" roughness={1} />
          </mesh>
        )}
      </Canvas>
      {/* TODO(SKY3D): OrbitControls (drei), lander marker, Earth sprite in the sky */}
    </div>
  );
}
