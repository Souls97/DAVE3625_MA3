// UI: map, address search, and the race animation.
import { fetchStations, searchPlaces, reverseGeocode } from './api.js';
import { planRace } from './race.js';
import { positionAt, formatDuration, formatClock, escapeHtml } from './logic.js';

const RACE_REAL_MS = 12000; // the last finisher crosses the line after 12 real seconds
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
  animFrame: null,
};

// ---------- Map ----------

const map = L.map('map').setView(OSLO, 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

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

function drawStations() {
  stationLayer.clearLayers();
  for (const s of state.stations) {
    L.circleMarker([s.lat, s.lon], {
      radius: 4,
      weight: 1,
      color: s.bikes > 0 ? racerColor('bike') : '#999',
      fillOpacity: 0.6,
    })
      .bindPopup(`<b>${escapeHtml(s.name)}</b><br>🚲 ${s.bikes} bikes · 🅿️ ${s.docks} free docks`)
      .addTo(stationLayer);
  }
}

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
    drawStations();
    state.now = new Date();
    state.racers = await planRace(state.from, state.to, {
      kmh: Number($('speed-select').value),
      now: state.now,
      stations: state.stations,
    });
    if (state.racers.every((r) => r.error)) {
      setStatus(`No racer could find a route: ${state.racers[0].error}`, true);
      return;
    }
    setStatus('');
    renderResults();
    drawRoutes();
    startRace();
  } catch (err) {
    setStatus(`Could not reach the live APIs (${err.message}). Try again in a moment.`, true);
  } finally {
    btn.disabled = false;
  }
});

$('replay-btn').addEventListener('click', startRace);

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
      <ul class="racer-steps">${r.steps.map((s) => `<li>${s}</li>`).join('')}</ul>
    </li>`;
  }).join('');
  $('results').hidden = false;
}

function drawRoutes() {
  routeLayer.clearLayers();
  const bounds = L.latLngBounds([[state.from.lat, state.from.lon], [state.to.lat, state.to.lon]]);
  for (const r of state.racers) {
    if (r.error) continue;
    for (const seg of r.timeline) {
      if (seg.coords.length < 2) continue;
      const walking = seg.mode === 'foot';
      L.polyline(seg.coords, {
        color: racerColor(r.id),
        weight: walking ? 3 : 5,
        opacity: walking ? 0.5 : 0.65,
        dashArray: walking ? '4 7' : null,
      }).addTo(routeLayer);
      bounds.extend(seg.coords);
    }
  }
  map.fitBounds(bounds, { padding: [40, 40] });
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
  };
  state.animFrame = requestAnimationFrame(frame);
}

// ---------- Start-up ----------

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
      setStatus(`${open.length} stations live · ${bikes} bikes available right now. Pick a start and a destination.`);
    }
  } catch (err) {
    setStatus(`Could not load Bysykkel stations (${err.message}).`, true);
  }
})();
