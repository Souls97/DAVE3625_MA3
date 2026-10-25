import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRace } from '../js/race.js';

// Fake Entur: a 3 km bike route, a 2 km walk, and no public transport. Records every URL requested.
function fakeEntur() {
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    const mode = JSON.parse(options.body).variables.modes?.directMode;
    const distance = { bicycle: 3000, foot: 2000 }[mode];
    const tripPatterns = distance ? [{ duration: distance, distance, legs: [] }] : [];
    return { ok: true, json: async () => ({ data: { trip: { tripPatterns } } }) };
  };
  return urls;
}

const from = { lat: 59.92, lon: 10.73 };
const to = { lat: 59.93, lon: 10.76 };

test('own bike rides door to door with time to get the bike out and lock it', async () => {
  const urls = fakeEntur();
  const racers = await planRace(from, to, { bikeType: 'own', bikeKmh: 15 });
  const bike = racers.find((r) => r.id === 'bike');
  assert.equal(bike.name, 'Own bike');
  assert.equal(bike.finish, 60 + 720 + 60); // 3 km at 15 km/h = 12 min
  assert.deepEqual(bike.timeline.map((s) => s.mode), ['wait', 'bicycle', 'wait']);
  assert.equal(bike.stations, undefined);
  assert.ok(urls.every((u) => !u.includes('oslobysykkel')), 'no Bysykkel data needed');
  assert.equal(racers[0].id, 'bike'); // faster than the 2000 s walk
});

test('Bysykkel is still the default bike', async () => {
  fakeEntur();
  const racers = await planRace(from, to, { stations: [] });
  const bike = racers.find((r) => r.id === 'bike');
  assert.equal(bike.name, 'Bysykkel');
  assert.match(bike.error, /No Bysykkel station/);
});
