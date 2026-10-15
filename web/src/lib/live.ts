import { eventTime, type Observation } from '../data/events';
import type { LiveSource } from '../data/live';
export const minute = 60_000;
export const day = 24 * 60 * minute;
export function mergeEvents(previous: Observation[], incoming: Observation[], initial = false) {
  const seen = new Set(previous.map((e) => e.event_uid));
  const events = [...new Map([...previous, ...incoming].map((e) => [e.event_uid, e])).values()]
    .sort((a, b) => Date.parse(eventTime(b)) - Date.parse(eventTime(a)))
    .slice(0, 3000);
  const newIds = new Set(
    initial ? [] : events.filter((e) => !seen.has(e.event_uid)).map((e) => e.event_uid),
  );
  return { events, newIds };
}
export function isStale(source: LiveSource, now: number) {
  const time = Date.parse(source.last_success ?? '');
  return (
    !Number.isFinite(time) || now - time > Math.max(day, 2 * source.min_interval_seconds * 1000)
  );
}
export function staleCopy(source: LiveSource, now: number) {
  if (!source.last_success) return `${source.name}: no successful update yet.`;
  return `${source.name}: last update ${Math.max(0, Math.floor((now - Date.parse(source.last_success)) / 3600000))} h ago (expected every ${source.min_interval_seconds / 60} min).`;
}
export function relativeTime(value: string | number, now: number) {
  const seconds = Math.max(
    0,
    Math.floor((now - (typeof value === 'number' ? value : Date.parse(value))) / 1000),
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function histogram(events: Observation[], now: number) {
  const start = now - day;
  const bins = Array.from({ length: 96 }, (_, i) => ({
    time: start + i * 15 * minute,
    counts: [0, 0, 0, 0, 0],
    kev: [] as Observation[],
  }));
  for (const event of events) {
    const time = Date.parse(event.reported_at ?? event.observed_at ?? '');
    if (!Number.isFinite(time) || time < start || time > now) continue;
    const bin = bins[Math.min(95, Math.floor((time - start) / (15 * minute)))]!;
    bin.counts[event.severity]!++;
    if (event.data_class === 'KEV') bin.kev.push(event);
  }
  return bins;
}
const count = (n: number) => n.toLocaleString('en-US');

export function metrics(events: Observation[], now: number) {
  const observations = events.filter((e) => e.source === 'DShield' && e.data_class === 'AGG');
  const recent = observations.filter((e) => {
    const time = Date.parse(e.reported_at ?? e.observed_at ?? '');
    return time >= now - 15 * minute && time <= now;
  });
  return [
    {
      label: 'Scanning IPs',
      value: count(recent.length || observations.length),
      window: recent.length ? 'last 15m' : 'today',
    },
    { label: 'Indicators', value: count(events.filter((e) => e.data_class === 'IOC').length) },
    {
      label: 'Countries',
      value: count(new Set(events.map((e) => e.country_code).filter(Boolean)).size),
    },
    { label: 'Breaches', value: count(events.filter((e) => e.data_class === 'BRCH').length) },
  ];
}
