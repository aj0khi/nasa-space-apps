// 360° skyline strip: the terrain skyline in every compass direction, with the Sun's and Earth's paths. Owner: LEAD.
import type { SeriesPoint, Skyline } from "../../types";

export interface SkylineStripProps {
  skyline: Skyline | null; // ray-traced skyline at the lander (null while loading)
  series: SeriesPoint[]; // the lunar-day series the time slider moves through
  index: number; // current sample of `series`
  body: "sun" | "earth"; // which body the panel is looking at
  sliceAzimuth: number; // direction the A end of the slice points (deg clockwise from north)
  letter: string; // label of the slice ends: A and A′
  onPickAzimuth?: (azimuth: number) => void; // the user chose a direction on the strip
  onPickTime?: (index: number) => void; // the user chose a moment on a body's path
}

/** Placeholder until the strip is built. */
export default function SkylineStrip(_props: SkylineStripProps) {
  return null;
}
