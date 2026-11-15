// Slowly spinning Moon for the homepage. Texture: NASA Moon Trek global LROC WAC mosaic,
// stitched from the equirectangular WMTS pyramid (zoom z has 2^(z+1) × 2^z tiles of 256 px).
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { eqTileUrl } from "../../lib/moontrek";

const TILE = 256;

function loadMoonPyramidLevel(z: number): Promise<HTMLCanvasElement> {
  const cols = 2 ** (z + 1), rows = 2 ** z;
  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const loads: Promise<void>[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      loads.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { ctx.drawImage(img, c * TILE, r * TILE, TILE, TILE); resolve(); };
        img.onerror = () => resolve();
        img.src = eqTileUrl(z, r, c);
      }));
    }
  }
  return Promise.all(loads).then(() => canvas);
}

function useMoonTexture() {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let cancelled = false;
    let currentTex: THREE.CanvasTexture | null = null;
    // Progressive load: fetch Z=1 (8 tiles) first for a 4x faster initial reveal, then upgrade to Z=2 (32 tiles).
    loadMoonPyramidLevel(1).then((canvas1) => {
      if (cancelled) return;
      const t1 = new THREE.CanvasTexture(canvas1);
      t1.colorSpace = THREE.SRGBColorSpace;
      t1.anisotropy = 4;
      currentTex = t1;
      setTex(t1);
      loadMoonPyramidLevel(2).then((canvas2) => {
        if (cancelled) return;
        const t2 = new THREE.CanvasTexture(canvas2);
        t2.colorSpace = THREE.SRGBColorSpace;
        t2.anisotropy = 4;
        t1.dispose();
        currentTex = t2;
        setTex(t2);
      });
    });
    return () => { cancelled = true; currentTex?.dispose(); };
  }, []);
  return tex;
}

function Moon({ spin, onReady }: { spin: boolean; onReady?: () => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const tex = useMoonTexture();
  // Tell the page once the textured Moon has actually been drawn, so it can fade in (with its glow) as one piece.
  useEffect(() => {
    if (!tex || !onReady) return;
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(onReady); });
    return () => cancelAnimationFrame(id);
  }, [tex, onReady]);
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

export default function MoonGlobe({ className, onReady }: { className?: string; onReady?: () => void }) {
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  return (
    <div className={className} aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 4], fov: 30 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.03} />
        {/* Sun from upper left: a soft terminator across the disc, like the reference shots */}
        <directionalLight position={[-4, 3.5, 2.2]} intensity={4.2} />
        <Moon spin={!reduced} onReady={onReady} />
      </Canvas>
    </div>
  );
}
