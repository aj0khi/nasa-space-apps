// SouthPoint logo slot. The team logo is coming later: drop the file in src/assets/ (e.g. southpoint-logo.svg),
// import it here, and replace the placeholder <span> with <img src={logo} alt="" />.
export default function Logo({ size = 22 }: { size?: number }) {
  return <span className="ms-logo" style={{ width: size, height: size }} aria-hidden="true" />;
}
