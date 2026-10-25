// UI: map, address search, the race animation and the day chart.
import {
  fetchStations, searchPlaces, reverseGeocode, fetchStopsInArea, fetchStopDetails,
} from './api.js';
import { planRace } from './race.js';
import { transitDayProfile } from './day.js';
import { renderDayChart } from './chart.js';
import { addBasemap } from './basemap.js';
import {
  positionAt, formatDuration, formatClock, escapeHtml, periodsWhere, MODE_ICON,
} from './logic.js';

const RACE_REAL_MS = 22000; // the last finisher crosses the line after 22 real seconds
const OSLO = [59.9139, 10.7522];
const MEDALS = ['🥇', '🥈', '🥉'];

const $ = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const racerColor = (id) => cssVar(`--${id}`);

const state = {
  from: null,       // { lat, lon, label }
  to: null,
  picking: 'from',  // which point a map click sets
  stations: [],
  racers: [],
  now: null,
  walkKmh: 5,       // speeds used in the latest race
  animFrame: null,
};

// ---------- Map ----------

const map = L.map('map').setView(OSLO, 13);
addBasemap(map).catch(() => setStatus('Could not load the map background.', true));

const stopLayer = L.layerGroup().addTo(map);
const stationLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const racerLayer = L.layerGroup().addTo(map);
const endMarkers = { from: null, to: null };

function endIcon(letter, color) {
  return L.divIcon({
    className: '',
    html: `<div class="end-marker" style="background:${color}"><span>${letter}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 31],
  });
}

const STATION_MIN_ZOOM = 16; // all stations and stops are only shown when zoomed in close
const TIP_OPTIONS = { direction: 'top', offset: [0, -8], className: 'map-tip', opacity: 1 };

const plural = (n, word) => (n === 1 ? word : `${word}s`);

function stationTip(s) {
  return `<div class="tip-title">🚲 ${escapeHtml(s.name)}</div>
    <div class="tip-sub">Bysykkel station</div>
    <div class="tip-stats">
      <span><b>${s.bikes - s.ebikes}</b> ${plural(s.bikes - s.ebikes, 'bike')}</span>
      <span><b>${s.ebikes}</b> ${plural(s.ebikes, 'e-bike')}</span>
      <span><b>${s.docks}</b> free ${plural(s.docks, 'dock')}</span>
    </div>
    ${s.renting ? '' : '<div class="tip-note">Not renting out bikes right now</div>'}`;
}

// The stations used in the current race are always shown; the rest only when zoomed in.
function drawStations() {
  stationLayer.clearLayers();
  const used = state.racers.find((r) => r.id === 'bike' && !r.error)?.stations ?? [];
  const usedIds = new Set(used.map((s) => s.id));
  const showAll = map.getZoom() >= STATION_MIN_ZOOM;
  for (const s of state.stations) {
    const isUsed = usedIds.has(s.id);
    if (!showAll && !isUsed) continue;
    L.circleMarker([s.lat, s.lon], isUsed
      ? { radius: 7, weight: 2, color: '#fff', fillColor: racerColor('bike'), fillOpacity: 1 }
      : { radius: 4, weight: 0, fillColor: s.bikes > 0 ? racerColor('bike') : '#999', fillOpacity: 0.5 })
      .bindTooltip(stationTip(s), TIP_OPTIONS)
      .addTo(stationLayer);
  }
}

// ---------- Public transport stops (shown when zoomed in) ----------

const stopMarkers = new Map();  // stop id -> marker
const stopDetails = new Map();  // stop id -> { promise, at }; departures are live, so cached briefly
const DETAILS_TTL_MS = 60000;
let stopRequest = 0;

function departureIn(time) {
  const min = Math.round((time - Date.now()) / 60000);
  if (min <= 0) return 'now';
  return min < 15 ? `${min} min` : formatClock(time);
}

function stopTip(name, details) {
  if (!details) return `<div class="tip-title">${escapeHtml(name)}</div><div class="tip-sub">Loading lines and departures…</div>`;
  const byMode = new Map();
  for (const l of details.lines) {
    if (!byMode.has(l.mode)) byMode.set(l.mode, []);
    byMode.get(l.mode).push(l.code);
  }
  const lines = [...byMode].map(([mode, codes]) =>
    `<div class="tip-lines">${MODE_ICON[mode] ?? '🚏'} ${codes.map((c) => `<span class="line-badge">${escapeHtml(c)}</span>`).join('')}</div>`).join('');
  const deps = details.departures.length
    ? `<ul class="tip-deps">${details.departures.map((d) => `<li>
        <span class="line-badge">${escapeHtml(d.code)}</span>
        <span class="dep-dest">${escapeHtml(d.destination)}</span>
        <span class="dep-time">${departureIn(d.time)}</span></li>`).join('')}</ul>`
    : '<div class="tip-note">No departures in the next 2 hours</div>';
  return `<div class="tip-title">${escapeHtml(details.name)}</div>${lines}<div class="tip-sub">Next departures</div>${deps}`;
}

function addStopMarker(stop) {
  const marker = L.marker([stop.lat, stop.lon], {
    icon: L.divIcon({ className: '', html: '<div class="stop-marker"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
    bubblingMouseEvents: true, // a click still sets the start/destination like elsewhere on the map
    keyboard: false,
  }).bindTooltip(stopTip(stop.name), TIP_OPTIONS);
  marker.on('tooltipopen', async () => {
    let cached = stopDetails.get(stop.id);
    if (!cached || Date.now() - cached.at > DETAILS_TTL_MS) {
      cached = { promise: fetchStopDetails(stop.id), at: Date.now() };
      stopDetails.set(stop.id, cached);
    }
    try {
      marker.setTooltipContent(stopTip(stop.name, await cached.promise));
    } catch {
      stopDetails.delete(stop.id);
      marker.setTooltipContent(`<div class="tip-title">${escapeHtml(stop.name)}</div><div class="tip-note">Could not load departures</div>`);
    }
  });
  marker.addTo(stopLayer);
  stopMarkers.set(stop.id, marker);
}

async function loadStops() {
  const request = ++stopRequest;
  if (map.getZoom() < STATION_MIN_ZOOM) {
    stopLayer.clearLayers();
    stopMarkers.clear();
    return;
  }
  const b = map.getBounds().pad(0.2);
  try {
    const stops = await fetchStopsInArea({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    if (request !== stopRequest) return; // the map moved again meanwhile
    for (const stop of stops) if (!stopMarkers.has(stop.id)) addStopMarker(stop);
  } catch {
    // stops are an extra; the race works without them
  }
}

map.on('zoomend', drawStations);
map.on('moveend', loadStops);

map.on('click', async (e) => {
  if (!state.picking) return;
  const which = state.picking;
  await setPointFromMap(which, { lat: e.latlng.lat, lon: e.latlng.lng });
});

async function setPointFromMap(which, point) {
  setPoint(which, { ...point, label: 'Pin on map' });
  try {
    const label = await reverseGeocode(point);
    if (label && state[which]?.lat === point.lat) setPoint(which, { ...point, label });
  } catch { /* keep "Pin on map" */ }
}

// ---------- From / to points ----------

function setPoint(which, point) {
  state[which] = point;
  $(`${which}-input`).value = point.label;
  const color = which === 'from' ? '#2b8a3e' : '#c92a2a';
  if (!endMarkers[which]) {
    endMarkers[which] = L.marker([point.lat, point.lon], {
      icon: endIcon(which === 'from' ? 'A' : 'B', color),
      draggable: true,
      zIndexOffset: 1000,
    }).addTo(map);
    endMarkers[which].on('dragend', (e) => {
      const { lat, lng } = e.target.getLatLng();
      setPointFromMap(which, { lat, lon: lng });
    });
  } else {
    endMarkers[which].setLatLng([point.lat, point.lon]);
  }
  if (which === 'from' && !state.to) setPicking('to');
  $('race-btn').disabled = !(state.from && state.to);
}

function setPicking(which) {
  state.picking = which;
  $('from-input').classList.toggle('picking', which === 'from');
  $('to-input').classList.toggle('picking', which === 'to');
}

function setupAutocomplete(which) {
  const input = $(`${which}-input`);
  const list = $(`${which}-suggestions`);
  let results = [];
  let active = -1;
  let timer = null;
  let requestId = 0;

  const close = () => { list.innerHTML = ''; results = []; active = -1; };
  const choose = (i) => {
    if (!results[i]) return;
    setPoint(which, results[i]);
    map.panTo([results[i].lat, results[i].lon]);
    close();
  };
  const render = () => {
    list.innerHTML = results
      .map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">${escapeHtml(r.label)}</li>`)
      .join('');
  };

  input.addEventListener('focus', () => setPicking(which));
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      const id = ++requestId;
      try {
        const found = await searchPlaces(text);
        if (id !== requestId) return; // a newer search has started
        results = found;
        active = -1;
        render();
      } catch {
        close();
      }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % results.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + results.length) % results.length; render(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active < 0 ? 0 : active); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  // mousedown fires before the input's blur, so the click is not lost
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}

$('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('Your browser does not support location.', true);
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'My location' };
      setPoint('from', point);
      map.setView([point.lat, point.lon], 15);
      setStatus('');
    },
    () => setStatus('Could not get your location. Search or click the map instead.', true),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

$('swap-btn').addEventListener('click', () => {
  const { from, to } = state;
  if (to) setPoint('from', to);
  if (from) setPoint('to', from);
});

// ---------- Race ----------

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

$('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.from || !state.to) return;
  const btn = $('race-btn');
  btn.disabled = true;
  setStatus('Checking live bikes and departures…');
  try {
    state.stations = await fetchStations();
    state.now = new Date();
    state.racers = await planRace(state.from, state.to, {
      bikeType: bikeType(),
      bikeKmh: Number($('bike-speed').value),
      walkKmh: Number($('walk-speed').value),
      now: state.now,
      stations: state.stations,
    });
    drawStations();
    if (state.racers.every((r) => r.error)) {
      setStatus(`No racer could find a route: ${state.racers[0].error}`, true);
      return;
    }
    setStatus('');
    state.walkKmh = Number($('walk-speed').value);
    renderResults();
    resetDay();
    drawRoutes();
    startRace();
  } catch (err) {
    setStatus(`Could not reach the live APIs (${err.message}). Try again in a moment.`, true);
  } finally {
    btn.disabled = false;
  }
});

$('replay-btn').addEventListener('click', startRace);

// ---------- Bike choice ----------

const BIKE_HINTS = {
  city: 'Walk to the nearest station with bikes, ride, and dock near your destination.',
  own: 'Ride door to door, plus a minute to get your bike out and a minute to lock it.',
};
const bikeType = () => document.querySelector('input[name="bike-type"]:checked').value;
const showBikeHint = () => { $('bike-hint').textContent = BIKE_HINTS[bikeType()]; };
document.querySelectorAll('input[name="bike-type"]').forEach((input) => input.addEventListener('change', showBikeHint));
showBikeHint();

function renderResults() {
  const finishers = state.racers.filter((r) => !r.error);
  const [winner, second] = finishers;
  const margin = second ? second.finish - winner.finish : 0;
  let headline = `${winner.icon} ${winner.name} wins!`;
  let detail = second
    ? `${formatDuration(margin)} ahead of ${second.name.toLowerCase()}`
    : 'Win by walkover: nobody else could start';
  if (second && margin < 60) {
    headline = `📸 Photo finish! ${winner.icon} ${winner.name} by a nose`;
    detail = `Less than a minute ahead of ${second.name.toLowerCase()}`;
  }
  $('verdict').innerHTML = `${escapeHtml(headline)}<small>${escapeHtml(detail)}</small>`;

  $('racer-cards').innerHTML = state.racers.map((r) => {
    if (r.error) {
      return `<li class="racer-card failed" style="--racer:${racerColor(r.id)}">
        <div class="racer-head"><span class="place">❌</span><span>${r.icon}</span><span class="name">${r.name}</span></div>
        <p class="error">${escapeHtml(r.error)}</p>
      </li>`;
    }
    const eta = new Date(state.now.getTime() + r.finish * 1000);
    return `<li class="racer-card" id="card-${r.id}" style="--racer:${racerColor(r.id)}">
      <div class="racer-head">
        <span class="place"></span><span>${r.icon}</span><span class="name">${r.name}</span>
        <span class="time">${formatDuration(r.finish)}</span>
      </div>
      <div class="racer-eta">Arrive ${formatClock(eta)}</div>
      <div class="progress"><div></div></div>
      <details>
        <summary>Route details</summary>
        <ul class="racer-steps">${r.steps.map((s) => `<li>${s}</li>`).join('')}</ul>
      </details>
    </li>`;
  }).join('');
  $('results').hidden = false;
}

function drawRoutes() {
  routeLayer.clearLayers();
  const bounds = L.latLngBounds([[state.from.lat, state.from.lon], [state.to.lat, state.to.lon]]);
  for (const r of state.racers) {
    if (r.error) continue;
    r.lines = [];
    for (const seg of r.timeline) {
      if (seg.coords.length < 2) continue;
      const walking = seg.mode === 'foot';
      const line = L.polyline(seg.coords, {
        color: racerColor(r.id),
        weight: walking ? 3 : 5,
        dashArray: walking ? '4 7' : null,
      }).addTo(routeLayer);
      r.lines.push({ line, walking });
      bounds.extend(seg.coords);
    }
  }
  map.fitBounds(bounds, { padding: [40, 40] });
}

// Full strength for everyone during the race; afterwards only the winner's route stays strong.
function styleRoutes(winnerId = null) {
  for (const r of state.racers) {
    for (const { line, walking } of r.lines ?? []) {
      const faded = winnerId && r.id !== winnerId;
      line.setStyle({ opacity: faded ? 0.15 : walking ? 0.6 : 0.8 });
      if (!faded) line.bringToFront();
    }
  }
}

function formatRaceClock(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startRace() {
  cancelAnimationFrame(state.animFrame);
  racerLayer.clearLayers();
  const runners = state.racers.filter((r) => !r.error);
  const lastFinish = Math.max(...runners.map((r) => r.finish));
  const raceSecPerMs = lastFinish / RACE_REAL_MS;
  styleRoutes();

  for (const r of runners) {
    const pos = positionAt(r.timeline, 0) ?? [state.from.lat, state.from.lon];
    r.marker = L.marker(pos, {
      icon: L.divIcon({
        className: '',
        html: `<div class="racer-marker" style="--racer:${racerColor(r.id)}">${r.icon}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
      interactive: false,
    }).addTo(racerLayer);
    r.card = $(`card-${r.id}`);
    r.card.classList.remove('winner');
    r.card.querySelector('.place').textContent = '';
    r.placed = false;
  }

  let finishedCount = 0;
  const t0 = performance.now();
  const frame = (nowMs) => {
    const t = Math.min(lastFinish, (nowMs - t0) * raceSecPerMs);
    $('clock').textContent = formatRaceClock(t);
    for (const r of runners) {
      const pos = positionAt(r.timeline, t);
      if (pos) r.marker.setLatLng(pos);
      r.card.querySelector('.progress > div').style.width = `${Math.min(100, (t / r.finish) * 100)}%`;
      if (!r.placed && t >= r.finish) {
        r.placed = true;
        r.card.querySelector('.place').textContent = MEDALS[finishedCount] ?? '';
        if (finishedCount === 0) r.card.classList.add('winner');
        finishedCount++;
      }
    }
    if (t < lastFinish) state.animFrame = requestAnimationFrame(frame);
    else styleRoutes(runners[0].id);
  };
  state.animFrame = requestAnimationFrame(frame);
}

// ---------- When should I go? ----------

function setupDaySelect() {
  const select = $('day-select');
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
      : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    select.add(new Option(label, String(i)));
  }
}

function resetDay() {
  $('day-summary').textContent = '';
  $('day-chart').innerHTML = '';
}

// One sentence answering the question, comparing public transport with the bike (or walking).
function daySummary(points, rival) {
  const rivalName = rival.id === 'bike' ? 'the bike' : 'walking';
  const periods = periodsWhere(points, (p) => p.transit != null && p.transit < rival.finish);
  if (periods.length === 0) {
    return `${rival.icon} <b>${rival.id === 'bike' ? 'The bike' : 'Walking'} wins all day.</b> Public transport is never faster on this trip.`;
  }
  const ranges = periods.map((p) => (p.from === p.to
    ? `at ${formatClock(p.from.time)}`
    : `${formatClock(p.from.time)}–${formatClock(p.to.time)}`));
  const shown = ranges.length > 4 ? [...ranges.slice(0, 3), `${ranges.length - 3} more times`] : ranges;
  return `🚌 <b>Public transport beats ${rivalName}</b> if you leave ${new Intl.ListFormat('en').format(shown)}.`;
}

$('day-btn').addEventListener('click', async () => {
  if (!state.from || !state.to || state.racers.length === 0) return;
  const btn = $('day-btn');
  btn.disabled = true;
  resetDay();
  const summary = $('day-summary');
  const offset = Number($('day-select').value);
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const racer = (id) => state.racers.find((r) => r.id === id && !r.error);
  try {
    const points = await transitDayProfile(state.from, state.to, date, {
      walkKmh: state.walkKmh,
      onProgress: (done, total) => { summary.textContent = `Checking departures through the day… ${done}/${total}`; },
    });
    if (points.every((p) => p.transit == null)) {
      summary.textContent = 'Could not find any public transport for this trip on that day.';
      return;
    }
    const times = points.map((p) => p.time);
    const flat = (r) => times.map(() => r.finish);
    const series = [];
    if (racer('bike')) series.push({ id: 'bike', name: racer('bike').name, color: racerColor('bike'), values: flat(racer('bike')) });
    series.push({ id: 'transit', name: 'Public transport', color: racerColor('transit'), values: points.map((p) => p.transit) });
    if (racer('walk')) series.push({ id: 'walk', name: 'Walking', color: racerColor('walk'), values: flat(racer('walk')) });

    const rival = racer('bike') ?? racer('walk');
    summary.innerHTML = rival ? daySummary(points, rival) : '';
    renderDayChart($('day-chart'), {
      times,
      series,
      yCapSec: racer('walk') ? racer('walk').finish * 1.5 : null,
      now: offset === 0 ? new Date() : null,
    });
  } catch (err) {
    summary.textContent = `Could not load the day (${err.message}).`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Start-up ----------

setupDaySelect();

setupAutocomplete('from');
setupAutocomplete('to');
setPicking('from');

(async () => {
  setStatus('Loading live Bysykkel stations…');
  try {
    state.stations = await fetchStations();
    drawStations();
    const open = state.stations.filter((s) => s.renting);
    const bikes = open.reduce((n, s) => n + s.bikes, 0);
    if (open.length === 0) {
      setStatus('Bysykkel looks closed right now (winter break?). Bus and walking still race.');
    } else {
      setStatus(`${open.length} stations live · ${bikes} bikes available right now. Pick a start and a destination (zoom in to see stations).`);
    }
  } catch (err) {
    setStatus(`Could not load Bysykkel stations (${err.message}).`, true);
  }
})();
