import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeStyle } from '../js/basemap.js';

const base = {
  version: 8,
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
    { id: 'landuse_residential', type: 'fill', paint: { 'fill-color': '#000', 'fill-opacity': 0.5 } },
    { id: 'highway_major_casing', type: 'line', paint: { 'line-color': '#000', 'line-width': 3 } },
    { id: 'label_city', type: 'symbol', paint: { 'text-color': '#000' } },
    { id: 'something_else', type: 'line', paint: { 'line-color': '#123456' } },
  ],
};

test('themeStyle recolours known layers and keeps other paint settings', () => {
  const out = themeStyle(base, 'light');
  const byId = Object.fromEntries(out.layers.map((l) => [l.id, l]));
  assert.notEqual(byId.background.paint['background-color'], '#000');
  assert.equal(byId.landuse_residential.paint['fill-opacity'], 0.5);
  assert.equal(byId.highway_major_casing.paint['line-width'], 3);
  assert.notEqual(byId.label_city.paint['text-color'], '#000');
  assert.equal(byId.something_else.paint['line-color'], '#123456');
  assert.equal(base.layers[0].paint['background-color'], '#000'); // input untouched
});

test('themeStyle adds green grass right after residential areas, in both modes', () => {
  for (const mode of ['light', 'dark']) {
    const ids = themeStyle(base, mode).layers.map((l) => l.id);
    assert.equal(ids[ids.indexOf('landuse_residential') + 1], 'landcover_grass');
  }
  const light = themeStyle(base, 'light').layers.find((l) => l.id === 'background');
  const dark = themeStyle(base, 'dark').layers.find((l) => l.id === 'background');
  assert.notEqual(light.paint['background-color'], dark.paint['background-color']);
});
