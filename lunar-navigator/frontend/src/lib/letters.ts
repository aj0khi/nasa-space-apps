// Sites near the south pole get a letter (A = closest to the pole), used on the map, in the list
// and as the A–A′ labels of the cross section. Owner: MAP.
import type { Site } from "../types";

export const LETTERED_BELOW_LAT = -65;
export const CUSTOM_LETTER = "X";

export function siteLetters(sites: Site[]): Record<string, string> {
  const south = sites.filter((s) => s.lat <= LETTERED_BELOW_LAT).sort((a, b) => a.lat - b.lat);
  return Object.fromEntries(south.map((s, i) => [s.id, String.fromCharCode(65 + i)]));
}

/** "Shackleton crater rim (Artemis …)" → "Shackleton crater rim", "IM‑1 Odysseus – Malapert A" → "IM‑1 Odysseus" */
export const shortName = (s: Site) => s.name.split(/ \(| – /)[0];
