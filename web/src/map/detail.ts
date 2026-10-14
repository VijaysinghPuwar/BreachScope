import type { LayerSpecification } from 'maplibre-gl';

// Street-level detail from OpenFreeMap: free OpenStreetMap vector tiles with no
// key and no usage limit (https://openfreemap.org). It fades in from zoom 5.
// Below that the Natural Earth basemap is used. OSM boundary lines are never
// drawn: country borders always come from the Natural Earth India point-of-view
// file, so one consistent boundary set is shown at every zoom.
export const DETAIL_URL = 'https://tiles.openfreemap.org/planet';
export const DETAIL_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const DETAIL_FROM = 5;
const FONT = ['Noto Sans Regular'];

type Tokens = (name: string) => string;
const fadeIn = (
  from: number,
): ['interpolate', ['linear'], ['zoom'], number, number, number, number] => [
  'interpolate',
  ['linear'],
  ['zoom'],
  from,
  0,
  from + 1,
  1,
];

/** Drawn under the data: water, then roads, then buildings. */
export function detailBase(t: Tokens): LayerSpecification[] {
  return [
    {
      id: 'detail-water',
      type: 'fill',
      source: 'detail',
      'source-layer': 'water',
      minzoom: DETAIL_FROM,
      paint: { 'fill-color': t('--bg-base'), 'fill-opacity': fadeIn(DETAIL_FROM) },
    },
    {
      id: 'detail-waterway',
      type: 'line',
      source: 'detail',
      'source-layer': 'waterway',
      minzoom: 8,
      paint: { 'line-color': t('--bg-base'), 'line-width': 1 },
    },
    {
      id: 'detail-roads-major',
      type: 'line',
      source: 'detail',
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: {
        'line-color': t('--border-default'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.5, 16, 4],
      },
    },
    {
      id: 'detail-roads-minor',
      type: 'line',
      source: 'detail',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor', 'service']]],
      paint: {
        'line-color': t('--border-subtle'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 16, 2],
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
      id: 'detail-places',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'place',
      minzoom: DETAIL_FROM,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 13],
        'symbol-sort-key': ['get', 'rank'],
      },
      paint,
    },
    {
      id: 'detail-road-names',
      type: 'symbol',
      source: 'detail',
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONT,
        'text-size': 10,
      },
      paint,
    },
  ];
}
