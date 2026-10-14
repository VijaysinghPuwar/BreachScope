import type { DataClass, Observation, Severity } from './events';
export const classCodes = {
  simulated: 'SIM',
  telemetry: 'TEL',
  aggregate_telemetry: 'AGG',
  indicator: 'IOC',
  vulnerability: 'KEV',
  breach_report: 'BRCH',
} as const satisfies Record<string, DataClass>;
export interface LiveEvent {
  seq: number;
  event_uid: string;
  source: string;
  data_class: keyof typeof classCodes;
  licence: string;
  source_record_id?: string;
  category: string;
  category_label: string;
  severity: Severity;
  confidence?: number;
  confidence_basis: string;
  observed_at?: string;
  reported_at?: string;
  ingested_at: string;
  valid_until?: string;
  src_ip?: string;
  src_asn?: number;
  src_country?: string;
  src_lat?: number;
  src_lon?: number;
  geo_method: 'dbip_city_lite' | 'dbip_country' | 'feed_country' | 'country_centroid' | 'none';
  dst_country?: string;
  dst_lat?: number;
  dst_lon?: number;
  geo_accuracy_km?: number;
  attrs?: Record<string, string | number | boolean>;
}
export interface LiveSource {
  name: string;
  data_class: LiveEvent['data_class'];
  licence: string;
  url: string;
  last_success?: string;
  last_error: string;
  records: number;
  min_interval_seconds: number;
}
export interface LiveResponse {
  generated_at: string;
  sources: LiveSource[];
  events: LiveEvent[];
}
const countries = new Intl.DisplayNames(['en'], { type: 'region' });
export function toObservation(raw: LiveEvent): Observation {
  const country = raw.src_country?.toUpperCase();
  return {
    raw,
    attrs: raw.attrs,
    seq: raw.seq,
    event_uid: raw.event_uid,
    source: raw.source,
    data_class: classCodes[raw.data_class],
    severity: raw.severity,
    category: raw.category_label || raw.category,
    src: raw.src_ip ?? String(raw.attrs?.cve ?? raw.attrs?.url ?? raw.attrs?.organisation ?? ''),
    asn: raw.src_asn === undefined ? null : `AS${raw.src_asn}`,
    country: country ? String(raw.attrs?.country_name ?? countries.of(country)) : null,
    country_code: country ?? null,
    coordinates:
      raw.data_class !== 'vulnerability' &&
      raw.data_class !== 'breach_report' &&
      raw.geo_method === 'dbip_city_lite' &&
      Number.isFinite(raw.src_lat) &&
      Number.isFinite(raw.src_lon)
        ? [raw.src_lon!, raw.src_lat!]
        : null,
    pair:
      raw.geo_method === 'country_centroid' &&
      [raw.src_lat, raw.src_lon, raw.dst_lat, raw.dst_lon].every(Number.isFinite)
        ? {
            from: [raw.src_lon!, raw.src_lat!],
            to: [raw.dst_lon!, raw.dst_lat!],
            share: Number(raw.attrs?.share_percent ?? 0),
          }
        : null,
    geo_method: raw.geo_method,
    geo_accuracy_km: raw.geo_accuracy_km ?? null,
    dst: null,
    observed_at: raw.observed_at ?? null,
    reported_at: raw.reported_at ?? null,
    ingested_at: raw.ingested_at,
    valid_until: raw.valid_until,
    confidence: raw.confidence ?? null,
    confidence_basis: raw.confidence_basis,
    time_label: '',
  };
}
