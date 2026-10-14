import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { mapStyle } from './style';

// An invalid style does not throw: MapLibre quietly never loads the map. This
// catches a bad expression or colour before it reaches a browser.
describe('map style', () => {
  beforeAll(() => {
    // jsdom does not apply stylesheets, so copy the colour tokens onto :root.
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    for (const [, name, value] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g))
      document.documentElement.style.setProperty(name!, value!.trim());
  });
  for (const projection of ['Globe', 'Flat'] as const)
    it(`is valid for ${projection}`, () => {
      const errors = validateStyleMin(mapStyle(projection)).map((e) => e.message);
      expect(errors).toEqual([]);
    });
});
