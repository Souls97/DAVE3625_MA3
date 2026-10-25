// Background map: OpenFreeMap vector tiles (free, no key), recoloured to match the side panel.
// Parks and forest stay green; everything else uses the panel's cool greys and a blue for water.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const THEMES = {
  light: {
    land: '#eef0f3', residential: '#e9ecf0', building: '#e0e4ea', buildingLine: '#d3d8e0',
    water: '#c6daf0', waterText: '#3d5f8f',
    grass: '#d7ebd3', wood: '#c4e0c0', park: '#d7ebd3',
    road: '#ffffff', roadCasing: '#d6dbe3', minorRoad: '#ffffff', path: '#e2e6ec',
    rail: '#cfd4dc', boundary: '#b5bcc8',
    label: '#1c2230', roadLabel: '#5f6878', halo: '#eef0f3',
  },
  dark: {
    land: '#151a22', residential: '#171c25', building: '#1f2530', buildingLine: '#272e3b',
    water: '#0f2336', waterText: '#7fa6d6',
    grass: '#1b3424', wood: '#1d3a27', park: '#1b3424',
    road: '#2a313e', roadCasing: '#1c222c', minorRoad: '#232a35', path: '#212733',
    rail: '#2d3542', boundary: '#3a4352',
    label: '#e6e9ef', roadLabel: '#9aa3b2', halo: '#11151c',
  },
};

// Which colour each layer of the base style gets. Keys are layer ids, or prefixes ending in '*'.
const PAINT = {
  background: (t) => ({ 'background-color': t.land }),
  park: (t) => ({ 'fill-color': t.park }),
  water: (t) => ({ 'fill-color': t.water }),
  landuse_residential: (t) => ({ 'fill-color': t.residential }),
  landcover_wood: (t) => ({ 'fill-color': t.wood }),
  waterway: (t) => ({ 'line-color': t.water }),
  building: (t) => ({ 'fill-color': t.building, 'fill-outline-color': t.buildingLine }),
  'road_area_pier': (t) => ({ 'fill-color': t.land }),
  'road_pier': (t) => ({ 'line-color': t.land }),
  'highway_path': (t) => ({ 'line-color': t.path }),
  'highway_minor': (t) => ({ 'line-color': t.minorRoad }),
  '*_casing': (t) => ({ 'line-color': t.roadCasing }),
  '*_inner': (t) => ({ 'line-color': t.road }),
  '*_subtle': (t) => ({ 'line-color': t.roadCasing }),
  'railway*': (t) => ({ 'line-color': t.rail }),
  'boundary*': (t) => ({ 'line-color': t.boundary }),
  'water_name*': (t) => ({ 'text-color': t.waterText, 'text-halo-color': t.water }),
  'highway-name*': (t) => ({ 'text-color': t.roadLabel, 'text-halo-color': t.halo }),
  'label_*': (t) => ({ 'text-color': t.label, 'text-halo-color': t.halo }),
  'aeroway-area': (t) => ({ 'fill-color': t.residential }),
  'aeroway-runway': (t) => ({ 'line-color': t.road }),
  'aeroway-runway-casing': (t) => ({ 'line-color': t.roadCasing }),
  'aeroway-taxiway': (t) => ({ 'line-color': t.roadCasing }),
  airport: (t) => ({ 'text-color': t.roadLabel, 'text-halo-color': t.halo }),
};

function paintFor(id) {
  if (PAINT[id]) return PAINT[id];
  const key = Object.keys(PAINT).find((k) => k.includes('*') && (
    k.startsWith('*') ? id.endsWith(k.slice(1)) : id.startsWith(k.slice(0, -1))));
  return key ? PAINT[key] : null;
}

// City parks, lawns and gardens are "grass" in the landcover data; positron leaves them grey.
const grassLayer = (t) => ({
  id: 'landcover_grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
  filter: ['==', ['get', 'class'], 'grass'],
  paint: { 'fill-color': t.grass },
});

// Returns a copy of the base style with our colours. Pure, so it can be tested without a browser.
export function themeStyle(style, mode = 'light') {
  const t = THEMES[mode] ?? THEMES.light;
  const layers = [];
  for (const layer of style.layers) {
    const paint = paintFor(layer.id);
    layers.push(paint ? { ...layer, paint: { ...layer.paint, ...paint(t) } } : layer);
    if (layer.id === 'landuse_residential') layers.push(grassLayer(t));
  }
  return { ...style, layers };
}

// Adds the map to Leaflet and follows the system's light/dark setting.
export async function addBasemap(map) {
  const base = await fetch(STYLE_URL).then((r) => r.json());
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const mode = () => (dark.matches && document.documentElement.dataset.theme !== 'light' ? 'dark' : 'light');
  const layer = L.maplibreGL({
    style: themeStyle(base, mode()),
    attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> '
      + '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
      + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  dark.addEventListener('change', () => layer.getMaplibreMap().setStyle(themeStyle(base, mode())));
  return layer;
}
