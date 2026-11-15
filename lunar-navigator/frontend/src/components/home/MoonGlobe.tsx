// Slowly spinning Moon for the homepage. Texture: NASA Moon Trek global LROC WAC mosaic,
// stitched from the equirectangular WMTS pyramid (zoom z has 2^(z+1) × 2^z tiles of 256 px).
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { eqTileUrl } from "../../lib/moontrek";

const Z = 2; // 8 × 4 tiles → 2048 × 1024 px
const TILE = 256;

function useMoonTexture() {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cols = 2 ** (Z + 1), rows = 2 ** Z;
    const canvas = document.createElement("canvas");
    canvas.width = cols * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#8a8a8a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let t: THREE.CanvasTexture | null = null;
    const loads: Promise<void>[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        loads.push(new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { ctx.drawImage(img, c * TILE, r * TILE, TILE, TILE); resolve(); };
          img.onerror = () => resolve();
          img.src = eqTileUrl(Z, r, c);
        }));
      }
    }
    // One upload once every tile is in (a missing tile just stays mid-grey).
    Promise.all(loads).then(() => {
      if (cancelled) return;
      t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      setTex(t);
    });
    return () => { cancelled = true; t?.dispose(); };
  }, []);
  return tex;
}

function Moon({ spin }: { spin: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const tex = useMoonTexture();
  const geo = useMemo(() => new THREE.SphereGeometry(1, 128, 96), []);
  useFrame((_, dt) => {
    if (spin && mesh.current) mesh.current.rotation.y += dt * 0.045;
  });
  // Mount only once the texture exists, so the shader is compiled with the map and bump map.
  if (!tex) return null;
  return (
    <mesh ref={mesh} geometry={geo} rotation={[0.12, -1.2, 0]}>
      <meshStandardMaterial map={tex} bumpMap={tex} bumpScale={0.6} roughness={1} metalness={0} />
    </mesh>
  );
}

export default function MoonGlobe({ className }: { className?: string }) {
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  return (
    <div className={className} aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 4], fov: 30 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.03} />
        {/* Sun from upper left: a soft terminator across the disc, like the reference shots */}
        <directionalLight position={[-4, 3.5, 2.2]} intensity={4.2} />
        <Moon spin={!reduced} />
      </Canvas>
    </div>
  );
}
