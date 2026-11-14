// Global state. Owner: LEAD.
// RULE: every view reads `time` and `location()` from here. Sliders and play buttons only ever set `time`.
// The selected site comes from the URL (router.ts); App.tsx copies it in here.
//
// Data sources:
//   evaluation / details → A–H GO / NO-GO engine (/backend, GET /api/sites and /api/sites/{id})
//   everything keyed by lat/lon (map shadows, terrain, 3D, mission) → lunar-navigator/backend
import { create } from "zustand";
import type { EvalAll, EvalSite, SiteDetails } from "../types";

export type MapTab = "sun" | "shadows" | "rims";
export type Mode = "beginner" | "expert";

/** Engine longitudes can be 0–360 °E; the rest of the app uses −180…180. */
export const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

const NO_SITES: EvalSite[] = [];

interface AppState {
  evaluation: EvalAll | null; // last GET /api/sites result (kept while the next one loads)
  details: SiteDetails | null; // last GET /api/sites/{id} for the selected site
  minDays: number; // minimum mission length the engine checks the sunlit window against
  selectedId: string | null; // "A" … "H"
  custom: { lat: number; lon: number } | null;
  time: Date; // the instant being shown
  baseTime: Date; // the date the user picked; the time slider runs one lunar day from here
  mode: Mode;
  tab: MapTab;
  sunOverride: { alt: number; az: number } | null; // expert "what if": replaces the computed Sun in the cross section

  setEvaluation: (e: EvalAll) => void;
  setDetails: (d: SiteDetails | null) => void;
  setMinDays: (n: number) => void;
  select: (id: string) => void;
  setCustom: (lat: number, lon: number) => void;
  clearSelection: () => void;
  setTime: (t: Date) => void;
  setBaseTime: (t: Date) => void;
  setMode: (m: Mode) => void;
  setTab: (t: MapTab) => void;
  setSunOverride: (s: { alt: number; az: number } | null) => void;
  sites: () => EvalSite[];
  location: () => { lat: number; lon: number; site?: EvalSite } | null;
}

export const useApp = create<AppState>((set, get) => ({
  evaluation: null,
  details: null,
  minDays: 3,
  selectedId: null,
  custom: null,
  time: new Date(),
  baseTime: new Date(),
  mode: "beginner",
  tab: "sun",
  sunOverride: null,

  setEvaluation: (evaluation) => set({ evaluation }),
  setDetails: (details) => set({ details }),
  setMinDays: (minDays) => set({ minDays }),
  select: (id) => set({ selectedId: id.toUpperCase(), custom: null, details: null }),
  setCustom: (lat, lon) => set({ custom: { lat, lon }, selectedId: null, details: null }),
  clearSelection: () => set({ custom: null, selectedId: null, details: null }),
  setTime: (time) => set({ time }),
  setBaseTime: (t) => set({ baseTime: t, time: t }),
  setMode: (mode) => set({ mode }),
  setTab: (tab) => set({ tab }),
  setSunOverride: (sunOverride) => set({ sunOverride }),
  sites: () => get().evaluation?.sites ?? NO_SITES,
  location: () => {
    const { custom, selectedId, evaluation } = get();
    if (custom) return custom;
    const site = evaluation?.sites.find((s) => s.id === selectedId);
    return site ? { lat: site.coordinates.lat, lon: normLon(site.coordinates.lon), site } : null;
  },
}));
