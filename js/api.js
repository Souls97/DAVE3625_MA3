// Network calls to open APIs. None of them need an API key.
//  - Oslo Bysykkel GBFS: live station info and status
//  - Entur Journey Planner: walking / cycling / public transport routes in Norway
//  - Entur Geocoder: address search

const CLIENT_NAME = 'oslomet-sykkelellerbuss';
const GBFS = 'https://gbfs.urbansharing.com/oslobysykkel.no';
const JOURNEY_PLANNER = 'https://api.entur.io/journey-planner/v3/graphql';
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete';

async function getJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

// All Bysykkel stations merged with their live status.
export async function fetchStations() {
  const headers = { 'Client-Identifier': CLIENT_NAME };
  const [info, status] = await Promise.all([
    getJson(`${GBFS}/station_information.json`, { headers }),
    getJson(`${GBFS}/station_status.json`, { headers }),
  ]);
  const statusById = new Map(status.data.stations.map((s) => [s.station_id, s]));
  return info.data.stations.map((s) => {
    const st = statusById.get(s.station_id) ?? {};
    return {
      id: s.station_id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity,
      bikes: st.num_bikes_available ?? 0,
      ebikes: st.vehicle_types_available?.find((v) => v.vehicle_type_id === 'ebike')?.count ?? 0,
      docks: st.num_docks_available ?? 0,
      renting: Boolean(st.is_installed && st.is_renting),
      returning: Boolean(st.is_installed && st.is_returning),
    };
  });
}

const TRIP_QUERY = `
query ($from: Location!, $to: Location!, $modes: Modes, $n: Int, $walkSpeed: Float, $dateTime: DateTime) {
  trip(from: $from, to: $to, modes: $modes, numTripPatterns: $n, walkSpeed: $walkSpeed, dateTime: $dateTime) {
    tripPatterns {
      expectedStartTime
      expectedEndTime
      duration
      distance
      legs {
        mode
        distance
        duration
        expectedStartTime
        expectedEndTime
        fromPlace { name }
        toPlace { name }
        line { publicCode name }
        pointsOnLink { points }
      }
    }
  }
}`;

const asLocation = (p) => ({ coordinates: { latitude: p.lat, longitude: p.lon } });

async function graphql(query, variables) {
  const body = await getJson(JOURNEY_PLANNER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
    body: JSON.stringify({ query, variables }),
  });
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

// Trip patterns from Entur. mode: 'transit' (default modes), 'foot' or 'bicycle'.
// walkKmh sets the walking speed (Entur adjusts it for hills); dateTime defaults to now.
export async function fetchTrip(from, to, mode = 'transit', { walkKmh = 5, dateTime } = {}) {
  const variables = {
    from: asLocation(from), to: asLocation(to), n: mode === 'transit' ? 5 : 1, walkSpeed: walkKmh / 3.6,
  };
  if (mode !== 'transit') variables.modes = { directMode: mode, transportModes: [] };
  if (dateTime) variables.dateTime = dateTime.toISOString();
  const data = await graphql(TRIP_QUERY, variables);
  return data.trip.tripPatterns;
}

// Public transport stops inside a map area. bounds: { south, west, north, east }
export async function fetchStopsInArea({ south, west, north, east }) {
  const data = await graphql(`
    query ($s: Float!, $w: Float!, $n: Float!, $e: Float!) {
      stopPlacesByBbox(minimumLatitude: $s, minimumLongitude: $w, maximumLatitude: $n, maximumLongitude: $e) {
        id name latitude longitude transportMode
        quays { lines { id } }
      }
    }`, { s: south, w: west, n: north, e: east });
  // some stops have no lines at all (e.g. closed for roadworks); leave those out
  const served = data.stopPlacesByBbox.filter((s) => s.quays.some((q) => q.lines.length > 0));
  return served.map((s) => ({
    id: s.id, name: s.name, lat: s.latitude, lon: s.longitude, modes: s.transportMode ?? [],
  }));
}

// Lines serving a stop and its next live departures.
export async function fetchStopDetails(id) {
  const data = await graphql(`
    query ($id: String!) {
      stopPlace(id: $id) {
        name
        quays { lines { publicCode transportMode } }
        estimatedCalls(numberOfDepartures: 5, timeRange: 7200) {
          expectedDepartureTime
          destinationDisplay { frontText }
          serviceJourney { line { publicCode transportMode } }
        }
      }
    }`, { id });
  const stop = data.stopPlace;
  if (!stop) throw new Error('Stop not found');
  const lines = new Map();
  for (const quay of stop.quays) {
    for (const l of quay.lines) lines.set(`${l.transportMode}:${l.publicCode}`, { code: l.publicCode, mode: l.transportMode });
  }
  return {
    name: stop.name,
    lines: [...lines.values()].sort((a, b) =>
      a.mode.localeCompare(b.mode) || a.code.localeCompare(b.code, 'nb', { numeric: true })),
    departures: stop.estimatedCalls.map((c) => ({
      time: new Date(c.expectedDepartureTime),
      code: c.serviceJourney.line.publicCode,
      mode: c.serviceJourney.line.transportMode,
      destination: c.destinationDisplay?.frontText ?? '',
    })),
  };
}

// Address / place search, biased towards central Oslo.
export async function searchPlaces(text) {
  const params = new URLSearchParams({
    text, size: '6', lang: 'no', 'focus.point.lat': '59.9139', 'focus.point.lon': '10.7522',
  });
  const body = await getJson(`${GEOCODER}?${params}`, { headers: { 'ET-Client-Name': CLIENT_NAME } });
  return body.features.map((f) => ({
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

// Nearest address for a point, or null.
export async function reverseGeocode(point) {
  const params = new URLSearchParams({
    'point.lat': point.lat, 'point.lon': point.lon, size: '1', layers: 'address', lang: 'no',
  });
  const body = await getJson(`https://api.entur.io/geocoder/v1/reverse?${params}`, {
    headers: { 'ET-Client-Name': CLIENT_NAME },
  });
  return body.features[0]?.properties.label ?? null;
}
