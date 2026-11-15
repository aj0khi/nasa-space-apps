// Tiny hash router (no dependency). Owner: LEAD.
//   #/2d                          south pole map
//   #/section?site=shackleton_rim cross section of a site
//   #/3d?lat=-89.5&lon=10         3D view of any clicked point
import { useEffect, useState } from "react";

export type View = "home" | "2d" | "section" | "3d" | "compare";
export interface Route { view: View; site?: string; catalog?: string; lat?: number; lon?: number }

const VIEWS: View[] = ["home", "2d", "section", "3d", "compare"];

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const view = !path ? "home" : (VIEWS as string[]).includes(path) ? (path as View) : "2d";
  const q = new URLSearchParams(query);
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (q.get("lat") && q.get("lon") && Number.isFinite(lat) && Number.isFinite(lon)) return { view, lat, lon };
  if (q.get("catalog")) return { view, catalog: q.get("catalog")! };
  return { view, site: q.get("site") ?? undefined };
}

function toHash(r: Route) {
  const q = r.site ? `?site=${encodeURIComponent(r.site)}`
    : r.catalog ? `?catalog=${encodeURIComponent(r.catalog)}`
    : r.lat != null && r.lon != null ? `?lat=${r.lat.toFixed(3)}&lon=${r.lon.toFixed(3)}` : "";
  return `#/${r.view}${q}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = {
  view: (view: View) => (location.hash = toHash({ ...parseHash(location.hash), view })),
  site: (site: string, view?: View) => (location.hash = toHash({ view: view ?? parseHash(location.hash).view, site })),
  catalog: (catalog: string) => (location.hash = toHash({ view: parseHash(location.hash).view, catalog })),
  point: (lat: number, lon: number) => (location.hash = toHash({ view: parseHash(location.hash).view, lat, lon })),
};
