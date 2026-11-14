// Viability score of every listed site for a landing at the moment on the slider (next 14 days).
// Rounded to 6-hour steps so dragging the slider doesn't send hundreds of requests. Owner: LEAD.
import { useEffect } from "react";
import { api } from "../api/client";
import { useApp } from "../state/store";
import type { Site } from "../types";

export const SCORE_STEP_MS = 6 * 3.6e6;
export const scoreStart = (t: Date) => new Date(Math.floor(t.getTime() / SCORE_STEP_MS) * SCORE_STEP_MS);

export function useScores(sites: Site[]) {
  const time = useApp((s) => s.time);
  const setScore = useApp((s) => s.setScore);
  const ids = sites.map((s) => s.id).join();
  const start = scoreStart(time).toISOString();

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      for (const s of sites) {
        api.score(s, start).then((sc) => !cancelled && setScore(s.id, sc)).catch(() => {});
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, start]);
}
