import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from '../test/fixtures/live.json';
import { toObservation, type LiveResponse } from '../data/live';
import { countryCodes, locationLabel, rawRecordUrl } from './location';
import { day, histogram, isStale, mergeEvents, metrics } from './live';
import { circlePolygon, earthRadiusKm, mapFeatures } from './geometry';
import { matchesFilters } from './api';
const feed = fixture as LiveResponse;
const events = feed.events.map(toObservation);
const now = Date.parse(feed.generated_at);
describe('live data contract', () => {
  it('merges and updates by UID even when every sequence is zero; marks only new IDs', () => {
    const first = mergeEvents([], events.slice(0, 2), true);
    expect(first.newIds.size).toBe(0);
    const updated = { ...events[0]!, category: 'Updated category' };
    const next = mergeEvents(first.events, [updated, ...events.slice(2, 4), events[2]!]);
    expect(next.events).toHaveLength(4);
    expect(next.events.find((e) => e.event_uid === updated.event_uid)?.category).toBe(
      'Updated category',
    );
    expect([...next.newIds]).toEqual(events.slice(2, 4).map((e) => e.event_uid));
    expect(mergeEvents(next.events, next.events).newIds.size).toBe(0);
  });
  it('keeps the newest 3000 independently of server order and duplicate IDs', () => {
    const many = Array.from({ length: 3100 }, (_, i) => ({
      ...events[0]!,
      event_uid: `${i}`,
      reported_at: new Date(now - i * 1000).toISOString(),
    }));
    const result = mergeEvents([], many.reverse());
    expect(result.events).toHaveLength(3000);
    expect(result.events[0]!.event_uid).toBe('0');
    expect(result.events.at(-1)!.event_uid).toBe('2999');
  });
  it('draws India from the India point-of-view boundaries', () => {
    const countries = JSON.parse(readFileSync('public/geo/countries.geojson', 'utf8'));
    const india = countries.features.find(
      (f: { properties: { iso_a2: string } }) => f.properties.iso_a2 === 'IN',
    );
    const points: number[][] = india.geometry.coordinates.flat(
      india.geometry.type === 'Polygon' ? 1 : 2,
    );
    // All of Jammu and Kashmir, Ladakh and Aksai Chin reach about 37 N.
    expect(Math.max(...points.map((p) => p[1]!))).toBeGreaterThan(36.5);
  });
  it('matches country shading to ISO alpha-2 codes in the generated basemap', () => {
    const countries = JSON.parse(readFileSync('public/geo/countries.geojson', 'utf8'));
    const coded = countries.features.filter((f: { properties: { iso_a2: string | null } }) =>
      /^[A-Z]{2}$/.test(f.properties.iso_a2 ?? ''),
    );
    // A handful of disputed areas carry no ISO code; everything else must.
    expect(coded.length).toBeGreaterThan(countries.features.length - 10);
    const codes = countryCodes(events);
    expect(codes.sort()).toEqual(['CA', 'RU', 'US']);
    const matches = countries.features.filter((f: { properties: { iso_a2: string } }) =>
      codes.includes(f.properties.iso_a2),
    );
    expect(matches.map((f: { properties: { name: string } }) => f.properties.name).sort()).toEqual([
      'Canada',
      'Russia',
      'United States',
    ]);
  });
  it('applies city, country, unknown and vulnerability geo rules without live arcs', () => {
    const city = events.find((e) => e.attrs?.city && e.geo_accuracy_km === null)!;
    expect(locationLabel(city)).toBe(`approx · city · ${city.attrs!.city}`);
    expect(mapFeatures([city]).features.map((f) => f.properties?.kind)).toEqual(['point']);
    const country = events.find((e) => e.geo_method === 'feed_country')!;
    expect(locationLabel(country)).toBe('approx · country');
    expect(mapFeatures([country]).features).toHaveLength(0);
    const unknown = events.find((e) => e.geo_method === 'none')!;
    expect(locationLabel(unknown)).toBeNull();
    expect(mapFeatures([unknown]).features).toHaveLength(0);
    const kev = toObservation({
      ...feed.events.find((e) => e.data_class === 'vulnerability')!,
      geo_method: 'dbip_city_lite',
      src_lat: 0,
      src_lon: 0,
    });
    expect(locationLabel(kev)).toBeNull();
    expect(mapFeatures([kev]).features).toHaveLength(0);
    expect(mapFeatures(events).features.some((f) => f.properties?.kind === 'arc')).toBe(false);
  });
  it('never draws a country pair, which has no exact ends', () => {
    const pair = toObservation({
      seq: 0,
      event_uid: 'radar-us-de',
      source: 'Cloudflare Radar',
      data_class: 'aggregate_telemetry',
      licence: 'CC BY-NC 4.0',
      category: 'l7_attack_pair',
      category_label: 'L7 attacks (country pair)',
      severity: 3,
      confidence_basis: 'Cloudflare Radar',
      ingested_at: '2026-10-14T00:00:00Z',
      geo_method: 'country_centroid',
      src_country: 'US',
      dst_country: 'DE',
      src_lat: 39.887,
      src_lon: -98.807,
      dst_lat: 51.038,
      dst_lon: 10.351,
      attrs: { share_percent: 12.5 },
    } as Parameters<typeof toObservation>[0]);
    expect(pair.pair).not.toBeNull();
    expect(mapFeatures([pair]).features).toHaveLength(0);
  });
  it('uses the published radius in km, including coordinates at zero', () => {
    const point = circlePolygon([0, 0], 50).coordinates[0]![0]!;
    expect(((point[1]! * Math.PI) / 180) * earthRadiusKm).toBeCloseTo(50);
    const city = toObservation({
      ...feed.events[0]!,
      geo_method: 'dbip_city_lite',
      src_lat: 0,
      src_lon: 0,
      geo_accuracy_km: 50,
    });
    expect(mapFeatures([city]).features.map((f) => f.properties?.kind)).toEqual([
      'point',
      'accuracy',
    ]);
  });
  it('marks sources stale only beyond max(24 hours, twice the interval)', () => {
    const source = { ...feed.sources[0]!, last_success: new Date(now - day).toISOString() };
    expect(isStale(source, now)).toBe(false);
    expect(isStale(source, now + 1)).toBe(true);
    expect(isStale({ ...source, min_interval_seconds: 86400 }, now + day)).toBe(false);
    expect(isStale({ ...source, min_interval_seconds: 86400 }, now + day + 1)).toBe(true);
    expect(isStale({ ...source, last_success: undefined }, now)).toBe(true);
  });
  it('bins the last 24 hours by reported then observed, with severity stacks and KEV ticks', () => {
    const base = events[0]!;
    const at = (time: number) => ({
      ...base,
      severity: 3 as const,
      reported_at: new Date(time).toISOString(),
    });
    const bins = histogram(
      [
        at(now - day),
        at(now - day + 900000),
        at(now),
        at(now + 1),
        at(now - day - 1),
        {
          ...at(now - day),
          reported_at: null,
          observed_at: new Date(now).toISOString(),
          data_class: 'KEV',
        },
        { ...base, reported_at: null, observed_at: null },
      ],
      now,
    );
    expect(bins).toHaveLength(96);
    expect(bins[0]!.counts[3]).toBe(1);
    expect(bins[1]!.counts[3]).toBe(1);
    expect(bins[95]!.counts[3]).toBe(2);
    expect(bins[95]!.kev).toHaveLength(1);
    expect(bins.flatMap((b) => b.counts).reduce((a, b) => a + b)).toBe(4);
  });
  it('counts DShield observations and falls back to today without fabricated deltas', () => {
    expect(metrics(events, now).map((m) => m.value)).toEqual(['2', '12', '6', '0']);
    expect(metrics(events, now + day)[0]).toEqual({
      label: 'Observations',
      value: '3',
      window: 'today',
    });
  });
  it('searches IP, ASN, CVE, country and malware', () => {
    for (const search of ['192.0.2.4', 'AS64500', 'CVE-2026-10000', 'Brazil', 'BR', 'VShell'])
      expect(events.some((e) => matchesFilters(e, { search }))).toBe(true);
    expect(events.filter((e) => matchesFilters(e, { classes: ['KEV'] }))).toHaveLength(3);
  });
  it('builds links only from known public source routes, never feed URLs', () => {
    for (const source of ['ThreatFox', 'URLhaus', 'Feodo Tracker', 'DShield', 'CISA KEV'])
      expect(rawRecordUrl(events.find((e) => e.source === source)!)).toMatch(/^https:\/\//);
    expect(rawRecordUrl(events.find((e) => e.source === 'Spamhaus')!)).toBeNull();
    expect(
      rawRecordUrl(
        toObservation({
          ...feed.events[0]!,
          source: 'URLhaus',
          source_record_id: 'https://evil.example',
          attrs: { url: 'https://evil.example' },
        }),
      ),
    ).toBeNull();
  });
});
