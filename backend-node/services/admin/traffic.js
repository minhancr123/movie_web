// Bounded, process-local traffic window. Restart intentionally resets it.
export const createTrafficWindow = () => {
  const buckets = new Map();
  return {
    record(status, now = Date.now()) {
      const second = Math.floor(now / 1000);
      const row = buckets.get(second) || { requests: 0, errors: 0 };
      row.requests++; if (status >= 500) row.errors++;
      buckets.set(second, row);
      for (const key of buckets.keys()) if (key <= second - 60) buckets.delete(key);
    },
    read(now = Date.now()) {
      const second = Math.floor(now / 1000);
      let requests = 0, errors = 0;
      for (const [at, row] of buckets) if (at > second - 60 && at <= second) {
        requests += row.requests; errors += row.errors;
      }
      return { requests, errors, windowSeconds: 60 };
    },
  };
};
export const adminTraffic = createTrafficWindow();
