// 3D tab: lit terrain (overview), a textbook block diagram, or walking the surface on foot,
// plus the top-down Sun / Shadows / Rims maps. Owner: SKY3D (3D) + MAP (2D maps); modes: Visualization.
import { useState } from "react";
import Surface3D from "../components/viz3d/Surface3D";
import BlockDiagram from "../components/viz3d/BlockDiagram";
import ExploreView from "../components/viz3d/ExploreView";
import LocalMap from "../components/map/LocalMap";
import SplitView from "../components/map/SplitView";

type Mode = "overview" | "block" | "explore";

export default function ThreeDView() {
  const [mode, setMode] = useState<Mode>("overview");
  return (
    <div className="scrollview">
      <div className="tabs" role="group" aria-label="3D mode">
        <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Overview</button>
        <button className={mode === "block" ? "active" : ""} onClick={() => setMode("block")}>Block diagram</button>
        <button className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")}>🧑‍🚀 Explore on foot</button>
      </div>
      {mode === "overview" && <Surface3D height={520} onExplore={() => setMode("explore")} />}
      {mode === "block" && <BlockDiagram />}
      {mode === "explore" && <ExploreView onBack={() => setMode("overview")} />}
      <section className="row">
        <LocalMap />
        <SplitView />
      </section>
    </div>
  );
}
