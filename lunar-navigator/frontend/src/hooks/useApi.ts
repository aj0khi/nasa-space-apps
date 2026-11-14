// Small fetch hook with debounce so dragging the sun slider doesn't flood the API. Owner: LEAD.
import { useEffect, useState } from "react";

export function useApi<T>(fn: () => Promise<T> | null, deps: unknown[], debounceMs = 150) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      const p = fn();
      if (!p) return;
      setLoading(true);
      p.then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}
