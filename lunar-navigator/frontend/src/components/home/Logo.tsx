// SouthPoint logo lockup (Moon + Earth artwork and wordmark).
// The source art is white on a black box, so it's drawn as a luminance mask over a solid fill (see .sp-logo):
// white → opaque, black → transparent. That removes the box on any background, and the fill colour is themeable.
import logo from "../../assets/southpoint-logo.webp";

// Visible artwork inside the 2000 × 667 source, trimmed of its black margins.
const CROP_W = 1860, CROP_H = 400;

export default function Logo({ height = 36 }: { height?: number }) {
  return (
    <span className="sp-logo" role="img" aria-label="SouthPoint"
      style={{ height, width: (height * CROP_W) / CROP_H, ["--sp-logo" as string]: `url(${logo})` }} />
  );
}
