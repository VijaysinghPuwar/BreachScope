import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Feature, FeatureCollection, Position } from 'geojson';

/** One trip from source to target. Slow on purpose: this is an instrument. */
const TRIP_MS = 4200;
/** Length of the moving head, as a share of the arc. */
const HEAD = 0.12;

/**
 * Moves a short bright head along each arc, from source to target, so the
 * direction of every arc is visible. Each arc starts at its own offset, so
 * they do not pulse together. Nothing runs under reduced motion or while the
 * tab is hidden.
 */
export class ArcFlow {
  private arcs: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private frame = 0;

  constructor(
    private map: Map,
    private reducedMotion: () => boolean,
  ) {}

  /** Call with the arcs currently drawn (already clipped to the view). */
  update(arcs: FeatureCollection) {
    this.arcs = arcs;
    if (this.reducedMotion() || arcs.features.length === 0) {
      this.stop();
      return;
    }
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.reducedMotion()) return this.stop();
    if (document.visibilityState !== 'hidden') {
      const features: Feature[] = [];
      for (const arc of this.arcs.features) {
        const g = arc.geometry;
        if (g.type !== 'MultiLineString') continue;
        const points = g.coordinates.flat() as Position[];
        if (points.length < 2) continue;
        const offset = hash(String(arc.properties?.uid ?? '')) * TRIP_MS;
        const t = ((now + offset) % TRIP_MS) / TRIP_MS;
        const end = Math.max(1, Math.round(t * (points.length - 1)));
        const start = Math.max(0, end - Math.max(2, Math.round(HEAD * points.length)));
        const head = points.slice(start, end + 1);
        if (head.length < 2) continue;
        // The trail fades out behind the tip: split it into short pieces
        // with rising opacity, then put a bright dot on the tip itself.
        const pieces = Math.min(4, head.length - 1);
        for (let i = 0; i < pieces; i++) {
          const a = Math.floor((i * (head.length - 1)) / pieces);
          const b = Math.floor(((i + 1) * (head.length - 1)) / pieces);
          for (const part of splitAtAntimeridian(head.slice(a, b + 1)))
            features.push({
              type: 'Feature',
              properties: { ...arc.properties, fade: (i + 1) / pieces },
              geometry: { type: 'LineString', coordinates: part },
            });
        }
        features.push({
          type: 'Feature',
          properties: arc.properties,
          geometry: { type: 'Point', coordinates: head[head.length - 1]! },
        });
      }
      (this.map.getSource('arc-heads') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features,
      });
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    (this.map.getSource('arc-heads') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [],
    });
  }
}

/**
 * Arcs that cross the 180° line arrive in pieces. Joined back together, the
 * step from +180 to -180 would be drawn the long way round the Earth, as a
 * ring around the pole, so cut the trail wherever longitude jumps.
 */
export function splitAtAntimeridian(points: Position[]): Position[][] {
  const parts: Position[][] = [];
  let part: Position[] = [];
  for (const p of points) {
    const last = part[part.length - 1];
    if (last && Math.abs(p[0]! - last[0]!) > 180) {
      if (part.length > 1) parts.push(part);
      part = [];
    }
    part.push(p);
  }
  if (part.length > 1) parts.push(part);
  return parts;
}

/** Stable 0..1 value per arc id. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
