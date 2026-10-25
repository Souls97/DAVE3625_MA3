// Pure helper functions: no DOM, no network. Covered by tests/logic.test.js.

// Seconds spent at the bike station unlocking / docking the bike.
export const UNLOCK_SEC = 60;
export const DOCK_SEC = 30;
// Seconds to get your own bike out and unlock it, and to find a rack and lock it at the destination.
export const OWN_BIKE_START_SEC = 60;
export const OWN_BIKE_PARK_SEC = 60;

export const MODE_ICON = {
  foot: '🚶', bicycle: '🚲', bus: '🚌', coach: '🚌', tram: '🚋', metro: '🚇',
  rail: '🚆', water: '⛴️', air: '✈️',
};
export const MODE_NAME = { bus: 'Bus', coach: 'Coach', tram: 'Tram', metro: 'T-bane', rail: 'Train', water: 'Ferry' };

// Decode a Google encoded polyline (the format Entur uses for pointsOnLink).
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

// Great-circle distance in meters between two {lat, lon} points.
export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest station matching `predicate`, or null if none within maxMeters.
export function nearestStation(stations, point, predicate, maxMeters = 1500) {
  let best = null, bestDist = Infinity;
  for (const s of stations) {
    if (!predicate(s)) continue;
    const d = distanceMeters(point, s);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best && bestDist <= maxMeters ? { station: best, distance: bestDist } : null;
}

// Point at fraction `frac` (0..1) of the way along a polyline of [lat, lon] pairs.
export function interpolateAlong(coords, frac) {
  if (coords.length === 0) return null;
  if (coords.length === 1 || frac <= 0) return coords[0];
  if (frac >= 1) return coords[coords.length - 1];
  const toPt = ([lat, lon]) => ({ lat, lon });
  const segLens = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = distanceMeters(toPt(coords[i - 1]), toPt(coords[i]));
    segLens.push(d);
    total += d;
  }
  if (total === 0) return coords[0];
  let target = frac * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i]) {
      const f = segLens[i] === 0 ? 0 : target / segLens[i];
      const [aLat, aLon] = coords[i];
      const [bLat, bLon] = coords[i + 1];
      return [aLat + (bLat - aLat) * f, aLon + (bLon - aLon) * f];
    }
    target -= segLens[i];
  }
  return coords[coords.length - 1];
}

// Build a timeline from steps that happen back to back.
// step: { duration (sec), coords, mode, label }  ->  segment: { start, end, coords, mode, label }
export function sequentialTimeline(steps) {
  const segments = [];
  let t = 0;
  for (const step of steps) {
    segments.push({ ...step, start: t, end: t + step.duration });
    t += step.duration;
  }
  return segments;
}

// Timeline for an Entur trip pattern, measured in seconds from `now`.
// Gaps between legs (waiting at a stop) are kept, so the racer stands still.
export function enturTimeline(pattern, now) {
  return pattern.legs.map((leg) => {
    const start = Math.max(0, (new Date(leg.expectedStartTime) - now) / 1000);
    const end = Math.max(start, (new Date(leg.expectedEndTime) - now) / 1000);
    return {
      start,
      end,
      coords: leg.pointsOnLink ? decodePolyline(leg.pointsOnLink.points) : [],
      mode: leg.mode,
      leg,
    };
  });
}

// Where a racer is at time t (seconds). Before a segment starts the racer waits at its first point.
export function positionAt(timeline, t) {
  const segs = timeline.filter((s) => s.coords.length > 0);
  if (segs.length === 0) return null;
  for (const seg of segs) {
    if (t < seg.start) return seg.coords[0];
    if (t < seg.end) return interpolateAlong(seg.coords, (t - seg.start) / (seg.end - seg.start));
  }
  const last = segs[segs.length - 1];
  return last.coords[last.coords.length - 1];
}

export function finishTime(timeline) {
  return timeline.length ? timeline[timeline.length - 1].end : Infinity;
}

// Fastest pattern that actually uses public transport (not just walking).
export function pickBestTransit(patterns) {
  const withTransit = patterns.filter((p) => p.legs.some((l) => l.mode !== 'foot'));
  if (withTransit.length === 0) return null;
  return withTransit.reduce((best, p) =>
    new Date(p.expectedEndTime) < new Date(best.expectedEndTime) ? p : best);
}

// Travel time in seconds for a distance in meters at a speed in km/h.
export function travelSeconds(meters, kmh) {
  return meters / (kmh / 3.6);
}

export function formatDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function formatClock(date) {
  return date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Departure times every `stepMin` minutes over the calendar day of `date`, in local clock time.
export function daySlots(date, stepMin = 30) {
  const slots = [];
  for (let min = 0; min < 24 * 60; min += stepMin) {
    slots.push(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, min));
  }
  return slots;
}

// Runs of consecutive items matching `predicate`, as [{ from, to }] (first and last matching item).
export function periodsWhere(items, predicate) {
  const periods = [];
  let current = null;
  for (const item of items) {
    if (predicate(item)) {
      if (current) current.to = item;
      else current = { from: item, to: item };
    } else if (current) {
      periods.push(current);
      current = null;
    }
  }
  if (current) periods.push(current);
  return periods;
}

// A round axis step giving at most `maxTicks` ticks up to `max`.
export function niceStep(max, maxTicks = 5) {
  for (const step of [5, 10, 15, 20, 30, 60, 120]) {
    if (max / step <= maxTicks) return step;
  }
  return Math.ceil(max / maxTicks / 60) * 60;
}
