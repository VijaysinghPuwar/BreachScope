import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { circlePolygon, splitAntimeridian } from '../lib/geometry';
import type { Observation } from '../data/events';

/** How long one arrival ripple takes to spread and fade. */
export const RING_MS = 2600;
/** How far a ripple spreads over the Earth's surface before it is gone. */
const RIPPLE_KM = 2500;
/** Cap on ripples drawn at once, so a burst of arrivals stays smooth. */
const MAX_ACTIVE = 8;
/** On first load the most recent located events replay this far apart. */
const REPLAY_GAP_MS = 450;
const REPLAY_COUNT = 24;
/** Under reduced motion a ring is shown still, then removed. */
const STILL_MS = 2500;
/** Between polls, one recent on-screen event ripples again this often. */
const AMBIENT_MS = 2200;
/** Events this recent are eligible for ambient ripples. */
const RECENT_MS = 60 * 60 * 1000;

interface Ring {
  uid: string;
  coordinates: [number, number];
  severity: number;
  start: number;
}

/**
 * Draws a one-off expanding ring where a newly reported event is located.
 * Rings are data, not decoration: each one is a real event that just arrived
 * (or, on first load, one of the newest events, replayed oldest first so the
 * map shows where recent activity came from).
 */
export class ArrivalRings {
  private rings: Ring[] = [];
  private seen = new Set<string>();
  private frame = 0;
  private first = true;
  private recent = new Set<string>();
  private ambientTimer = 0;

  constructor(
    private map: Map,
    private reducedMotion: () => boolean,
  ) {}

  /** Call with the full event list after every poll. */
  update(events: Observation[]) {
    const located = events.filter((e) => e.coordinates);
    const cutoff = Date.now() - RECENT_MS;
    const recent = located.filter((e) => time(e) >= cutoff);
    // If the last hour is quiet, fall back to the newest fifty.
    this.recent = new Set(
      (recent.length >= 10
        ? recent
        : [...located].sort((a, b) => time(b) - time(a)).slice(0, 50)
      ).map((e) => e.event_uid),
    );
    if (!this.ambientTimer) this.ambientTimer = window.setInterval(this.ambient, AMBIENT_MS);
    if (this.first) {
      this.first = false;
      located.forEach((e) => this.seen.add(e.event_uid));
      const newest = [...located].sort((a, b) => time(b) - time(a)).slice(0, REPLAY_COUNT);
      const now = performance.now();
      newest.reverse().forEach((e, i) => this.add(e, now + i * REPLAY_GAP_MS));
      return;
    }
    const now = performance.now();
    let i = 0;
    for (const e of located) {
      if (this.seen.has(e.event_uid)) continue;
      this.seen.add(e.event_uid);
      // Stagger a burst so a poll with forty new events reads as forty rings.
      this.add(e, now + i++ * REPLAY_GAP_MS);
    }
  }

  /**
   * Ripples one recent event that is currently drawn on screen, so the map
   * keeps showing where activity is between polls. Only real events are used;
   * nothing is invented.
   */
  private ambient = () => {
    if (this.reducedMotion() || document.visibilityState === 'hidden') return;
    if (this.rings.length > 2) return;
    const onScreen = this.map
      .queryRenderedFeatures({ layers: ['points'] })
      .map((f) => ({
        uid: String(f.properties.uid),
        severity: Number(f.properties.severity),
        geometry: f.geometry,
      }))
      .filter((f) => this.recent.has(f.uid) && f.geometry.type === 'Point');
    const pick = onScreen[Math.floor(Math.random() * onScreen.length)];
    if (!pick || pick.geometry.type !== 'Point') return;
    this.rings.push({
      uid: pick.uid,
      coordinates: pick.geometry.coordinates as [number, number],
      severity: pick.severity,
      start: performance.now(),
    });
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  private add(e: Observation, start: number) {
    this.rings.push({
      uid: e.event_uid,
      coordinates: e.coordinates!,
      severity: e.severity,
      start,
    });
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const still = this.reducedMotion();
    const life = still ? STILL_MS : RING_MS;
    this.rings = this.rings.filter((r) => now - r.start < life);
    const features: Feature[] = [];
    for (const r of this.rings.filter((r) => now >= r.start).slice(0, MAX_ACTIVE)) {
      // 0 to 1 across the ripple's life, eased out so it slows as it spreads.
      // Held at a fixed size under reduced motion.
      const t = still ? 0.25 : (now - r.start) / RING_MS;
      const progress = 1 - (1 - t) ** 3;
      const properties = { severity: r.severity, progress };
      // A circle drawn in kilometres on the sphere, so it curves with the
      // globe and keeps its true size in both projections.
      // A leading ring and a trailing one at 55% of its size.
      for (const scale of [1, 0.55]) {
        const ring = circlePolygon(r.coordinates, Math.max(1, progress * scale * RIPPLE_KM), 72);
        features.push({
          type: 'Feature',
          properties: { ...properties, progress: Math.min(1, progress + (1 - scale) * 0.3) },
          geometry: splitAntimeridian(ring.coordinates[0] as [number, number][]),
        });
      }
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: r.coordinates },
      });
    }
    const collection: FeatureCollection = { type: 'FeatureCollection', features };
    (this.map.getSource('arrivals') as GeoJSONSource | undefined)?.setData(collection);
    this.frame = this.rings.length ? requestAnimationFrame(this.tick) : 0;
  };

  destroy() {
    clearInterval(this.ambientTimer);
    this.ambientTimer = 0;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.rings = [];
  }
}

function time(e: Observation) {
  return Date.parse(e.reported_at ?? e.observed_at ?? e.ingested_at ?? '') || 0;
}
