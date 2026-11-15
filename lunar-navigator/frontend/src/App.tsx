// App shell, laid out like the team sketch. Owner: LEAD.
//
//   ┌ 2D │ Cross section │ 3D │ Compare ┐──────┬──────────────────┐
//   │                                          │ DATE             │
//   │      main view (Team 1)                  │ IDEAL LANDING    │  ← A–H GO / NO-GO engine
//   │                                          │ SELECTED SITE    │    (GET /api/sites, /api/sites/{id})
//   │                                          │ coordinates      │
//   └──────────────────────────────────────────┴──────────────────┘
import { useEffect, useState } from "react";
import { api } from "./api/client";
import TopBar from "./components/layout/TopBar";
import DatePanel from "./components/rail/DatePanel";
import LandingList from "./components/rail/LandingList";
import SelectedSite from "./components/rail/SelectedSite";
import CoordsBar from "./components/rail/CoordsBar";
import MissionSetup from "./components/rail/MissionSetup";
import Conditions from "./components/rail/Conditions";
import { useApi } from "./hooks/useApi";
import { sixHourKey, useLatest } from "./hooks/useLatest";
import { go, useRoute, Route, View } from "./router";
import { useApp } from "./state/store";
import MapView from "./views/MapView";
import SectionView from "./views/SectionView";
import ThreeDView from "./views/ThreeDView";
import CompareView from "./views/CompareView";
import HomeView from "./views/HomeView";

export const CUSTOM_LETTER = "X";

const TABS: { key: View; label: string }[] = [
  { key: "2d", label: "2D" },
  { key: "section", label: "Cross section" },
  { key: "3d", label: "3D" },
  { key: "compare", label: "Compare" },
];

export default function App() {
  const route = useRoute();
  useEffect(() => {
    const titles: Record<View, string> = { home: "Home", "2d": "Lunar map", section: "Cross section", "3d": "3D terrain", compare: "Compare" };
    document.title = `${titles[route.view]} | SouthPoint`;
  }, [route.view]);
  return route.view === "home" ? <HomeView /> : <Navigator route={route} />;
}

function Navigator({ route }: { route: Route }) {
  const { select, setCustom, clearSelection, selectedId, custom, setEvaluation, setDetails, minDays } = useApp();
  const time = useApp((s) => s.time);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const catalog = useApi(() => api.catalog(), [], 0);
  const catalogSite = catalog.data?.find((site) => site.id === route.catalog);

  // URL → store
  useEffect(() => {
    if (route.site) select(route.site);
    else if (route.catalog && catalogSite) setCustom(catalogSite.lat, catalogSite.lon);
    else if (route.catalog) clearSelection();
    else if (route.lat != null && route.lon != null) setCustom(route.lat, route.lon);
    else clearSelection();
  }, [route.site, route.catalog, route.lat, route.lon, catalogSite, select, setCustom, clearSelection]);

  // A–H engine: statuses for all sites, and full details for the selected one. 6-hour grid = NASA cache hits.
  const slot = sixHourKey(time);
  const evaluation = useLatest(() => api.sites(slot, minDays), `${slot}|${minDays}`);
  useEffect(() => { if (evaluation.data) setEvaluation(evaluation.data); }, [evaluation.data, setEvaluation]);

  const details = useLatest(() => (selectedId ? api.siteDetails(selectedId, slot, minDays) : null), `${selectedId}|${slot}|${minDays}`);
  useEffect(() => {
    // only accept details that belong to the current selection
    setDetails(details.data && details.data.id === selectedId ? details.data : null);
  }, [details.data, selectedId, setDetails]);

  const letter = selectedId ?? CUSTOM_LETTER;
  const catalogReady = !!(catalogSite && custom && custom.lat === catalogSite.lat && custom.lon === catalogSite.lon);
  const hasSelection = route.catalog ? catalogReady : !!(route.site || route.lat != null);
  const needsSelection = route.view === "section" || route.view === "3d";
  const selectionKey = route.site ?? route.catalog ?? `${route.lat},${route.lon}`;

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
        <div className={`viewbody${route.view === "2d" ? " viewbody-map" : ""}`}>
          {route.view === "2d" && <MapView onCursor={setCursor} />}
          {needsSelection && !hasSelection && (
            <div className="empty">
              <p>{route.catalog ? (catalog.error ? `Couldn’t load the mission catalog: ${catalog.error}` : catalog.data && !catalogSite ? "This catalog site was not found." : "Loading catalog site…") : "Pick a landing site first."}</p>
              <button onClick={() => go.view("2d")}>Open the 2D map</button>
            </div>
          )}
          {route.view === "section" && hasSelection && <SectionView key={selectionKey} letter={letter} detailsError={details.loading ? null : details.error} />}
          {route.view === "3d" && hasSelection && <ThreeDView key={selectionKey} />}
          {route.view === "compare" && <CompareView />}
        </div>
      </main>
      <aside className="rail">
        <DatePanel />
        <MissionSetup />
        <LandingList loading={evaluation.loading} error={evaluation.error} onSelect={(id) => go.site(id)}
          catalog={catalog.data} catalogError={catalog.error} catalogId={route.catalog} />
        <SelectedSite key={`selected:${selectionKey}`} loading={details.loading} catalogSite={catalogReady ? catalogSite : undefined}
          catalogPending={!!route.catalog && !catalogReady} catalogError={catalog.error ?? (catalog.data && !catalogSite ? "Site not found in the catalog." : null)} />
        {(!route.catalog || catalogReady) && <Conditions key={`conditions:${selectionKey}`} />}
        <CoordsBar cursor={cursor} />
      </aside>
    </div>
  );
}
