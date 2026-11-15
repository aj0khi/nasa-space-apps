// Cross section tab: the A–A′ sun profile, then sky, power/comms, timeline, mission. Owner: SKY3D (layout: LEAD).
import SunProfile from "../components/profile/SunProfile";
import SkyDome from "../components/sky/SkyDome";
import Countdowns from "../components/sky/Countdowns";
import Timeline from "../components/timeline/Timeline";
import CrossSection from "../components/terrain/CrossSection";
import MissionPanel from "../components/mission/MissionPanel";
import MoonVsEarth from "../components/learn/MoonVsEarth";
import { useApp } from "../state/store";

export default function SectionView({ letter, detailsError }: { letter: string; detailsError: string | null }) {
  const mode = useApp((s) => s.mode);
  return (
    <div className="scrollview">
      <SunProfile letter={letter} />
      <section className="row">
        <SkyDome />
        <Countdowns detailsError={detailsError} />
        <div style={{ flex: 1, minWidth: "min(320px, 100%)" }}><Timeline /></div>
      </section>
      <CrossSection />
      <MissionPanel />
      {mode === "beginner" && <MoonVsEarth />}
    </div>
  );
}
