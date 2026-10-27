/** Preserve input priority/order with bounded upstream work and isolated errors. */
export async function boundedSettled(items, concurrency, work) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(items.length, Math.max(1, concurrency))}, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = {status:'fulfilled',value:await work(items[index],index)}; }
      catch(reason) { results[index] = {status:'rejected',reason}; }
    }
  }));
  return results;
}
