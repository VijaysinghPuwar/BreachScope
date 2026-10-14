import { countryOnly, locationLabel } from './location';
import type { Feature, FeatureCollection, LineString, MultiLineString, Polygon } from 'geojson';
import { sensor, type Observation, type Position } from '../data/events';
const rad = Math.PI / 180;
export const earthRadiusKm = 6371.0088;
const wrap = (value: number) => ((value + 540) % 360) - 180;

export function circlePolygon(center: Position, radiusKm: number, steps = 96): Polygon {
  const [lon, lat] = center.map((value) => value * rad) as Position;
  const distance = radiusKm / earthRadiusKm;
  const coordinates: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    const latitude = Math.asin(
      Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing),
    );
    const longitude =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
        Math.cos(distance) - Math.sin(lat) * Math.sin(latitude),
      );
    coordinates.push([wrap(longitude / rad), latitude / rad]);
  }
  coordinates.push([...coordinates[0]!]);
  return { type: 'Polygon', coordinates: [coordinates] };
}

export function greatCircle(start: Position, end: Position, steps = 96): MultiLineString {
  const unit = ([lon, lat]: Position) => [
    Math.cos(lat * rad) * Math.cos(lon * rad),
    Math.cos(lat * rad) * Math.sin(lon * rad),
    Math.sin(lat * rad),
  ];
  const a = unit(start),
    b = unit(end);
  const angle = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        a.reduce((sum, value, i) => sum + value * b[i]!, 0),
      ),
    ),
  );
  if (angle < 1e-8) return { type: 'MultiLineString', coordinates: [[start, end]] };
  const points: Position[] = [];
  // Choose an orthogonal tangent for antipodes, where the shortest path is not unique.
  const rawTangent = b.map((value, i) => value - a[i]! * Math.cos(angle));
  const length = Math.hypot(...rawTangent);
  const fallback = Math.abs(a[2]!) < 0.9 ? [-a[1]!, a[0]!, 0] : [0, -a[2]!, a[1]!];
  const tangent =
    length < 1e-8
      ? fallback.map((value) => value / Math.hypot(...fallback))
      : rawTangent.map((value) => value / length);
  for (let i = 0; i <= steps; i++) {
    const t = (angle * i) / steps;
    const [x, y, z] = a.map((value, j) => value * Math.cos(t) + tangent[j]! * Math.sin(t));
    points.push([Math.atan2(y!, x!) / rad, Math.atan2(z!, Math.hypot(x!, y!)) / rad]);
  }
  points[0] = start;
  points[steps] = end;
  return splitAntimeridian(points);
}

export function splitAntimeridian(points: Position[]): MultiLineString {
  const lines: Position[][] = [[]];
  for (const point of points) {
    const line = lines[lines.length - 1]!;
    const previous = line.at(-1);
    if (previous && Math.abs(point[0] - previous[0]) > 180) {
      const adjusted = point[0] + (point[0] < previous[0] ? 360 : -360);
      const boundary = previous[0] > 0 ? 180 : -180;
      const fraction = (boundary - previous[0]) / (adjusted - previous[0]);
      const latitude = previous[1] + fraction * (point[1] - previous[1]);
      line.push([boundary, latitude]);
      lines.push([[-boundary, latitude], point]);
    } else line.push(point);
  }
  return { type: 'MultiLineString', coordinates: lines };
}

export function mapFeatures(events: Observation[]): FeatureCollection {
  const features: Feature[] = [];
  for (const event of events) {
    // A country pair names two countries, not places, so it has no exact
    // ends to draw. It is listed in the feed and never put on the map.
    if (event.pair) continue;
    if (
      !event.coordinates ||
      countryOnly(event) ||
      ['KEV', 'BRCH'].includes(event.data_class) ||
      event.geo_method === 'none'
    )
      continue;
    const properties = {
      uid: event.event_uid,
      label: locationLabel(event),
      severity: event.severity,
      data_class: event.data_class,
      countryOnly: event.geo_method === 'Country centroid',
    };
    features.push({
      type: 'Feature',
      properties: { ...properties, kind: 'point' },
      geometry: { type: 'Point', coordinates: event.coordinates },
    });
    // A country centroid already shades the whole country; a ring the size of
    // the country would only add a huge circle.
    if (event.geo_accuracy_km && !properties.countryOnly) {
      const circle = circlePolygon(event.coordinates, event.geo_accuracy_km);
      features.push({
        type: 'Feature',
        properties: { ...properties, kind: 'accuracy' },
        geometry: splitAntimeridian(circle.coordinates[0] as Position[]),
      });
    }
    // Telemetry from our own sensor: both ends are known, so draw the arc.
    if (event.data_class === 'TEL' && event.dst === sensor.name) {
      features.push({
        type: 'Feature',
        properties: { ...properties, kind: 'arc' },
        geometry: greatCircle(event.coordinates, sensor.coordinates),
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
export function graticule(): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let latitude = -75; latitude <= 75; latitude += 15)
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 361 }, (_, i) => [i - 180, latitude]),
      },
    });
  for (let longitude = -180; longitude < 180; longitude += 15)
    features.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 171 }, (_, i) => [longitude, i - 85]),
      },
    });
  return { type: 'FeatureCollection', features };
}

/** Great-circle angle between two lon/lat points, in degrees. */
function angleBetween([lon1, lat1]: Position, [lon2, lat2]: Position) {
  const r = Math.PI / 180;
  const cos =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / r;
}

/**
 * Keeps only the parts of lines and points on the visible half of the globe.
 * MapLibre hides circles behind the globe but draws lines straight through,
 * so far-side stretches of long arcs would float past the edge.
 */
export function clipToHemisphere(
  collection: FeatureCollection,
  center: Position,
  limitDeg = 88,
): FeatureCollection {
  const visible = (p: Position) => angleBetween(p, center) <= limitDeg;
  const features: Feature[] = [];
  for (const feature of collection.features) {
    const g = feature.geometry;
    if (g.type === 'Point') {
      if (visible(g.coordinates as Position)) features.push(feature);
    } else if (g.type === 'MultiLineString' || g.type === 'LineString') {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      const kept: Position[][] = [];
      for (const line of lines) {
        let run: Position[] = [];
        for (const p of line as Position[]) {
          if (visible(p)) run.push(p);
          else if (run.length) {
            if (run.length > 1) kept.push(run);
            run = [];
          }
        }
        if (run.length > 1) kept.push(run);
      }
      if (kept.length)
        features.push({ ...feature, geometry: { type: 'MultiLineString', coordinates: kept } });
    } else {
      features.push(feature);
    }
  }
  return { type: 'FeatureCollection', features };
}
