// "Weather" for a lunar landing: the things that matter to a lander the way weather matters to a pilot.
// The Moon has no air, so no wind, rain or real dust storms. What it does have: light vs darkness, very long
// shadows that hide hazards, huge temperature swings, dust that floats near sunrise/sunset, dust blasted by
// the landing engine, and solar storms. Owner: Visualization.
import { compass } from "./geo";

export type Level = "ok" | "caution" | "hazard";

export interface Condition {
  key: string;
  label: string;
  level: Level;
  beginner: string; // one plain sentence
  expert: string; // numbers and the physics behind them
}

const S0 = 1361; // solar constant at 1 au, W/m²
const ALBEDO = 0.12; // lunar regolith (bolometric)
const EMISSIVITY = 0.95;
const SIGMA = 5.670e-8;
const T_SHADOW_K = 90; // polar regolith with no direct sun (Diviner, outside permanently shadowed craters)

/** Flat-ground surface temperature from radiative balance. Matches Diviner's ~390 K at the equator at noon. */
export function surfaceTempK(sunAltDeg: number, sunlit: boolean) {
  if (!sunlit || sunAltDeg <= 0) return T_SHADOW_K;
  const flux = (S0 * (1 - ALBEDO) * Math.sin((sunAltDeg * Math.PI) / 180)) / (EMISSIVITY * SIGMA);
  return Math.max(T_SHADOW_K, flux ** 0.25);
}

/** How many metres of shadow a 1 m tall rock casts. */
export const shadowPerMetre = (sunAltDeg: number) => (sunAltDeg > 0 ? 1 / Math.tan((sunAltDeg * Math.PI) / 180) : Infinity);

export interface SpaceWeatherNow {
  s: number; // NOAA solar radiation storm scale S0–S5 (the one that reaches the Moon)
  r: number; // radio blackout scale R0–R5 (affects Earth-side radio, the dayside of Earth)
  sProb?: number; // % chance of an S1+ storm on that day (forecast days only)
  live: boolean; // false when the date is outside NOAA's now…+3 day window
}

export interface ConditionInput {
  sunAlt: number;
  sunAz: number;
  sunSkyline?: number; // terrain horizon height toward the Sun; flat horizon if missing
  earthAlt: number;
  earthSkyline?: number;
  spaceWeather?: SpaceWeatherNow | null;
}

export function landingConditions(c: ConditionInput): Condition[] {
  const sunlit = c.sunAlt > (c.sunSkyline ?? 0);
  const earthUp = c.earthAlt > (c.earthSkyline ?? 0);
  const out: Condition[] = [];

  // Light
  if (!sunlit) {
    out.push({
      key: "light", label: "Light", level: "hazard",
      beginner: c.sunAlt > 0 ? "Dark: hills block the Sun here, so the lander must land by its own lights." : "Night: the Sun has set, so it's pitch dark and there's no solar power.",
      expert: `Sun ${c.sunAlt.toFixed(1)}° vs skyline ${(c.sunSkyline ?? 0).toFixed(1)}°: no direct illumination. Terrain-relative navigation needs active sensors (lidar).`,
    });
  } else {
    const level: Level = c.sunAlt < 3 ? "caution" : "ok";
    out.push({
      key: "light", label: "Light", level,
      beginner: level === "ok" ? "Daylight: good light to see the ground." : "Sunrise-like light: very low Sun, bright and dark patches side by side.",
      expert: `Sun ${c.sunAlt.toFixed(1)}° above the horizon, az ${c.sunAz.toFixed(0)}°. Apollo landed with the Sun 7–20° high behind the crew for contrast.`,
    });
  }

  // Shadows
  const len = shadowPerMetre(c.sunAlt);
  const towards = compass((c.sunAz + 180) % 360);
  out.push({
    key: "shadows", label: "Shadows", level: !sunlit ? "hazard" : len > 20 ? "caution" : "ok",
    beginner: !sunlit ? "Everything is in shadow, so rocks and holes are hard to see."
      : `Shadows point ${towards} and are long: a 1 m rock throws a ${Math.round(len)} m shadow that can hide holes.`,
    expert: sunlit ? `Shadow azimuth ${((c.sunAz + 180) % 360).toFixed(0)}° (${towards}). Length ratio 1:${len.toFixed(0)} (cot ${c.sunAlt.toFixed(1)}°).`
      : "No direct-sun shadows; ground is lit only by earthshine and scattered light.",
  });

  // Temperature
  const tK = surfaceTempK(c.sunAlt, sunlit);
  const tC = tK - 273.15;
  out.push({
    key: "temp", label: "Temperature", level: tC < -150 ? "hazard" : tC < -50 || tC > 100 ? "caution" : "ok",
    beginner: `About ${Math.round(tC)} °C on flat ground${tC < -150 ? ": colder than anywhere on Earth, so batteries and fuel need heating." : tC < -50 ? ": very cold, so electronics need heaters." : "."}`,
    expert: `≈${Math.round(tK)} K flat-ground estimate (radiative balance, A=${ALBEDO}, ε=${EMISSIVITY}). Sun-facing slopes run warmer; permanently shadowed craters reach ~40 K.`,
  });

  // Dust
  const nearTerminator = c.sunAlt > -2 && c.sunAlt < 3;
  out.push({
    key: "dust", label: "Dust", level: nearTerminator ? "caution" : "ok",
    beginner: nearTerminator
      ? "Possible floating dust: near sunrise and sunset, static electricity can lift fine dust. The engine will also blast dust on touchdown."
      : "No dust storms (no air), but the engine will blast up a cloud of dust on touchdown.",
    expert: nearTerminator
      ? "Within ~3° of the terminator: electrostatic dust levitation (Surveyor horizon glow, LADEE). Plume-surface interaction ejects regolith at up to ~2 km/s."
      : "No electrostatic levitation expected away from the terminator. Plume-surface interaction ejects regolith at up to ~2 km/s and can obscure the descent view below ~30 m.",
  });

  // Space weather
  const sw = c.spaceWeather;
  if (sw) {
    const level: Level = sw.s >= 3 ? "hazard" : sw.s >= 1 || (sw.sProb ?? 0) >= 25 ? "caution" : "ok";
    out.push({
      key: "space", label: "Solar storms", level,
      beginner: sw.s >= 3 ? "Strong solar radiation storm: dangerous for astronauts. Wait it out."
        : sw.s >= 1 ? "Minor solar radiation storm: robots are fine, crews should limit time outside."
        : `Quiet Sun${sw.sProb ? ` (${sw.sProb}% chance of a storm that day)` : ""}: no extra radiation.`,
      expert: `NOAA solar radiation storm S${sw.s}, radio blackout R${sw.r}${sw.sProb != null ? `, S1+ probability ${sw.sProb}%` : ""}. The Moon has no magnetosphere, so S-scale events reach the surface unshielded.`
        + (sw.live ? "" : " (Live data only covers today to +3 days; shown for context.)"),
    });
  }

  // Comms
  out.push({
    key: "comms", label: "Talk to Earth", level: earthUp ? "ok" : "hazard",
    beginner: earthUp ? "Earth is in view, so the lander can call home directly." : "Earth is out of view, so a relay satellite is needed to call home.",
    expert: `Earth ${c.earthAlt.toFixed(1)}° vs skyline ${(c.earthSkyline ?? 0).toFixed(1)}°: direct-to-Earth link ${earthUp ? "available" : "blocked"}.`,
  });

  return out;
}

export const worst = (cs: Condition[]): Level =>
  cs.some((c) => c.level === "hazard") ? "hazard" : cs.some((c) => c.level === "caution") ? "caution" : "ok";
