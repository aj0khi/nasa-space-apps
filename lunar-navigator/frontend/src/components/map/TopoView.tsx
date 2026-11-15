// Topographic view for the 2D tab: switch between the contour map and its A–A′ height profile.
//   heights: /api/terrain/elevation · shadows: /api/terrain/shadow · Sun: /api/ephemeris/state
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { hourKey, useLatest } from "../../hooks/useLatest";
import { compass, fmtLat, fmtLon } from "../../lib/geo";
import { contours, levels, niceInterval, offsetKm, rotate, toUV } from "../../lib/topo";
import { normLon, useApp } from "../../state/store";
import { useExpert } from "../learn/ModeGate";
import { inSection, shade } from "../profile/profileMath";
import { SunSvg } from "../viz3d/celestialBodies";

type Style = "paper" | "glow";
const N = 301; // samples across the rotated map (odd, so the A–A′ line is a sample row)
const RES = 241; // samples requested from the backend
const W = 800; // SVG units: map width
const P = 230; // profile height
const POLE = { lat: -90, lon: 0 };

// Paper: watercolour-style hypsometric tints (low → high). Glow: thread colours on near-black.
const PAPER = ["#5d7fb0", "#8fa9c9", "#cdd6d0", "#e6d5b3", "#d6c79d", "#bdbb8a", "#9fae73", "#839b5f", "#6a854d", "#56703f"];
const GLOW = ["#1f9e8c", "#25b98f", "#3fd17a", "#73df5c", "#a6e652", "#d2ea55", "#ece45c"];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ramp = (pal: string[], t: number) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];

export default function TopoView({ modeSwitch }: { modeSwitch?: React.ReactNode }) {
  const expert = useExpert();
  const time = useApp((s) => s.time);
  const override = useApp((s) => s.sunOverride);
  const sites = useApp((s) => s.sites());
  const selected = useApp((s) => s.location());
  const center = selected ?? POLE;
  const [style, setStyle] = useState<Style>("paper");
  const [sizeKm, setSizeKm] = useState(50);
  const [dir, setDir] = useState<"sun" | "ns" | "ew" | "manual">("sun");
  const [manual, setManual] = useState(30);
  const [showShadows, setShowShadows] = useState(true);
  const [display, setDisplay] = useState<"map" | "profile">("map");
  const [hover, setHover] = useState<{ u: number; v: number; z: number } | null>(null);

  const hour = hourKey(time);
  const key = `${center.lat},${center.lon}`;
  const state = useLatest(() => api.state(center, hour), `${key}|${hour}`);
  const sunAlt = override?.alt ?? state.data?.sun.altitude;
  const sunAz = override?.az ?? state.data?.sun.azimuth;
  const elev = useLatest(() => api.elevation(center, sizeKm, RES), `${key}|${sizeKm}`);
  const shadow = useLatest(
    () => (sunAlt != null && sunAz != null && sunAlt > 0 ? api.shadow(center, +sunAlt.toFixed(1), Math.round(sunAz), sizeKm, RES) : null),
    `${key}|${sizeKm}|${sunAlt?.toFixed(1)}|${sunAz != null ? Math.round(sunAz) : ""}`);

  // A–A′ direction: along the Sun (A toward the Sun), north–south, east–west, or set by hand.
  const bearing = dir === "sun" ? (sunAz != null ? Math.round(sunAz / 5) * 5 : 0) : dir === "ns" ? 0 : dir === "ew" ? 90 : manual;
  const night = sunAlt != null && sunAlt <= 0;

  const rot = useMemo(() => {
    if (!elev.data) return null;
    const mask = showShadows && !night ? shadow.data?.mask ?? null : null;
    return rotate(elev.data.grid, sizeKm, bearing, N, mask);
  }, [elev.data, shadow.data, sizeKm, bearing, showShadows, night]);

  const topo = useMemo(() => {
    if (!rot) return null;
    let min = Infinity, max = -Infinity;
    for (const v of rot.z) if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
    const step = niceInterval(max - min, 30);
    const lv = levels(min, max, step);
    return { min, max, step, lv, paths: contours(rot.z, N, lv) };
  }, [rot]);

  // Height bands, gentle hillshade from the Sun's side, and hatching where the ground is in shadow.
  const raster = useMemo(() => {
    if (!rot || !topo) return null;
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(N, N);
    const pal = style === "paper" ? PAPER : null;
    // Sun direction in the rotated (screen) frame; ground that rises away from the Sun faces it and is brighter.
    const az = ((sunAz ?? 135) * Math.PI) / 180;
    const { u: lu, v: lv } = toUV(Math.sin(az), Math.cos(az), bearing);
    const pxKm = (2 * rot.half) / (N - 1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i, z = rot.z[k];
        const o = k * 4;
        if (Number.isNaN(z)) { img.data[o + 3] = 0; continue; }
        const band = Math.floor((z - topo.min) / topo.step) / Math.max(1, topo.lv.length);
        // height gradient per metre, along u (right) and v (down)
        const zx = (rot.z[j * N + Math.min(N - 1, i + 1)] - rot.z[j * N + Math.max(0, i - 1)]) / (2 * pxKm * 1000);
        const zy = (rot.z[Math.min(N - 1, j + 1) * N + i] - rot.z[Math.max(0, j - 1) * N + i]) / (2 * pxKm * 1000);
        const hs = Math.max(0.55, Math.min(1.3, 1 - 3 * (zx * lu + zy * lv)));
        let rgb: number[];
        if (pal) rgb = hex(ramp(pal, band)).map((v) => v * (0.82 + 0.18 * hs));
        else rgb = band < 0.2 ? [22, 92, 40].map((v) => v * (0.75 + 0.25 * hs)) : [13, 18, 17];
        const sh = rot.shadow?.[k];
        if (sh === 1) {
          const hatch = (i + j) % 10 === 0;
          rgb = pal
            ? rgb.map((v, q) => v * 0.7 + [30, 40, 70][q] * 0.3 - (hatch ? 28 : 0))
            : rgb.map((v, q) => (hatch ? [26, 58, 50][q] : v * 0.6));
        }
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [rot, topo, style, sunAz, bearing]);

  // The A–A′ profile along the centre row, with shadows from the Sun along the line.
  const prof = useMemo(() => {
    if (!rot || !topo) return null;
    const j = (N - 1) / 2;
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < N; i++) { xs.push(((i / (N - 1)) * 2 - 1) * rot.half * 1000); zs.push(rot.z[j * N + i]); }
    const zmin = Math.min(...zs), zmax = Math.max(...zs);
    const top = 34, bottom = P - 14;
    const yOf = (z: number) => bottom - ((z - zmin) / Math.max(1, zmax - zmin)) * (bottom - top);
    const xOf = (i: number) => (i / (N - 1)) * W;
    const exag = ((bottom - top) / Math.max(1, zmax - zmin)) / (W / (2 * rot.half * 1000));
    const sun = sunAlt != null && sunAz != null ? inSection(sunAlt, sunAz, bearing) : null;
    const lit = sun ? shade({ x: xs, z: zs }, sun).lit : null;
    const crossings: { x: number; y: number; z: number }[] = [];
    for (let i = 1; i < N; i++) for (const l of topo.lv) {
      const a = zs[i - 1], b = zs[i];
      if ((a - l) * (b - l) < 0) { const f = (l - a) / (b - a); crossings.push({ x: xOf(i - 1 + f), y: yOf(l), z: l }); }
    }
    return { zs, zmin, zmax, yOf, xOf, exag, lit, sun, crossings, siteZ: zs[(N - 1) / 2] };
  }, [rot, topo, sunAlt, sunAz, bearing]);

  // Other A–H sites that fall on this map (plus sign in a box, like the main map).
  const markers = useMemo(() => {
    if (!rot) return [];
    return sites.map((s) => {
      const o = offsetKm(center, { lat: s.coordinates.lat, lon: normLon(s.coordinates.lon) });
      const { u, v } = toUV(o.e, o.n, bearing);
      return { id: s.id, u, v, go: s.status };
    }).filter((m) => Math.abs(m.u) < rot.half && Math.abs(m.v) < rot.half);
  }, [rot, sites, center.lat, center.lon, bearing]);

  const mapTop = 0;
  const s = rot ? W / (2 * rot.half) : 1; // SVG units per km
  const X = (u: number) => W / 2 + u * s, Y = (v: number) => mapTop + W / 2 + v * s;
  const ink = style === "paper" ? "#3b3326" : "#c9f0c0";
  const north = { u: Math.cos((bearing * Math.PI) / 180), v: -Math.sin((bearing * Math.PI) / 180) };
  const sunDir = sunAz != null ? toUV(Math.sin((sunAz * Math.PI) / 180), Math.cos((sunAz * Math.PI) / 180), bearing) : null;
  // Sun marker position: on the square's edge, 40 units in, in the Sun's direction
  const sunEdge = sunDir ? (W / 2 - 40) / Math.max(Math.abs(sunDir.u), Math.abs(sunDir.v), 1e-6) : 0;
  const sunX = sunDir ? W / 2 + sunDir.u * sunEdge : 0;
  const lineColor = (t: number) => (style === "paper" ? "rgba(58,44,26,0.7)" : ramp(GLOW, t));
  const scaleKm = sizeKm >= 50 ? 10 : 5;

  return (
    <div className={`scrollview topo ${style}`}>
      <div className="panel">
        <div className="topo-head">
          <h3>Topographic view {elev.data?.synthetic && <small>(synthetic terrain)</small>} {(elev.loading || shadow.loading) && <span className="spinner" aria-label="updating" />}</h3>
          {modeSwitch}
        </div>
        <div className="topo-controls">
          <div className="tabs" role="group" aria-label="Topographic display">
            <button aria-pressed={display === "map"} className={display === "map" ? "active" : ""} onClick={() => setDisplay("map")}>Contour map</button>
            <button aria-pressed={display === "profile"} className={display === "profile" ? "active" : ""} onClick={() => { setDisplay("profile"); setHover(null); }}>A–A′ profile</button>
          </div>
          <div className="tabs" role="group" aria-label="Map style">
            <button className={style === "paper" ? "active" : ""} onClick={() => setStyle("paper")}>Paper</button>
            <button className={style === "glow" ? "active" : ""} onClick={() => setStyle("glow")}>Glow</button>
          </div>
          <div className="tabs" role="group" aria-label="Area">
            {[20, 50, 100].map((k) => <button key={k} className={sizeKm === k ? "active" : ""} onClick={() => setSizeKm(k)}>{k} km</button>)}
          </div>
          <div className="tabs" role="group" aria-label="Direction of the A–A′ line">
            <button className={dir === "sun" ? "active" : ""} onClick={() => setDir("sun")}>Line follows the Sun</button>
            <button className={dir === "ns" ? "active" : ""} onClick={() => setDir("ns")}>North–South</button>
            <button className={dir === "ew" ? "active" : ""} onClick={() => setDir("ew")}>East–West</button>
            {expert && <button className={dir === "manual" ? "active" : ""} onClick={() => setDir("manual")}>Custom</button>}
          </div>
          <label className="follow"><input type="checkbox" checked={showShadows} onChange={(e) => setShowShadows(e.target.checked)} /> Shadows</label>
          {expert && dir === "manual" && (
            <label className="topo-slider">Bearing <input type="range" min={0} max={359} value={manual} onChange={(e) => setManual(+e.target.value)} /> <output>{manual}°</output></label>
          )}
        </div>

        {!rot || !topo || !prof ? (
          <div className="profile-loading">{elev.error ?? "Drawing contours…"}</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${display === "map" ? W : P}`} width="100%" className="topo-svg" role="img"
            aria-label={display === "map"
              ? `Contour map ${sizeKm} km across around ${selected ? "the selected site" : "the south pole"}.`
              : `Height profile along A–A′ around ${selected ? "the selected site" : "the south pole"}.`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              if (display !== "map") return;
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * W;
              const i = Math.round((x / W) * (N - 1)), j = Math.round(((y - mapTop) / W) * (N - 1));
              const z = rot.z[j * N + i];
              setHover(Number.isNaN(z) ? null : { u: (x - W / 2) / s, v: (y - mapTop - W / 2) / s, z });
            }}>
            <defs>
              <filter id="topo-glow" x="-5%" y="-5%" width="110%" height="110%">
                <feGaussianBlur stdDeviation="1.6" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <clipPath id="topo-clip"><rect x={0} y={mapTop} width={W} height={W} rx={6} /></clipPath>
            </defs>

            {display === "profile" && <g>
            <rect x={0} y={0} width={W} height={P} className="topo-prof-bg" rx={6} />
            {topo.lv.map((l) => (
              <line key={l} x1={0} x2={W} y1={prof.yOf(l)} y2={prof.yOf(l)} stroke={ink} strokeOpacity={0.18} strokeDasharray="10 6" />
            ))}
            <path d={`M0,${P} ` + prof.zs.map((z, i) => `L${prof.xOf(i).toFixed(1)},${prof.yOf(z).toFixed(1)}`).join(" ") + ` L${W},${P} Z`}
              className="topo-prof-ground" />
            {prof.zs.slice(1).map((z, k) => {
              const i = k + 1;
              const lit = prof.lit ? prof.lit[i] : false;
              return <line key={i} x1={prof.xOf(i - 1)} y1={prof.yOf(prof.zs[i - 1])} x2={prof.xOf(i)} y2={prof.yOf(z)}
                stroke={lit ? "var(--sun)" : "var(--shade)"} strokeWidth={3} strokeLinecap="round" />;
            })}
            {prof.crossings.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={2.5} fill={ink} />)}
            {prof.sun?.up && (
              <text x={prof.sun.sunRight ? W - 16 : 16} y={22} textAnchor={prof.sun.sunRight ? "end" : "start"} fontSize={15} fill="var(--sun)">
                ☀ Sun {prof.sun.sunRight ? "→" : "←"} {expert ? `${prof.sun.apparent.toFixed(1)}° in this slice` : ""}
              </text>
            )}
            {night && <text x={W / 2} y={22} textAnchor="middle" fontSize={15} className="topo-muted">Sun below the horizon: all in shadow</text>}
            <line x1={W / 2} x2={W / 2} y1={prof.yOf(prof.siteZ) - 26} y2={prof.yOf(prof.siteZ)} stroke={ink} strokeWidth={1.5} />
            <text x={W / 2} y={prof.yOf(prof.siteZ) - 30} textAnchor="middle" fontSize={13} fill={ink}>▼ site</text>
            <text x={8} y={P - 6} fontSize={13} fontWeight={700} fill={ink}>A′</text>
            <text x={W - 8} y={P - 6} fontSize={13} fontWeight={700} fill={ink} textAnchor="end">A</text>
            {expert && <text x={W / 2} y={P - 4} textAnchor="middle" fontSize={11} className="topo-muted">heights ×{prof.exag.toFixed(0)} · {Math.round(prof.zmin)} to {Math.round(prof.zmax)} m</text>}
            </g>}

            {display === "map" && <g clipPath="url(#topo-clip)">
              {raster && <image href={raster} x={0} y={mapTop} width={W} height={W} preserveAspectRatio="none" style={{ imageRendering: "auto" }} />}
              <g transform={`translate(0 ${mapTop}) scale(${W / (N - 1)})`} filter={style === "glow" ? "url(#topo-glow)" : undefined}>
                {topo.paths.map((d, k) => {
                  const major = Math.round(topo.lv[k] / topo.step) % 5 === 0;
                  return <path key={k} d={d} fill="none" stroke={lineColor(k / Math.max(1, topo.lv.length - 1))}
                    strokeWidth={(style === "glow" ? 2.6 : major ? 2.6 : 1.5) * ((N - 1) / W)} strokeLinecap="round" />;
                })}
              </g>
              {prof.crossings.map((c, i) => (
                <circle key={i} cx={c.x} cy={mapTop + W / 2} r={2.5} fill={style === "paper" ? "#1d1a14" : "#fff"} />
              ))}
              {/* A–A′ line */}
              <line x1={0} x2={W} y1={mapTop + W / 2} y2={mapTop + W / 2} stroke={style === "paper" ? "#1d1a14" : "#fff"} strokeWidth={2} />
              <text x={10} y={mapTop + W / 2 - 8} fontSize={18} fontWeight={700} fill={style === "paper" ? "#1d1a14" : "#fff"}>A′</text>
              <text x={W - 10} y={mapTop + W / 2 - 8} fontSize={18} fontWeight={700} textAnchor="end" fill={style === "paper" ? "#1d1a14" : "#fff"}>A</text>
              {/* sites: plus sign inside a box */}
              {markers.map((m) => {
                const sel = selected?.site?.id === m.id;
                const col = m.go === "GO" ? "var(--green)" : m.go === "CAUTION" ? "var(--yellow)" : "var(--red)";
                return (
                  <g key={m.id} transform={`translate(${X(m.u)} ${Y(m.v)})`}>
                    <rect x={-9} y={-9} width={18} height={18} fill="rgba(10,12,16,0.75)" stroke={col} strokeWidth={sel ? 3 : 2} />
                    <path d="M-9,0H9M0,-9V9" stroke={col} strokeWidth={1.5} />
                    <text x={13} y={5} fontSize={14} fontWeight={700} fill={style === "paper" ? "#1d1a14" : "#fff"} className="topo-label">{m.id}</text>
                  </g>
                );
              })}
              {!selected?.site && (
                <g transform={`translate(${X(0)} ${Y(0)})`}>
                  <rect x={-9} y={-9} width={18} height={18} fill="rgba(10,12,16,0.75)" stroke="#fff" strokeWidth={2} />
                  <path d="M-9,0H9M0,-9V9" stroke="#fff" strokeWidth={1.5} />
                </g>
              )}
              {/* north arrow and Sun direction */}
              <g transform={`translate(${W - 46} ${mapTop + 46})`}>
                <circle r={26} fill="rgba(10,12,16,0.55)" />
                <line x1={0} y1={0} x2={north.u * 20} y2={north.v * 20} stroke="#fff" strokeWidth={2.5} />
                <text x={north.u * 32} y={north.v * 32 + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">N</text>
              </g>
              {sunDir && !night && (
                <g transform={`translate(${sunX} ${mapTop + W / 2 + sunDir.v * sunEdge})`}>
                  {/* the same Sun as the 3D view; badge on the side facing the middle of the map */}
                  <SunSvg x={0} y={0} r={16} badgeSize={26} altitude={sunAlt} badge={sunDir.v < 0 ? "below" : "above"}
                    clampX={[8 - sunX, W - 8 - sunX]} />
                </g>
              )}
              {/* scale bar */}
              <g transform={`translate(16 ${mapTop + W - 22})`}>
                <rect x={-6} y={-20} width={scaleKm * s + 12} height={30} rx={4} fill="rgba(10,12,16,0.55)" />
                <path d={`M0,0V-6M0,0H${scaleKm * s}V-6`} stroke="#fff" strokeWidth={2} fill="none" />
                <text x={(scaleKm * s) / 2} y={-6} textAnchor="middle" fontSize={12} fill="#fff">{scaleKm} km</text>
              </g>
            </g>}
          </svg>
        )}

        <div className="muted small topo-readout" aria-live="polite">
          {hover
            ? `${Math.round(hover.z).toLocaleString()} m · ${Math.abs(hover.u).toFixed(1)} km toward ${hover.u >= 0 ? "A" : "A′"}, ${Math.abs(hover.v).toFixed(1)} km ${hover.v < 0 ? "left" : "right"} of the line`
            : expert && topo
              ? `Contour interval ${topo.step} m (thick every ${topo.step * 5} m) · ${Math.round(topo.min).toLocaleString()} to ${Math.round(topo.max).toLocaleString()} m · A–A′ bearing ${bearing}° (${compass(bearing + 180)} → ${compass(bearing)})`
              : `${sizeKm} km around ${selected ? (selected.site ? `site ${selected.site.id}` : `${fmtLat(center.lat)}, ${fmtLon(center.lon)}`) : "the south pole"}${display === "map" ? " · hover the map for heights" : " · A–A′ profile"}`}
        </div>
        {!expert && (
          <p className="explain">
            Each line joins points at the same height, like the rings a draining bath leaves. Lines packed close together mean steep ground;
            rings inside rings that get lower are craters. Hatched ground is in shadow right now.
            Switch to the A–A′ profile for a side view along the line; dots mark contour crossings in both views.
          </p>
        )}
      </div>
    </div>
  );
}
