import { useEffect, useState } from 'react';

/**
 * Fetch data with a mock fallback.
 *
 * `data` starts as `fallback` so the (mock) UI renders instantly. On a
 * successful fetch the real payload overlays the mock. On error we keep the
 * fallback and expose the error so the page can decide what to show.
 *
 * @param {() => Promise<any>} fetcher - returns the resolved payload (already unwrapped).
 * @param {{ fallback?: any, deps?: any[] }} options
 * @returns {{ data: any, loading: boolean, error: Error|null }}
 */
export function useApi(fetcher, { fallback = null, deps = [] } = {}) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(() => fetcher())
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err) => {
        if (!active) return;
        // Keep the fallback (mock) data; surface the error.
        setData(fallback);
        setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

export default useApi;
