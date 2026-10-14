import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geoArea, geoCentroid, geoEquirectangular } from 'd3-geo';
import { geoProject } from 'd3-geo-projection';

// world-atlas shapes are spherical: a polygon that crosses the 180 degree
// meridian (Russia, Fiji, Antarctica) is one ring that wraps around. Drawn on
// a flat map that ring smears across the whole width. Projecting through an
// equirectangular projection scaled to degrees makes d3 cut every shape at the
// antimeridian; flipping y back gives plain lon/lat that MapLibre draws cleanly
// in both Mercator and globe.

const toDegrees = geoEquirectangular()
  .scale(180 / Math.PI)
  .translate([0, 0])
  .precision(0);
const flipY = (geometry) => {
  const walk = (c) => (typeof c[0] === 'number' ? [c[0], -c[1]] : c.map(walk));
  return geometry && { ...geometry, coordinates: walk(geometry.coordinates) };
};
// d3 reads polygon rings clockwise (its spherical convention); GeoJSON files
// wind them counter-clockwise. Without reversing, d3 would read each country
// as "the whole globe except this country".
const rewind = (geometry) => {
  const walk = (c) => (typeof c[0][0] === 'number' ? [...c].reverse() : c.map(walk));
  return { ...geometry, coordinates: walk(geometry.coordinates) };
};
const cut = (collection) => {
  const projected = geoProject(
    {
      ...collection,
      features: collection.features.map((f) => ({
        ...f,
        properties: f.properties ?? {},
        geometry: rewind(f.geometry),
      })),
    },
    toDegrees,
  );
  return {
    ...projected,
    features: projected.features
      .filter((f) => f.geometry)
      .map((f) => ({ ...f, geometry: flipY(f.geometry) })),
  };
};
// Basemap source: Natural Earth 1:10m admin-0 countries, India point of view
// (all of Jammu and Kashmir, Ladakh and Aksai Chin within India). Natural
// Earth publishes this worldview only at 1:10m, so it is simplified here to
// roughly 1:50m detail, which matches city-level data.
const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries_ind.geojson';
const work = await mkdtemp(join(tmpdir(), 'basemap-'));
const source = join(work, 'source.geojson');
const response = await fetch(NE_URL);
if (!response.ok) throw new Error(`Natural Earth download failed: ${response.status}`);
await writeFile(source, Buffer.from(await response.arrayBuffer()));

const shaper = (args) =>
  // Fetched on demand: only this script needs it, and keeping it out of
  // package.json keeps its native dependencies out of every install.
  execFileSync('npx', ['--yes', 'mapshaper@0.6.121', ...args], { stdio: 'inherit' });
const simplified = join(work, 'countries.geojson');
const dissolved = join(work, 'land.geojson');
shaper([
  '-i',
  source,
  '-simplify',
  '6%',
  'keep-shapes',
  '-filter-fields',
  'NAME,ISO_A2_EH',
  '-rename-fields',
  'name=NAME,iso_a2=ISO_A2_EH',
  '-o',
  'format=geojson',
  'precision=0.001',
  simplified,
]);
shaper([
  '-i',
  simplified,
  '-dissolve',
  '-o',
  'format=geojson',
  'geojson-type=FeatureCollection',
  'precision=0.001',
  dissolved,
]);

const countries = JSON.parse(await readFile(simplified, 'utf8'));
// A few disputed or partly recognised areas have no ISO code (-99). They stay
// on the map but cannot be matched to an event's country.
for (const country of countries.features) {
  if (country.properties.iso_a2 === '-99') country.properties.iso_a2 = null;
}
const land = JSON.parse(await readFile(dissolved, 'utf8'));
for (const [name, collection] of [
  ['countries', countries],
  ['land', land],
]) {
  await writeFile(
    new URL(`../public/geo/${name}.geojson`, import.meta.url),
    JSON.stringify(cut(collection)),
  );
}
await rm(work, { recursive: true });

// Label points: one per country, at the centroid of its largest polygon so
// labels for countries with far-flung islands (France, USA) land on the
// mainland. `area` lets the map show big countries first when zoomed out.
const largestPart = (geometry) =>
  geometry.type === 'Polygon'
    ? geometry
    : {
        type: 'Polygon',
        coordinates: geometry.coordinates.reduce((best, polygon) =>
          geoArea({ type: 'Polygon', coordinates: polygon }) >
          geoArea({ type: 'Polygon', coordinates: best })
            ? polygon
            : best,
        ),
      };
const labels = {
  type: 'FeatureCollection',
  features: countries.features
    .filter((f) => f.geometry && f.properties.name)
    // Same winding rule as cut(): d3 needs clockwise rings for area and centroid.
    .map((f) => ({ ...f, geometry: rewind(f.geometry) }))
    .map((f) => ({
      type: 'Feature',
      properties: {
        iso_a2: f.properties.iso_a2,
        name: f.properties.name,
        area: Math.round(geoArea(f) * 1e4),
      },
      geometry: { type: 'Point', coordinates: geoCentroid(largestPart(f.geometry)) },
    })),
};
await writeFile(
  new URL('../public/geo/country-labels.geojson', import.meta.url),
  JSON.stringify(labels),
);
