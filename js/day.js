// "When should I go?": public transport travel time for the same trip across a whole day.
import { fetchTrip } from './api.js';
import { daySlots, pickBestTransit } from './logic.js';

const CONCURRENCY = 6; // parallel requests, to be polite to Entur

// Runs `fn` on every item with at most `limit` calls in flight; results keep the input order.
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// Returns [{ time, transit }] where transit is seconds from `time` until arrival (waiting included),
// or null if no public transport route was found for that slot.
export async function transitDayProfile(from, to, date, { walkKmh, stepMin = 30, onProgress } = {}) {
  const slots = daySlots(date, stepMin);
  let done = 0;
  return mapLimited(slots, CONCURRENCY, async (time) => {
    let transit = null;
    try {
      const best = pickBestTransit(await fetchTrip(from, to, 'transit', { walkKmh, dateTime: time }));
      if (best) transit = (new Date(best.expectedEndTime) - time) / 1000;
    } catch {
      // leave a gap in the chart for this slot
    }
    onProgress?.(++done, slots.length);
    return { time, transit };
  });
}
