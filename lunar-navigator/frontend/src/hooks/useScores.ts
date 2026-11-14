// Fetch the viability score of every listed site for the chosen date. Owner: LEAD.
import { useEffect } from "react";
import { api } from "../api/client";
import { useApp } from "../state/store";
import type { Site } from "../types";

export function useScores(sites: Site[]) {
  const baseTime = useApp((s) => s.baseTime);
  const setScore = useApp((s) => s.setScore);
  const ids = sites.map((s) => s.id).join();

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      for (const s of sites) {
        api.score(s, baseTime.toISOString()).then((sc) => !cancelled && setScore(s.id, sc)).catch(() => {});
      }
    }, 300); // wait for the user to stop changing the date
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, baseTime.getTime()]);
}
