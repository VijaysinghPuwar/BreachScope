import { useState } from 'react';
import { classNames, dataClasses } from '../data/events';
import { Banner, Button, Chip, EmptyState } from './ui';
const classDescriptions = [
  'Synthetic data for demos and load tests. Off by default. When it is on, the top bar says Simulated data visible, and its arcs are dashed.',
  'Seen on a sensor we run: sensor-eus1, a Cowrie honeypot. The only data drawn as an arc from a source to our sensor.',
  'A third party’s aggregated observations, from Cloudflare Radar. Drawn as country-to-country arcs because the source provides the pair, thicker with volume.',
  'Reported as malicious by ThreatFox, URLhaus or Spamhaus DROP. A point or a hex on the map, never an arc.',
  'An entry in the CISA KEV catalogue. Not geographic: a tick on the timeline and a row in Reports.',
  'A confirmed public disclosure. Not geographic: a tick on the timeline and a row in Reports.',
];
const sources = [
  ['Cowrie honeypot (sensor-eus1)', 'TEL', 'Own data', '', ''],
  [
    'Cloudflare Radar',
    'AGG',
    'CC BY-NC 4.0',
    'radar.cloudflare.com',
    'https://radar.cloudflare.com',
  ],
  [
    'abuse.ch ThreatFox, URLhaus',
    'IOC',
    'abuse.ch terms, non-commercial',
    'abuse.ch',
    'https://abuse.ch',
  ],
  ['Spamhaus DROP', 'IOC', 'Attribution required', 'spamhaus.org', 'https://www.spamhaus.org'],
  [
    'CISA KEV catalogue',
    'KEV',
    'CC0',
    'cisa.gov',
    'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  ],
  [
    'HIBP breach catalogue',
    'BRCH',
    'CC BY 4.0',
    'haveibeenpwned.com',
    'https://haveibeenpwned.com',
  ],
  ['MaxMind GeoLite2', 'Location', 'GeoLite2 EULA', 'maxmind.com', 'https://www.maxmind.com'],
  ['IPinfo Lite', 'ASN, country', 'CC BY-SA 4.0', 'ipinfo.io', 'https://ipinfo.io'],
  [
    'Natural Earth',
    'Basemap',
    'Public domain',
    'naturalearthdata.com',
    'https://www.naturalearthdata.com',
  ],
];
function About() {
  return (
    <article className="prose">
      <h1>About the data</h1>
      <p>
        BreachScope shows six kinds of data. Every mark, row and panel carries its class badge, so
        you can always tell what you are looking at and where it came from.
      </p>
      <h2>Data classes</h2>
      <div className="about-classes">
        {dataClasses.map((code, i) => (
          <div key={code}>
            <Chip code={code} />
            <p>
              <strong>{classNames[code]}.</strong> {classDescriptions[i]}
            </p>
          </div>
        ))}
      </div>
      <h2>What an indicator is, and is not</h2>
      <p>
        An indicator is an IP address, URL, netblock or file hash that a named source reported as
        malicious, with that source&apos;s confidence and a date it stops being valid.
      </p>
      <p>
        It is <strong>not</strong> an attack on anyone, and not a sign that the address was used
        against us. The panel says so: <strong>Indicator, not an observed attack.</strong> It does
        not tell you who is behind the address.
      </p>
      <p>
        A login attempt on our honeypot is an observation, not a breach. Breaches are only the
        confirmed public disclosures in Reports.
      </p>
      <h2>How location accuracy works</h2>
      <p>
        <strong>IP location identifies a network, not a person.</strong> It is looked up once, when
        a record arrives, and the method and accuracy are stored with it.
      </p>
      <ul>
        <li>
          City-level lookups (GeoLite2 City) come with an accuracy radius. The map draws it as a
          dashed ring at its true size in km, labelled <code>approx ± 50 km</code>.
        </li>
        <li>
          When only the country is known, the mark is a square at the country&apos;s centre,
          labelled <code>approx · country</code>.
        </li>
        <li>
          Our sensor is placed at the published centre of its cloud region, labelled{' '}
          <code>configured · Azure East US</code>. It is never a street address.
        </li>
        <li>
          Arcs are drawn only when the source provides both ends: our own honeypot, and Cloudflare
          Radar&apos;s country pairs.
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
export function Pages({ path }: { path: string }) {
  const [reports, setReports] = useState('Exploited vulnerabilities (KEV)');
  if (path === '/about')
    return (
      <main className="page-main">
        <About />
      </main>
    );
  if (path === '/signin')
    return (
      <main className="page-main signin-page">
        <div className="signin-card">
          <a href="/" className="wordmark">
            BreachScope
          </a>
          <h1>Sign in</h1>
          <Button variant="primary">Sign in</Button>
          <p className="text-secondary">
            Signing in lets you save and share investigations. Viewing is public.
          </p>
          <a href="/?sim=1">View public demo (simulated data)</a>
        </div>
      </main>
    );
  if (path === '/investigations')
    return (
      <main className="page-main">
        <div className="page-container">
          <h1>Investigations</h1>
          <EmptyState
            action={
              <a href="/" className="button button-secondary">
                Open in console
              </a>
            }
          >
            No investigations yet. Select events on the map and choose Add to investigation.
          </EmptyState>
        </div>
      </main>
    );
  if (path === '/anomalies')
    return (
      <main className="page-main">
        <div className="page-container">
          <h1>Anomalies</h1>
          <EmptyState>No anomalies in the last 14 days.</EmptyState>
          <p className="text-secondary text-center">
            Anomalies fire when z ≥ 6 and at least 20 events.
          </p>
        </div>
      </main>
    );
  if (path === '/reports')
    return (
      <main className="page-main">
        <div className="page-container">
          <h1>Reports</h1>
          <div className="row-actions">
            {['Exploited vulnerabilities (KEV)', 'Breach reports'].map((value) => (
              <Button
                key={value}
                aria-pressed={value === reports}
                onClick={() => setReports(value)}
              >
                {value}
              </Button>
            ))}
          </div>
          <Banner>Not geographic. Shown on the timeline as ticks.</Banner>
          <EmptyState
            action={
              <a href="/" className="button button-secondary">
                Open in console
              </a>
            }
          >
            No events match these filters.
          </EmptyState>
        </div>
      </main>
    );
  if (path === '/status')
    return (
      <main className="page-main">
        <div className="page-container">
          <h1>Status</h1>
          <EmptyState
            action={
              <a href="/about" className="button button-secondary">
                View sources
              </a>
            }
          >
            Waiting for first events from 4 sources.
          </EmptyState>
        </div>
      </main>
    );
  return (
    <main className="page-main not-found">
      <div>
        <p className="mono text-tertiary">404</p>
        <h1>Investigation not found or not shared with you.</h1>
        <a href="/investigations" className="button button-secondary">
          Back to investigations
        </a>
      </div>
    </main>
  );
}
