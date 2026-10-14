import type { Observation } from '../data/events';
export function countryOnly(event: Observation) {
  return (
    event.data_class !== 'KEV' &&
    ['dbip_country', 'feed_country', 'Country centroid'].includes(event.geo_method)
  );
}
export function locationLabel(event: Observation) {
  if (event.data_class === 'KEV' || ['none', 'Not applicable'].includes(event.geo_method))
    return null;
  if (countryOnly(event)) return 'approx · country';
  return ['approx · city', event.attrs?.city].filter(Boolean).join(' · ');
}
export function countryCodes(events: Observation[]) {
  return [
    ...new Set(
      events
        .filter(countryOnly)
        .map((e) => e.country_code?.toUpperCase())
        .filter((c): c is string => !!c),
    ),
  ];
}
export function rawRecordUrl(event: Observation): string | null {
  const raw = event.raw;
  if (!raw) return null;
  const id = raw.source_record_id;
  if (id && /^\d+$/.test(id)) {
    if (raw.source === 'ThreatFox') return `https://threatfox.abuse.ch/ioc/${id}/`;
    if (raw.source === 'URLhaus') return `https://urlhaus.abuse.ch/url/${id}/`;
  }
  const ip = raw.src_ip;
  if (ip && /^[\da-fA-F.:]+$/.test(ip)) {
    if (raw.source === 'Feodo Tracker') return `https://feodotracker.abuse.ch/browse/host/${ip}/`;
    if (raw.source === 'DShield') return `https://isc.sans.edu/ipinfo/${ip}`;
  }
  const cve = String(raw.attrs?.cve ?? '');
  if (raw.data_class === 'vulnerability' && /^CVE-\d{4}-\d{4,}$/i.test(cve))
    return `https://nvd.nist.gov/vuln/detail/${cve}`;
  return null;
}
