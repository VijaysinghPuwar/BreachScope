import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';

// Detail from OpenFreeMap: free OpenStreetMap vector tiles with no key and no
// usage limit (https://openfreemap.org). Zoomed far out the Natural Earth
// basemap is used; detail fades in from zoom 3 and the precise OSM coastline
// takes over from DETAIL_FROM.
//
// Country borders always come from the Natural Earth India point-of-view file.
// OSM state and province lines are drawn, but never disputed or maritime ones,
// so a single, consistent national boundary is shown at every zoom.
export const DETAIL_URL = 'https://tiles.openfreemap.org/planet';
export const DETAIL_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const DETAIL_FROM = 4;
const FONT = ['Noto Sans Regular'];
const FONT_ITALIC = ['Noto Sans Italic'];

type Tokens = (name: string) => string;

// MapLibre allows one zoom interpolation per expression, and only at the top
// level, so opacity ramps take their peak as a parameter instead of being
// multiplied afterwards.
const fadeIn = (from: number, to = from + 1, peak = 1): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  from,
  0,
  to,
  peak,
];
const widths = (...stops: number[]): ExpressionSpecification => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...stops,
];
const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name']];

/** Drawn under the data marks: land texture, water, roads, buildings, state lines. */
export function detailBase(t: Tokens): LayerSpecification[] {
  return [
    {
      // Forest, grass, ice and sand as faint tone shifts on the dark land.
      id: 'detail-landcover',
      type: 'fill',
      source: 'detail',
      'source-layer': 'landcover',
      minzoom: 3,
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'wood',
          '#1b221e',
          'grass',
          '#1c211f',
          'farmland',
          '#1d2120',
          'wetland',
          '#1a2022',
          'ice',
          '#242a31',
          'sand',
          '#23211d',
          '#1c2024',
        ],
        'fill-opacity': fadeIn(3, 4, 0.9),
      },
    },
    {
      id: 'detail-parks',
      type: 'fill',
      source: 'detail',
      'source-layer': 'park',
      minzoom: 6,
      paint: { 'fill-color': '#1b231f', 'fill-opacity': fadeIn(6) },
    },
    {
      // Built-up areas, so cities read as places when zoomed in.
      id: 'detail-urban',
      type: 'fill',
      source: 'detail',
      'source-layer': 'landuse',
      minzoom: 7,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['residential', 'commercial', 'industrial', 'retail']],
      ],
      paint: { 'fill-color': '#21252b', 'fill-opacity': fadeIn(7) },
    },
    {
      // Lakes from zoom 3; the ocean switches to the precise OSM coastline later.
      id: 'detail-water',
      type: 'fill',
      source: 'detail',
      'source-layer': 'water',
      minzoom: 3,
      paint: {
        'fill-color': t('--bg-base'),
        // Lakes fade in from zoom 3, the ocean from DETAIL_FROM.
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          0,
          DETAIL_FROM,
          ['case', ['==', ['get', 'class'], 'ocean'], 0, 1],
          DETAIL_FROM + 1,
          1,
        ],
      },
    },
    {
      id: 'detail-rivers',
      type: 'line',
      source: 'detail',
      'source-layer': 'waterway',
      minzoom: 4,
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      paint: {
        'line-color': t('--bg-base'),
        'line-width': widths(4, 0.4, 10, 1.5, 15, 4),
        'line-opacity': fadeIn(4),
      },
    },
    {
      id: 'detail-states',
      type: 'line',
      source: 'detail',
      'source-layer': 'boundary',
      minzoom: 2.5,
      filter: [
        'all',
        ['==', ['get', 'admin_level'], 4],
        ['!=', ['get', 'disputed'], 1],
        ['!=', ['get', 'maritime'], 1],
      ],
      paint: {
        'line-color': '#3d444e',
        'line-width': widths(3, 0.5, 8, 1.2),
        'line-dasharray': [3, 2],
        'line-opacity': fadeIn(2.5, 3.5),
      },
    },
    {
      id: 'detail-rail',
      type: 'line',
      source: 'detail',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['==', ['get', 'class'], 'rail'],
      paint: { 'line-color': t('--border-default'), 'line-width': 0.8, 'line-dasharray': [2, 2] },
    },
    {
      id: 'detail-roads-minor',
      type: 'line',
      source: 'detail',
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor', 'service']]],
      paint: {
        'line-color': t('--border-subtle'),
        'line-width': widths(9, 0.3, 14, 1.5, 18, 6),
        'line-opacity': fadeIn(9),
      },
    },
    {
      id: 'detail-roads-major',
      type: 'line',
      source: 'detail',
      'source-layer': 'transportation',
      minzoom: 4.5,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway',
          '#3a4049',
          'trunk',
          '#353b43',
          t('--border-default'),
        ],
        'line-width': widths(4.5, 0.3, 10, 1.4, 16, 6),
        'line-opacity': fadeIn(4.5, 5.5),
      },
    },
    {
      id: 'detail-buildings',
      type: 'fill',
      source: 'detail',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': t('--bg-raised'), 'fill-opacity': fadeIn(14) },
    },
  ];
}

/** Drawn above borders, below the data marks. */
export function detailLabels(t: Tokens): LayerSpecification[] {
  const paint = {
    'text-color': t('--text-tertiary'),
    'text-halo-color': t('--bg-base'),
    'text-halo-width': 1,
  };
  return [
    {
      id: 'detail-water-names',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'water_name',
      minzoom: 2,
      layout: {
        'text-field': name,
        'text-font': FONT_ITALIC,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 13],
        'text-letter-spacing': 0.1,
        'text-max-width': 6,
      },
      paint: { ...paint, 'text-color': '#4a525c' },
    },
    {
      id: 'detail-state-names',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'place',
      minzoom: 3.5,
      maxzoom: 8,
      filter: ['==', ['get', 'class'], 'state'],
      layout: {
        'text-field': name,
        'text-font': FONT,
        'text-size': 10,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 8,
      },
      paint: { ...paint, 'text-color': '#5a626c' },
    },
    {
      // Biggest cities first; smaller places appear as you zoom in.
      id: 'detail-places',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'place',
      minzoom: 3,
      filter: [
        'any',
        [
          'all',
          ['==', ['get', 'class'], 'city'],
          ['<=', ['get', 'rank'], ['step', ['zoom'], 3, 5, 8, 7, 99]],
        ],
        ['all', ['==', ['get', 'class'], 'town'], ['>=', ['zoom'], 7]],
        ['all', ['==', ['get', 'class'], 'village'], ['>=', ['zoom'], 10]],
        ['all', ['==', ['get', 'class'], 'suburb'], ['>=', ['zoom'], 11]],
      ],
      layout: {
        'text-field': name,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 10, 13],
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { ...paint, 'text-color': t('--text-secondary') },
    },
    {
      id: 'detail-road-names',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': name,
        'text-font': FONT,
        'text-size': 10,
      },
      paint,
    },
  ];
}
