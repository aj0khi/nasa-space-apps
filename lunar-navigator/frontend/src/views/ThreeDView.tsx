// 3D tab: lit terrain, plus the top-down Sun / Shadows / Rims maps. Owner: SKY3D (3D) + MAP (2D maps).
import Surface3D from "../components/viz3d/Surface3D";
import LocalMap from "../components/map/LocalMap";
import SplitView from "../components/map/SplitView";

export default function ThreeDView() {
  return (
    <div className="scrollview">
      <Surface3D height={520} />
      <section className="row">
        <LocalMap />
        <SplitView />
      </section>
    </div>
  );
}
