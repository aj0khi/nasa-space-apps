// App shell, laid out like the team sketch. Owner: LEAD.
//
//   ┌ 2D │ Cross section │ 3D ┐──────────────┬──────────────────┐
//   │                                        │ DATE             │
//   │      main view (Team 1)                │ IDEAL LANDING    │
//   │                                        │ SELECTED SITE    │  ← right rail (Team 2)
//   │                                        │ coordinates      │
//   └────────────────────────────────────────┴──────────────────┘
import { useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import TopBar from "./components/layout/TopBar";
import DatePanel from "./components/rail/DatePanel";
import LandingList from "./components/rail/LandingList";
import SelectedSite from "./components/rail/SelectedSite";
import CoordsBar from "./components/rail/CoordsBar";
import { useScores } from "./hooks/useScores";
import { useLatest } from "./hooks/useLatest";
import { CUSTOM_LETTER, siteLetters } from "./lib/letters";
import { go, useRoute, View } from "./router";
import { useApp } from "./state/store";
import MapView from "./views/MapView";
import SectionView from "./views/SectionView";
import ThreeDView from "./views/ThreeDView";

const TABS: { key: View; label: string }[] = [
  { key: "2d", label: "2D" },
  { key: "section", label: "Cross section" },
  { key: "3d", label: "3D" },
];

export default function App() {
  const route = useRoute();
  const { sites, setSites, select, setCustom, clearSelection, selectedId } = useApp();
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    api.sites().then(setSites).catch(console.error);
  }, [setSites]);

  // URL → store
  useEffect(() => {
    if (route.site) select(route.site);
    else if (route.lat != null && route.lon != null) setCustom(route.lat, route.lon);
    else clearSelection();
  }, [route.site, route.lat, route.lon, select, setCustom, clearSelection]);

  const letters = useMemo(() => siteLetters(sites), [sites]);
  const lettered = useMemo(() => sites.filter((s) => letters[s.id]), [sites, letters]);
  useScores(lettered);

  // Sun → terrain → is each site lit / in contact with Earth at this exact moment?
  const time = useApp((s) => s.time);
  const setNow = useApp((s) => s.setNow);
  const minuteKey = new Date(Math.floor(time.getTime() / 6e4) * 6e4).toISOString();
  const now = useLatest(() => api.sitesNow(minuteKey), minuteKey);
  useEffect(() => { if (now.data) setNow(now.data); }, [now.data, setNow]);

  const letter = selectedId ? letters[selectedId] ?? "•" : CUSTOM_LETTER;
  const hasSelection = !!(route.site || route.lat != null);

  return (
    <div className="shell">
      <TopBar />
      <main className="stage">
        <nav className="viewtabs" role="tablist" aria-label="View">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={route.view === t.key}
              className={route.view === t.key ? "active" : ""} onClick={() => go.view(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="viewbody">
          {route.view === "2d" && <MapView letters={letters} onCursor={setCursor} />}
          {route.view !== "2d" && !hasSelection && (
            <div className="empty">
              <p>Pick a landing site first.</p>
              <button onClick={() => go.view("2d")}>Open the 2D map</button>
            </div>
          )}
          {route.view === "section" && hasSelection && <SectionView letter={letter} />}
          {route.view === "3d" && hasSelection && <ThreeDView />}
        </div>
      </main>
      <aside className="rail">
        <DatePanel />
        <LandingList sites={lettered} letters={letters} onSelect={(id) => go.site(id)} />
        <SelectedSite letter={selectedId ? letters[selectedId] : undefined} />
        <CoordsBar cursor={cursor} />
      </aside>
    </div>
  );
}
