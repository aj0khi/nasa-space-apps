// 3D tab: lit terrain (overview) or a textbook block diagram (walking on foot is its own tab),
// plus the top-down Sun / Shadows / Rims maps. Owner: SKY3D (3D) + MAP (2D maps); modes: Visualization.
import { useState } from "react";
import Surface3D from "../components/viz3d/Surface3D";
import BlockDiagram from "../components/viz3d/BlockDiagram";
import LocalMap from "../components/map/LocalMap";
import SplitView from "../components/map/SplitView";
import { go } from "../router";

type Mode = "overview" | "block";

export default function ThreeDView() {
  const [mode, setMode] = useState<Mode>("overview");
  return (
    <div className="scrollview">
      <div className="tabs" role="group" aria-label="3D mode">
        <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Overview</button>
        <button className={mode === "block" ? "active" : ""} onClick={() => setMode("block")}>Block diagram</button>
      </div>
      {mode === "overview" && <Surface3D height={520} onExplore={() => go.view("explore")} />}
      {mode === "block" && <BlockDiagram />}
      <section className="row">
        <LocalMap />
        <SplitView />
      </section>
    </div>
  );
}
