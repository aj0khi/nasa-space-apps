// Global state. Owner: LEAD.
// RULE: every view reads `time` and `location()` from here. Sliders and play buttons only ever set `time`.
// The selected site comes from the URL (router.ts); App.tsx copies it in here.
import { create } from "zustand";
import type { Score, Site } from "../types";

export type MapTab = "sun" | "shadows" | "rims";
export type Mode = "beginner" | "expert";

interface AppState {
  sites: Site[];
  selectedId: string | null;
  custom: { lat: number; lon: number } | null;
  time: Date; // the instant being shown
  baseTime: Date; // the date the user picked; the time slider runs one lunar day from here
  mode: Mode;
  tab: MapTab;
  scores: Record<string, Score>;

  setSites: (s: Site[]) => void;
  select: (id: string) => void;
  setCustom: (lat: number, lon: number) => void;
  clearSelection: () => void;
  setTime: (t: Date) => void;
  setBaseTime: (t: Date) => void;
  setMode: (m: Mode) => void;
  setTab: (t: MapTab) => void;
  setScore: (id: string, s: Score) => void;
  location: () => { lat: number; lon: number; site?: Site } | null;
}

export const useApp = create<AppState>((set, get) => ({
  sites: [],
  selectedId: null,
  custom: null,
  time: new Date(),
  baseTime: new Date(),
  mode: "beginner",
  tab: "sun",
  scores: {},

  setSites: (sites) => set({ sites }),
  select: (id) => set({ selectedId: id, custom: null }),
  setCustom: (lat, lon) => set({ custom: { lat, lon }, selectedId: null }),
  clearSelection: () => set({ custom: null, selectedId: null }),
  setTime: (time) => set({ time }),
  setBaseTime: (t) => set({ baseTime: t, time: t }),
  setMode: (mode) => set({ mode }),
  setTab: (tab) => set({ tab }),
  setScore: (id, s) => set(({ scores }) => ({ scores: { ...scores, [id]: s } })),
  location: () => {
    const { custom, selectedId, sites } = get();
    if (custom) return custom;
    const site = sites.find((s) => s.id === selectedId);
    return site ? { lat: site.lat, lon: site.lon, site } : null;
  },
}));
