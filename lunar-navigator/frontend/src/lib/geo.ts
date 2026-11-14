// South polar stereographic projection (km), compass names. Owner: MAP.
// Convention used by LRO south-pole maps: 0° longitude at the top, 90°E to the right.

export const R_MOON_KM = 1737.4;
const D = Math.PI / 180;

export function project(lat: number, lon: number) {
  const c = (90 + lat) * D; // angular distance from the south pole
  const r = 2 * R_MOON_KM * Math.tan(c / 2);
  return { x: r * Math.sin(lon * D), y: -r * Math.cos(lon * D) };
}

export function unproject(x: number, y: number) {
  const r = Math.hypot(x, y);
  const c = 2 * Math.atan(r / (2 * R_MOON_KM));
  return { lat: c / D - 90, lon: Math.atan2(x, -y) / D };
}

/** Radius on the map (km) of a latitude circle. */
export const ringRadius = (lat: number) => 2 * R_MOON_KM * Math.tan(((90 + lat) * D) / 2);

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (az: number) => POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

export const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}`;
export const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
