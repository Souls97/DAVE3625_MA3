import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline, distanceMeters, nearestStation, interpolateAlong, sequentialTimeline,
  enturTimeline, positionAt, finishTime, pickBestTransit, travelSeconds, formatDuration, escapeHtml,
  daySlots, periodsWhere, niceStep,
} from '../js/logic.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('decodePolyline decodes the Google reference example', () => {
  // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  const coords = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(coords, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('distanceMeters: Jernbanetorget to OsloMet Pilestredet is about 1.6 km', () => {
  const d = distanceMeters({ lat: 59.9111, lon: 10.7528 }, { lat: 59.9196, lon: 10.7356 });
  assert.ok(d > 1300 && d < 1500, `got ${d}`);
  assert.equal(distanceMeters({ lat: 59.9, lon: 10.7 }, { lat: 59.9, lon: 10.7 }), 0);
});

test('nearestStation skips stations that fail the predicate', () => {
  const stations = [
    { id: 'empty', lat: 59.9001, lon: 10.7, bikes: 0 },
    { id: 'far', lat: 59.91, lon: 10.7, bikes: 5 },
  ];
  const hit = nearestStation(stations, { lat: 59.9, lon: 10.7 }, (s) => s.bikes > 0);
  assert.equal(hit.station.id, 'far');
});

test('nearestStation returns null when nothing is within range', () => {
  const stations = [{ id: 'x', lat: 60.5, lon: 10.7, bikes: 5 }];
  assert.equal(nearestStation(stations, { lat: 59.9, lon: 10.7 }, () => true), null);
  assert.equal(nearestStation([], { lat: 59.9, lon: 10.7 }, () => true), null);
});

test('interpolateAlong handles ends, middle and single points', () => {
  const line = [[59.9, 10.7], [59.9, 10.8]];
  assert.deepEqual(interpolateAlong(line, 0), [59.9, 10.7]);
  assert.deepEqual(interpolateAlong(line, 1), [59.9, 10.8]);
  const [lat, lon] = interpolateAlong(line, 0.5);
  close(lat, 59.9);
  close(lon, 10.75);
  assert.deepEqual(interpolateAlong([[1, 2]], 0.7), [1, 2]);
  assert.equal(interpolateAlong([], 0.5), null);
});

test('sequentialTimeline stacks steps back to back', () => {
  const tl = sequentialTimeline([
    { duration: 60, coords: [[0, 0]] },
    { duration: 30, coords: [[0, 0]] },
  ]);
  assert.deepEqual(tl.map((s) => [s.start, s.end]), [[0, 60], [60, 90]]);
  assert.equal(finishTime(tl), 90);
  assert.equal(finishTime([]), Infinity);
});

test('enturTimeline keeps waiting time before departure', () => {
  const now = new Date('2026-10-19T12:00:00+02:00');
  const pattern = {
    legs: [
      { mode: 'foot', expectedStartTime: '2026-10-19T12:02:00+02:00', expectedEndTime: '2026-10-19T12:05:00+02:00' },
      { mode: 'bus', expectedStartTime: '2026-10-19T12:08:00+02:00', expectedEndTime: '2026-10-19T12:20:00+02:00' },
    ],
  };
  const tl = enturTimeline(pattern, now);
  assert.deepEqual(tl.map((s) => [s.start, s.end]), [[120, 300], [480, 1200]]);
  assert.equal(finishTime(tl), 1200); // total includes the 2 min wait at home and 3 min at the stop
});

test('positionAt waits at the stop between legs', () => {
  const tl = [
    { start: 0, end: 10, coords: [[0, 0], [0, 1]] },
    { start: 20, end: 30, coords: [[0, 1], [0, 2]] },
  ];
  assert.deepEqual(positionAt(tl, 0), [0, 0]);
  assert.deepEqual(positionAt(tl, 15), [0, 1]); // waiting
  assert.deepEqual(positionAt(tl, 999), [0, 2]); // finished
  assert.equal(positionAt([], 5), null);
});

test('pickBestTransit ignores walk-only patterns and picks the earliest arrival', () => {
  const walk = { expectedEndTime: '2026-10-19T12:05:00Z', legs: [{ mode: 'foot' }] };
  const slowBus = { expectedEndTime: '2026-10-19T12:30:00Z', legs: [{ mode: 'bus' }] };
  const fastTram = { expectedEndTime: '2026-10-19T12:20:00Z', legs: [{ mode: 'foot' }, { mode: 'tram' }] };
  assert.equal(pickBestTransit([walk, slowBus, fastTram]), fastTram);
  assert.equal(pickBestTransit([walk]), null);
});

test('travelSeconds converts km/h correctly', () => {
  assert.equal(travelSeconds(1800, 18), 360); // 1.8 km at 18 km/h = 6 min
});

test('formatDuration', () => {
  assert.equal(formatDuration(20), '<1 min');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(3900), '1 h 5 min');
});

test('escapeHtml neutralises markup in API text', () => {
  assert.equal(escapeHtml('<b>"Tøyen" & co</b>'), '&lt;b&gt;&quot;Tøyen&quot; &amp; co&lt;/b&gt;');
});

test('daySlots covers the whole day in local time', () => {
  const slots = daySlots(new Date(2026, 9, 26, 14, 7), 30);
  assert.equal(slots.length, 48);
  assert.deepEqual([slots[0].getHours(), slots[0].getMinutes()], [0, 0]);
  assert.deepEqual([slots[17].getHours(), slots[17].getMinutes()], [8, 30]);
  assert.deepEqual([slots[47].getHours(), slots[47].getMinutes()], [23, 30]);
});

test('periodsWhere finds consecutive runs, including one at the end', () => {
  const runs = periodsWhere([1, 5, 6, 2, 7, 8, 9], (n) => n > 4);
  assert.deepEqual(runs, [{ from: 5, to: 6 }, { from: 7, to: 9 }]);
  assert.deepEqual(periodsWhere([1, 2], (n) => n > 4), []);
});

test('niceStep keeps the axis at a handful of round ticks', () => {
  assert.equal(niceStep(20), 5);
  assert.equal(niceStep(45), 10);
  assert.equal(niceStep(70), 15);
  assert.equal(niceStep(240), 60);
});
