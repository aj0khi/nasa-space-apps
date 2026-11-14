// Live NOAA Space Weather Prediction Center scales, fetched straight from NOAA (CORS-open, no backend needed).
// Key "0" = now, "1".."3" = forecast for the next three UTC days. Owner: Visualization.
import { useEffect, useState } from "react";
import type { SpaceWeatherNow } from "../lib/conditions";

const URL = "https://services.swpc.noaa.gov/products/noaa-scales.json";
const REFRESH_MS = 15 * 60 * 1000;

interface NoaaDay {
  DateStamp: string;
  R: { Scale: string | null; MinorProb: string | null };
  S: { Scale: string | null; Prob: string | null };
}

let cache: { at: number; data: Record<string, NoaaDay> } | null = null;

export function useSpaceWeather(at: Date): { data: SpaceWeatherNow | null; error: string | null } {
  const [raw, setRaw] = useState(cache?.data ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache && Date.now() - cache.at < REFRESH_MS) return;
    fetch(URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`NOAA → ${r.status}`))))
      .then((d) => { cache = { at: Date.now(), data: d }; setRaw(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!raw?.["0"]) return { data: null, error };
  const now = raw["0"];
  const day = at.toISOString().slice(0, 10);
  const fc = ["1", "2", "3"].map((k) => raw[k]).find((d) => d?.DateStamp === day);
  const live = day === now.DateStamp || !!fc;
  return {
    data: {
      s: Number(now.S.Scale ?? 0),
      r: Number(now.R.Scale ?? 0),
      sProb: fc?.S.Prob != null ? Number(fc.S.Prob) : undefined,
      live,
    },
    error,
  };
}
