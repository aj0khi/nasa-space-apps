// Fetch that keeps up with a moving slider / ▶ play: at most one request in flight, and when it
// finishes the newest value is fetched next. (A plain debounce never fires while play is running.)
// Owner: LEAD.
import { useEffect, useRef, useState } from "react";

export function useLatest<T>(fn: () => Promise<T> | null, key: string) {
  const [data, setData] = useState<T | null>(null);
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
      p.then(setData)
        .catch((e) => console.warn(e))
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

  return { data, loading };
}

/** Round a date down to the hour (the backend caches shadow maps per hour). */
export const hourKey = (d: Date) => new Date(Math.floor(d.getTime() / 3.6e6) * 3.6e6).toISOString();
