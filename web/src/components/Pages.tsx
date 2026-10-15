import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { classNames, dataClasses, eventTime, utc, type Observation } from '../data/events';
import type { LiveSource } from '../data/live';
import { classCodes } from '../data/live';
import { isStale, relativeTime } from '../lib/live';
import { rawRecordUrl } from '../lib/location';
import { Banner, Chip, EmptyState, SegmentedControl, Skeleton } from './ui';

const classDescriptions: Record<(typeof dataClasses)[number], string> = {
  SIM: 'Synthetic data for demos and load tests. Off by default. When it is on, the top bar says Simulated data visible, and its arcs are dashed.',
  TEL: 'Seen on a sensor we run: sensor-eus1, a Cowrie honeypot. The only data drawn as an arc from a source to our sensor.',
  AGG: 'Aggregated observations from other networks: the top scanning IPs from SANS DShield, and country pairs from Cloudflare Radar. Radar pairs are listed in the feed only, because the source names countries, not exact places.',
  IOC: 'Reported as malicious by ThreatFox, URLhaus or Feodo Tracker. A point on the map, never an arc.',
  KEV: 'An entry in the CISA Known Exploited Vulnerabilities catalogue. Not geographic: a tick on the timeline and a row in Reports.',
  BRCH: 'A breach verified by Have I Been Pwned. Not geographic: a tick on the timeline and a row in Reports.',
};

const sources = [
  ['ThreatFox, URLhaus, Feodo Tracker', 'Indicators', 'CC0', 'abuse.ch', 'https://abuse.ch'],
  ['SANS ISC DShield', 'Scanning IPs', 'CC BY-NC-SA 4.0', 'isc.sans.edu', 'https://isc.sans.edu'],
  [
    'Cloudflare Radar',
    'Country pairs',
    'CC BY-NC 4.0',
    'radar.cloudflare.com',
    'https://radar.cloudflare.com',
  ],
  [
    'CISA KEV catalogue',
    'Exploited CVEs',
    'CC0',
    'cisa.gov',
    'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  ],
  [
    'Have I Been Pwned',
    'Breaches',
    'CC BY 4.0',
    'haveibeenpwned.com',
    'https://haveibeenpwned.com',
  ],
  ['DB-IP Lite', 'IP to city', 'CC BY 4.0', 'db-ip.com', 'https://db-ip.com'],
  ['Cowrie honeypot (sensor-eus1)', 'Honeypot', 'Own data', '', ''],
  [
    'Natural Earth',
    'Borders',
    'Public domain',
    'naturalearthdata.com',
    'https://www.naturalearthdata.com',
  ],
  [
    'OpenFreeMap, OpenStreetMap',
    'Street detail',
    'ODbL',
    'openfreemap.org',
    'https://openfreemap.org',
  ],
] as const;

/** The path a record takes from a public feed to the screen. */
const flow = [
  ['Public feeds', 'abuse.ch, SANS DShield, CISA KEV, Have I Been Pwned, Cloudflare Radar'],
  [
    'Go API on Vercel',
    'Fetches each feed no faster than its minimum interval, normalises records, places IPs with DB-IP, encodes and gzips one snapshot',
  ],
  ['CDN cache', 'Serves the same snapshot to every visitor, so traffic never multiplies upstream'],
  ['Your browser', 'Polls every 60 s, merges new records, and draws them with MapLibre GL'],
] as const;

function About() {
  return (
    <article className="prose">
      <h1>About BreachScope</h1>
      <p>
        BreachScope is a live map of cyber threats reported by public security feeds. It shows what
        each source reports, where the reported address is, and how sure we can be about both. Every
        mark, row and panel carries its data type, so you can always tell what you are looking at
        and where it came from.
      </p>
      <h2>How it works</h2>
      <ol className="flow" aria-label="How a record reaches the screen">
        {flow.map(([title, body], i) => (
          <li key={title}>
            <span className="flow-step mono">{i + 1}</span>
            <strong>{title}</strong>
            <span>{body}</span>
          </li>
        ))}
      </ol>
      <p>
        Nothing is stored between refreshes yet. The code, an architecture diagram and the test
        suites are on{' '}
        <a href="https://github.com/VijaysinghPuwar/BreachScope" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
      <h2>Data types</h2>
      <div className="about-classes">
        {dataClasses.map((code) => (
          <div key={code}>
            <Chip code={code} />
            <p>
              <strong>{classNames[code]}.</strong> {classDescriptions[code]}
            </p>
          </div>
        ))}
      </div>
      <h2>What an indicator is, and is not</h2>
      <p>
        An indicator is an IP address, URL or domain that a named source reported as malicious, with
        that source&apos;s confidence and a date it stops being valid.
      </p>
      <p>
        It is <strong>not</strong> an attack on anyone, and not a sign that the address was used
        against us. The panel says so: <strong>Indicator, not an observed attack.</strong> It does
        not tell you who is behind the address.
      </p>
      <h2>How location accuracy works</h2>
      <p>
        <strong>IP location identifies a network, not a person.</strong> It is looked up once, when
        a record arrives, and the method is stored with it.
      </p>
      <ul>
        <li>
          City-level lookups use DB-IP Lite, which does not publish an accuracy radius. The panel
          says so and labels the mark <code>approx · city</code>.
        </li>
        <li>
          When only the country is known, the whole country is shaded instead of a dot being placed
          at its centre. These marks are labelled <code>approx · country</code>.
        </li>
        <li>
          Arcs are drawn only when both ends are exact: an attacker&apos;s located address and our
          own honeypot. Cloudflare Radar names countries, not places, so its country pairs are
          listed in the feed and never drawn on the map.
        </li>
      </ul>
      <h2>Sources and licences</h2>
      <div className="source-table">
        <table>
          <caption className="sr-only">Sources and licences</caption>
          <thead>
            <tr>
              {['Source', 'Used for', 'Licence', 'Attribution'].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map(([source, use, licence, site, url]) => (
              <tr key={source}>
                <td>{source}</td>
                <td>{use}</td>
                <td>{licence}</td>
                <td>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {site}
                    </a>
                  ) : (
                    'Not applicable'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        BreachScope is a non-commercial portfolio project. Several of these licences allow only
        non-commercial use, and each source is credited on the map and here.
      </p>
    </article>
  );
}

function ConsoleLink({ event }: { event: Observation }) {
  return (
    <a href={`/?event=${encodeURIComponent(event.event_uid)}`} className="row-link">
      Open in console
      <ArrowRight aria-hidden="true" />
    </a>
  );
}

function SourceLink({ event, label }: { event: Observation; label: string }) {
  const url = rawRecordUrl(event);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="row-link">
      {label}
      <ExternalLink aria-hidden="true" />
    </a>
  ) : null;
}

function Reports({
  events,
  now,
  loading,
}: {
  events: Observation[];
  now: number;
  loading: boolean;
}) {
  const [tab, setTab] = useState<'Exploited CVEs' | 'Breaches'>('Exploited CVEs');
  const rows = useMemo(
    () =>
      events
        .filter((e) => e.data_class === (tab === 'Breaches' ? 'BRCH' : 'KEV'))
        .sort((a, b) => Date.parse(eventTime(b)) - Date.parse(eventTime(a))),
    [events, tab],
  );
  return (
    <div className="page-container page-wide">
      <h1>Reports</h1>
      <p className="page-lede text-secondary">
        Records with no location: vulnerabilities that CISA has confirmed are exploited in the wild,
        and data breaches verified by Have I Been Pwned. They are ticks on the console timeline and
        rows here.
      </p>
      <SegmentedControl<'Exploited CVEs' | 'Breaches'>
        label="Report type"
        value={tab}
        options={['Exploited CVEs', 'Breaches'] as const}
        onChange={setTab}
      />
      {loading ? (
        <Skeleton className="table-skeleton" />
      ) : rows.length === 0 ? (
        <EmptyState>No records of this type in the current snapshot.</EmptyState>
      ) : (
        <div className="source-table report-table">
          <table>
            <caption className="sr-only">{tab}</caption>
            <thead>
              {tab === 'Breaches' ? (
                <tr>
                  {['Organisation', 'Accounts', 'Breached', 'Added', 'Links'].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              ) : (
                <tr>
                  {['CVE', 'Vendor and product', 'Name', 'Added', 'Links'].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((event) =>
                tab === 'Breaches' ? (
                  <tr key={event.event_uid}>
                    <td>{String(event.attrs?.organisation ?? event.src)}</td>
                    <td className="mono">
                      {Number(event.attrs?.records ?? 0).toLocaleString('en-US')}
                    </td>
                    <td className="mono">{String(event.attrs?.breach_date ?? '')}</td>
                    <td className="mono">
                      {utc(eventTime(event)).slice(0, 10)}
                      <span className="text-tertiary">
                        {' '}
                        · {relativeTime(eventTime(event), now)}
                      </span>
                    </td>
                    <td className="row-links">
                      <ConsoleLink event={event} />
                      <SourceLink event={event} label="HIBP" />
                    </td>
                  </tr>
                ) : (
                  <tr key={event.event_uid}>
                    <td className="mono">{String(event.attrs?.cve ?? event.src)}</td>
                    <td>
                      {[event.attrs?.vendor, event.attrs?.product].filter(Boolean).join(' · ')}
                    </td>
                    <td>{String(event.attrs?.name ?? '')}</td>
                    <td className="mono">
                      {utc(eventTime(event)).slice(0, 10)}
                      <span className="text-tertiary">
                        {' '}
                        · {relativeTime(eventTime(event), now)}
                      </span>
                    </td>
                    <td className="row-links">
                      <ConsoleLink event={event} />
                      <SourceLink event={event} label="NVD" />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const typeLabel = (dataClass: LiveSource['data_class']) => classNames[classCodes[dataClass]];

function Status({
  sources,
  now,
  loading,
}: {
  sources: LiveSource[];
  now: number;
  loading: boolean;
}) {
  const healthy = sources.filter((s) => !s.last_error && !isStale(s, now)).length;
  const honeypot = sources.some((s) => s.data_class === 'telemetry');
  return (
    <div className="page-container page-wide">
      <h1>Status</h1>
      <p className="page-lede text-secondary">
        Each feed is fetched no faster than its minimum interval, and the result is cached for every
        visitor. A feed is stale when it has not updated for twice its interval, or a day.
      </p>
      {loading ? (
        <Skeleton className="table-skeleton" />
      ) : sources.length === 0 ? (
        <EmptyState>The API has not answered yet. The console retries on its own.</EmptyState>
      ) : (
        <>
          <p className="status-summary">
            <strong>
              {healthy} of {sources.length}
            </strong>{' '}
            feeds healthy
          </p>
          <div className="source-table">
            <table>
              <caption className="sr-only">Feed status</caption>
              <thead>
                <tr>
                  {['Feed', 'Data type', 'State', 'Records', 'Last update', 'Interval'].map(
                    (label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const state = source.last_error
                    ? 'Error'
                    : isStale(source, now)
                      ? 'Stale'
                      : 'Healthy';
                  return (
                    <tr key={source.name}>
                      <td>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.name}
                        </a>
                      </td>
                      <td>{typeLabel(source.data_class)}</td>
                      <td>
                        <span className="state" data-state={state.toLowerCase()}>
                          {state}
                        </span>
                        {source.last_error && (
                          <span className="caption text-tertiary state-error">
                            {source.last_error}
                          </span>
                        )}
                      </td>
                      <td className="mono">{source.records.toLocaleString('en-US')}</td>
                      <td className="mono">
                        {source.last_success ? relativeTime(source.last_success, now) : 'Never'}
                      </td>
                      <td className="mono">{Math.round(source.min_interval_seconds / 60)} min</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!honeypot && (
            <Banner>
              The honeypot sensor is not deployed yet, so there are no telemetry arcs. Every other
              feed is unaffected.
            </Banner>
          )}
        </>
      )}
    </div>
  );
}

export function Pages({
  path,
  events,
  sources,
  now,
  loading,
}: {
  path: string;
  events: Observation[];
  sources: LiveSource[];
  now: number;
  loading: boolean;
}) {
  if (path === '/about')
    return (
      <main id="main" className="page-main">
        <About />
      </main>
    );
  if (path === '/reports')
    return (
      <main id="main" className="page-main">
        <Reports events={events} now={now} loading={loading} />
      </main>
    );
  if (path === '/status')
    return (
      <main id="main" className="page-main">
        <Status sources={sources} now={now} loading={loading} />
      </main>
    );
  return (
    <main id="main" className="page-main not-found">
      <div>
        <p className="mono text-tertiary">404</p>
        <h1>This page does not exist.</h1>
        <a href="/" className="button button-secondary">
          Back to the console
        </a>
      </div>
    </main>
  );
}
