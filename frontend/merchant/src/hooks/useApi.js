import { useEffect, useState } from 'react';

/**
 * Fetch data on mount (and whenever `deps` change), keeping a fallback value.
 *
 * @param {() => Promise<any>} fetcher - resolves to the mapped payload.
 * @param {{ fallback?: any, deps?: any[] }} options
 * @returns {{ data: any, loading: boolean, error: any }}
 *
 * `data` starts as `fallback` and is kept as `fallback` if the fetch fails, so
 * the UI always has something to render. Safe against unmount.
 */
export function useApi(fetcher, { fallback = null, deps = [] } = {}) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(fetcher)
      .then((result) => {
        if (!alive) return;
        setData(result);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setData(fallback); // keep fallback on error
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  return { data, loading, error, refetch };
}

export default useApi;
