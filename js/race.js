// Builds the three racers (bike, public transport, walking) for a from -> to trip.
import { fetchStations, fetchTrip } from './api.js';
import {
  UNLOCK_SEC, DOCK_SEC, nearestStation, sequentialTimeline, enturTimeline,
  pickBestTransit, rideSeconds, finishTime, decodePolyline, formatDuration, formatClock, escapeHtml,
} from './logic.js';

const MODE_ICON = {
  foot: '🚶', bicycle: '🚲', bus: '🚌', coach: '🚌', tram: '🚋', metro: '🚇',
  rail: '🚆', water: '⛴️', air: '✈️',
};
const MODE_NAME = { bus: 'Bus', coach: 'Coach', tram: 'Tram', metro: 'T-bane', rail: 'Train', water: 'Ferry' };

const legCoords = (pattern) =>
  pattern.legs.flatMap((l) => (l.pointsOnLink ? decodePolyline(l.pointsOnLink.points) : []));

// Walking trip between two points, as a single timeline step.
async function walkStep(from, to, label) {
  const [pattern] = await fetchTrip(from, to, 'foot');
  if (!pattern) throw new Error('No walking route found');
  return { duration: pattern.duration, coords: legCoords(pattern), mode: 'foot', label, distance: pattern.distance };
}

async function bikeRacer(from, to, stations, kmh) {
  const pickup = nearestStation(stations, from, (s) => s.renting && s.bikes > 0);
  const dropoff = nearestStation(stations, to, (s) => s.returning && s.docks > 0);
  if (!pickup) throw new Error('No Bysykkel station with bikes within 1.5 km of the start');
  if (!dropoff) throw new Error('No Bysykkel station with free docks within 1.5 km of the destination');
  const a = pickup.station, b = dropoff.station;
  const aName = escapeHtml(a.name), bName = escapeHtml(b.name);
  if (a.id === b.id) throw new Error('Start and destination share the same station, so just walk!');

  const [walk1, ridePatterns, walk2] = await Promise.all([
    walkStep(from, a, `Walk to ${a.name}`),
    fetchTrip(a, b, 'bicycle'),
    walkStep(b, to, 'Walk to destination'),
  ]);
  const ride = ridePatterns[0];
  if (!ride) throw new Error('No cycling route found between the stations');
  const at = (s) => [[s.lat, s.lon]];

  const timeline = sequentialTimeline([
    walk1,
    { duration: UNLOCK_SEC, coords: at(a), mode: 'wait', label: 'Unlock bike' },
    { duration: rideSeconds(ride.distance, kmh), coords: legCoords(ride), mode: 'bicycle', label: `Ride to ${b.name}`, distance: ride.distance },
    { duration: DOCK_SEC, coords: at(b), mode: 'wait', label: 'Dock bike' },
    walk2,
  ]);
  const steps = [
    `🚶 Walk ${formatDuration(walk1.duration)} to <b>${aName}</b> (${a.bikes} ${a.bikes === 1 ? 'bike' : 'bikes'} available)`,
    `🔓 Unlock bike (${UNLOCK_SEC} s)`,
    `🚲 Ride ${(ride.distance / 1000).toFixed(1)} km at ${kmh} km/h, ${formatDuration(timeline[2].end - timeline[2].start)}`,
    `🅿️ Dock at <b>${bName}</b> (${b.docks} free ${b.docks === 1 ? 'dock' : 'docks'})`,
    `🚶 Walk ${formatDuration(walk2.duration)} to destination`,
  ];
  return { timeline, steps, stations: [a, b] };
}

async function transitRacer(from, to, now) {
  const pattern = pickBestTransit(await fetchTrip(from, to, 'transit'));
  if (!pattern) throw new Error('No public transport route found right now');
  const timeline = enturTimeline(pattern, now);
  const steps = pattern.legs.map((l) => {
    const icon = MODE_ICON[l.mode] ?? '➡️';
    if (l.mode === 'foot') {
      const dest = l.toPlace.name === 'Destination' ? 'destination' : `<b>${escapeHtml(l.toPlace.name)}</b>`;
      return `${icon} Walk ${formatDuration(l.duration)} to ${dest}`;
    }
    const name = escapeHtml(`${MODE_NAME[l.mode] ?? l.mode} ${l.line?.publicCode ?? ''}`.trim());
    return `${icon} <b>${name}</b> at ${formatClock(new Date(l.expectedStartTime))} from ${escapeHtml(l.fromPlace.name)} → ${escapeHtml(l.toPlace.name)}`;
  });
  const wait = timeline[0]?.start ?? 0;
  if (wait >= 60) steps.unshift(`⏳ Leave in ${formatDuration(wait)}`);
  return { timeline, steps };
}

async function walkRacer(from, to) {
  const step = await walkStep(from, to, 'Walk');
  return {
    timeline: sequentialTimeline([step]),
    steps: [`🚶 Walk ${(step.distance / 1000).toFixed(1)} km the whole way`],
  };
}

export const RACERS = [
  { id: 'bike', name: 'Bysykkel', icon: '🚲' },
  { id: 'transit', name: 'Public transport', icon: '🚌' },
  { id: 'walk', name: 'Walking', icon: '🚶' },
];

// Returns racers with { ...meta, timeline, steps, finish } or { ...meta, error }, sorted by finish time.
export async function planRace(from, to, { kmh = 16, now = new Date(), stations } = {}) {
  stations ??= await fetchStations();
  const results = await Promise.allSettled([
    bikeRacer(from, to, stations, kmh),
    transitRacer(from, to, now),
    walkRacer(from, to),
  ]);
  return RACERS.map((meta, i) => {
    const r = results[i];
    if (r.status === 'rejected') return { ...meta, error: r.reason.message, finish: Infinity };
    return { ...meta, ...r.value, finish: finishTime(r.value.timeline) };
  }).sort((a, b) => a.finish - b.finish);
}
