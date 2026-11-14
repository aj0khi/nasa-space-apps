// Fetch that keeps up with a moving slider / ▶ play: at most one request in flight, and when it
// finishes the newest value is fetched next. (A plain debounce never fires while play is running.)
// Owner: LEAD.
import { useEffect, useRef, useState } from "react";

export function useLatest<T>(fn: () => Promise<T> | null, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inflight = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    const run = () => {
      const p = fnRef.current();
      if (!p) return;
      inflight.current = true;
      setLoading(true);
      p.then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          inflight.current = false;
          setLoading(false);
          if (pending.current) {
            pending.current = false;
            run();
          }
        });
    };
    if (inflight.current) pending.current = true;
    else run();
  }, [key]);

  return { data, error, loading };
}

/** Round a date down to the hour (the backend caches shadow maps per hour). */
export const hourKey = (d: Date) => new Date(Math.floor(d.getTime() / 3.6e6) * 3.6e6).toISOString();

/** Round down to 00/06/12/18 UTC: the A–H engine works on a 6-hour grid and caches NASA data on it. */
export const sixHourKey = (d: Date) => new Date(Math.floor(d.getTime() / 2.16e7) * 2.16e7).toISOString().replace(".000Z", "Z");

/** The engine's "2026-11-16 18:00 UTC" → Date */
export const parseEngineUtc = (s: string) => new Date(s.replace(" UTC", "Z").replace(" ", "T"));

export const fmtUtc = (d: Date | string) =>
  (typeof d === "string" ? new Date(d) : d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
