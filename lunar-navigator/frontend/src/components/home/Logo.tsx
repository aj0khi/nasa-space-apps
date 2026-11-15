// SouthPoint logo lockup (Moon + Earth artwork and wordmark).
// The source art is white on a black box, so it's drawn as a luminance mask over a solid fill (see .sp-logo):
// white → opaque, black → transparent. That removes the box on any background, and the fill colour is themeable.
//
// AI disclosure: the logo is AI-generated. A tiny, faint "SI generated" watermark sits beside it (.ai-mark):
// easy to point out when needed, not meant to draw the eye. Put <AiMark /> next to every AI-generated image.
import logo from "../../assets/southpoint-logo.webp";

// Visible artwork inside the 2000 × 667 source, trimmed of its black margins.
const CROP_W = 1860, CROP_H = 400;

export function AiMark() {
  return <span className="ai-mark" title="SI-generated image">SI generated</span>;
}

export default function Logo({ height = 36 }: { height?: number }) {
  return (
    <span className="sp-logo-wrap">
      <span className="sp-logo" role="img" aria-label="SouthPoint (SI-generated logo)"
        style={{ height, width: (height * CROP_W) / CROP_H, ["--sp-logo" as string]: `url(${logo})` }} />
      <AiMark />
    </span>
  );
}
