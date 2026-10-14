import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import interFont from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import { graticule } from '../lib/geometry';
import { sensor } from '../data/events';
import { useSample } from '../lib/api';
import type { Projection } from './types';
import { DETAIL_FROM, DETAIL_GLYPHS, DETAIL_URL, detailBase, detailLabels } from './detail';
const severityColor: ExpressionSpecification = [
  'match',
  ['get', 'severity'],
  0,
  '#7d8792',
  1,
  '#8ba58a',
  2,
  '#c2a56a',
  3,
  '#c3825c',
  '#c96b6b',
];
const empty = { type: 'FeatureCollection' as const, features: [] };
export function mapStyle(projection: Projection): StyleSpecification {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const labelPaint = {
    'text-color': token('--text-tertiary'),
    'text-halo-color': token('--bg-base'),
    'text-halo-width': 1,
  };
  return {
    version: 8,
    projection: { type: projection === 'Flat' ? 'mercator' : 'globe' },
    'font-faces': { Inter: [{ url: interFont }] },
    glyphs: DETAIL_GLYPHS,
    sources: {
      detail: {
        type: 'vector',
        url: DETAIL_URL,
        attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
      },
      countries: { type: 'geojson', data: '/geo/countries.geojson' },
      land: { type: 'geojson', data: '/geo/land.geojson' },
      'country-labels': { type: 'geojson', data: '/geo/country-labels.geojson' },
      graticule: { type: 'geojson', data: graticule() },
      observations: { type: 'geojson', data: empty },
      selection: { type: 'geojson', data: empty },
      arrivals: { type: 'geojson', data: empty },
      sensor: {
        type: 'geojson',
        data: useSample
          ? {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: sensor.coordinates },
            }
          : empty,
      },
    },
    layers: [
      {
        // Zoomed out the background is ocean and Natural Earth draws the land.
        // Zoomed in it turns to land and OpenStreetMap water is drawn on top,
        // because OSM coastlines are far more precise.
        id: 'ocean',
        type: 'background',
        paint: {
          'background-color': [
            'interpolate',
            ['linear'],
            ['zoom'],
            DETAIL_FROM,
            token('--bg-base'),
            DETAIL_FROM + 1,
            token('--map-land'),
          ],
        },
      },
      {
        id: 'graticule',
        type: 'line',
        source: 'graticule',
        paint: { 'line-color': token('--border-subtle'), 'line-width': 0.5 },
      },
      {
        id: 'land',
        type: 'fill',
        source: 'land',
        maxzoom: DETAIL_FROM + 1,
        paint: { 'fill-color': token('--map-land') },
      },
      ...detailBase(token),
      {
        id: 'country-shading',
        type: 'fill',
        source: 'countries',
        filter: ['==', 'iso_a2', ''],
        paint: { 'fill-color': token('--hex-2'), 'fill-outline-color': token('--border-strong') },
      },
      {
        id: 'borders',
        type: 'line',
        source: 'countries',
        // Simplified to about 1:50m, these lines would sit visibly off the
        // streets at street level, so they fade out there.
        maxzoom: 10,
        paint: {
          'line-color': token('--border-strong'),
          'line-width': 0.6,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 1, 10, 0],
        },
      },
      ...detailLabels(token),
      {
        id: 'country-names',
        type: 'symbol',
        source: 'country-labels',
        maxzoom: 7,
        filter: ['any', ['>=', ['zoom'], 1.5], ['>=', ['get', 'area'], 50]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Inter'],
          'text-size': 11,
          'symbol-sort-key': ['*', -1, ['get', 'area']],
        },
        paint: labelPaint,
      },
      {
        id: 'country-approximation',
        type: 'symbol',
        source: 'country-labels',
        filter: ['==', 'iso_a2', ''],
        layout: {
          'text-field': 'approx · country',
          'text-font': ['Inter'],
          'text-size': 11,
          'text-offset': [0, 1.5],
        },
        paint: labelPaint,
      },
      {
        id: 'arcs',
        type: 'line',
        source: 'observations',
        filter: ['==', 'kind', 'arc'],
        paint: {
          'line-color': severityColor,
          'line-opacity': 0.8,
          // Country-pair arcs are thicker with a larger share of the traffic.
          'line-width': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'share'], 0],
            0,
            1.25,
            15,
            4,
          ],
        },
      },
      {
        id: 'accuracy',
        type: 'line',
        source: 'observations',
        filter: ['==', 'kind', 'accuracy'],
        paint: {
          'line-color': token('--text-tertiary'),
          'line-width': 1,
          'line-dasharray': [3, 3],
        },
      },
      {
        // A ripple spreading over the surface from where a new event was
        // reported, fading as it travels.
        id: 'arrival-ripple',
        type: 'line',
        source: 'arrivals',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: {
          'line-color': severityColor,
          'line-width': ['interpolate', ['linear'], ['get', 'progress'], 0, 3, 1, 1],
          'line-opacity': ['interpolate', ['linear'], ['get', 'progress'], 0, 1, 0.6, 0.6, 1, 0],
        },
      },
      {
        // The point itself flashes once as the ripple starts.
        id: 'arrival-flash',
        type: 'circle',
        source: 'arrivals',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'progress'], 0, 3, 0.3, 9, 1, 4],
          'circle-color': severityColor,
          'circle-opacity': ['interpolate', ['linear'], ['get', 'progress'], 0, 0.9, 1, 0],
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'points',
        type: 'circle',
        source: 'observations',
        filter: ['==', 'kind', 'point'],
        paint: {
          'circle-color': severityColor,
          'circle-radius': 4,
          'circle-stroke-color': token('--bg-base'),
          'circle-stroke-width': 1,
        },
      },
      {
        id: 'location-labels',
        type: 'symbol',
        source: 'observations',
        filter: ['==', 'kind', 'point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Inter'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1],
        },
        paint: labelPaint,
      },
      {
        id: 'selected',
        type: 'circle',
        source: 'selection',
        paint: {
          'circle-radius': 9,
          'circle-opacity': 0,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': token('--accent'),
        },
      },
      {
        id: 'sensor',
        type: 'circle',
        source: 'sensor',
        paint: {
          'circle-radius': 5,
          'circle-color': token('--bg-base'),
          'circle-stroke-width': 1.5,
          'circle-stroke-color': token('--text-primary'),
        },
      },
      {
        // The sensor sits at its region's published centre, and says so.
        id: 'sensor-label',
        type: 'symbol',
        source: 'sensor',
        layout: {
          'text-field': 'sensor-eus1\nconfigured · Azure East US',
          'text-font': ['Inter'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
        },
        paint: labelPaint,
      },
    ],
  };
}
