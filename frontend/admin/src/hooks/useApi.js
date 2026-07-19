import { useEffect, useState } from 'react';

/**
 * Runs an async `fetcher` and tracks its result.
 *
 * @param {() => Promise<any>} fetcher  async function returning the payload
 * @param {object} opts
 * @param {any}    opts.fallback  value used as the initial data AND kept on error
 * @param {any[]}  opts.deps      dependency list controlling re-fetch
 * @returns {{ data: any, loading: boolean, error: any, refetch: () => void }}
 */
export function useApi(fetcher, { fallback = null, deps = [] } = {}) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(fetcher)
      .then((result) => {
        if (!active) return;
        if (result !== undefined && result !== null) setData(result);
      })
      .catch((err) => {
        if (!active) return;
        setError(err);
        // Keep the fallback value on error — do not clear existing data.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refetch = () => setTick((t) => t + 1);

  return { data, loading, error, refetch };
}

export default useApi;
