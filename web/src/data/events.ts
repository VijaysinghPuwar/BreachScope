export const dataClasses = ['SIM', 'TEL', 'AGG', 'IOC', 'KEV', 'BRCH'] as const;
export type DataClass = (typeof dataClasses)[number];
export type Severity = 0 | 1 | 2 | 3 | 4;
export type Position = [number, number];
import type { LiveEvent } from './live';
export interface Observation {
  raw?: LiveEvent;
  attrs?: Record<string, string | number | boolean>;
  seq: number;
  event_uid: string;
  data_class: DataClass;
  severity: Severity;
  category: string;
  source: string;
  src: string;
  asn: string | null;
  country: string | null;
  country_code: string | null;
  coordinates: Position | null;
  geo_method:
    | LiveEvent['geo_method']
    | 'GeoLite2 City'
    | 'Country centroid'
    | 'Country pair'
    | 'Not applicable';
  geo_accuracy_km: number | null;
  dst: string | null;
  observed_at: string | null;
  reported_at: string | null;
  ingested_at: string;
  confidence: number | null;
  confidence_basis: string;
  time_label: string;
  host?: string;
  share?: string;
  valid_until?: string;
}
export const sensor = {
  name: 'sensor-eus1',
  coordinates: [-79.8164, 37.3719] as Position,
  label: 'configured · Azure East US',
};

export const classNames: Record<DataClass, string> = {
  SIM: 'Simulated',
  TEL: 'Telemetry',
  AGG: 'Aggregate telemetry',
  IOC: 'Indicator',
  KEV: 'Known exploited vulnerability',
  BRCH: 'Breach report',
};
export const severityLabels = ['Info', 'Low', 'Medium', 'High', 'Critical'] as const;
export const initialClasses = dataClasses.filter((value) => value !== 'SIM');
export function utc(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
}
export function eventTime(value: Observation): string {
  return value.reported_at ?? value.observed_at ?? value.ingested_at;
}
