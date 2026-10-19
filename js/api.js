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
      docks: st.num_docks_available ?? 0,
      renting: Boolean(st.is_installed && st.is_renting),
      returning: Boolean(st.is_installed && st.is_returning),
    };
  });
}

const TRIP_QUERY = `
query ($from: Location!, $to: Location!, $modes: Modes, $n: Int, $walkSpeed: Float) {
  trip(from: $from, to: $to, modes: $modes, numTripPatterns: $n, walkSpeed: $walkSpeed) {
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

// Trip patterns from Entur. mode: 'transit' (default modes), 'foot' or 'bicycle'.
// walkKmh sets the walking speed; Entur adjusts it for hills.
export async function fetchTrip(from, to, mode = 'transit', walkKmh = 5) {
  const variables = {
    from: asLocation(from), to: asLocation(to), n: mode === 'transit' ? 5 : 1, walkSpeed: walkKmh / 3.6,
  };
  if (mode !== 'transit') variables.modes = { directMode: mode, transportModes: [] };
  const body = await getJson(JOURNEY_PLANNER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
    body: JSON.stringify({ query: TRIP_QUERY, variables }),
  });
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data.trip.tripPatterns;
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
