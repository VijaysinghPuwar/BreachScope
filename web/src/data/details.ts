export interface Detail {
  ev: { sev: number; cls: string; seq: string; cat: string };
  summary: { k: string; v: string; vStyle: string; sub: string }[];
  prov: { source: string; className: string; licence: string; upstream: string; sha: string };
  times: { k: string; v: string }[];
  conf: { value: number; pct: string; basis: string };
  loc: { acc: string; map: string; alt: string; label: string };
  cls: { tech: string; techName: string; rule: string };
  related: { title: string; rows: { t: string; d: string }[] }[];
  enrich: { score: string };
  hasLocation: boolean;
  hasEnrichment: boolean;
}
export const details: Record<string, Detail> = {
  TEL: {
    ev: {
      sev: 3,
      cls: 'TEL',
      seq: '884213',
      cat: 'SSH brute force',
    },
    summary: [
      {
        k: 'src',
        v: '198.51.100.23',
        vStyle: 'mono',
        sub: 'AS64500 Example Hosting BV · Netherlands',
      },
      {
        k: 'dst',
        v: 'sensor-eus1',
        vStyle: 'mono',
        sub: 'configured · Azure East US',
      },
      {
        k: 'Attempts',
        v: '214 in 9m 12s',
        vStyle: 'body',
        sub: '',
      },
    ],
    prov: {
      source: 'Cowrie honeypot (sensor-eus1)',
      className: 'Telemetry',
      licence: 'Own data',
      upstream: 'cowrie:session:7c1e0b4a2f91',
      sha: '9f2c4e81…d07a3b56',
    },
    times: [
      {
        k: 'Observed',
        v: '2026-10-14 14:22:07 UTC',
      },
      {
        k: 'Reported',
        v: '2026-10-14 14:22:07 UTC',
      },
      {
        k: 'Ingested',
        v: '2026-10-14 14:22:09 UTC (+2s)',
      },
    ],
    conf: {
      value: 100,
      pct: '100%',
      basis: 'Direct observation on owned sensor',
    },
    loc: {
      acc: '± 50 km',
      map: 'maps/mini-nl.svg',
      alt: 'Netherlands, accuracy ring of 50 km around the located network',
      label: 'approx ± 50 km',
    },
    cls: {
      tech: 'T1110.001',
      techName: 'Password Guessing',
      rule: 'rule ssh_bruteforce_v1: ≥ 20 failed logins in 10 min',
    },
    related: [
      {
        title: 'Same IP (12)',
        rows: [
          {
            t: '14:13:40',
            d: 'SSH brute force · sensor-eus1',
          },
          {
            t: '13:58:02',
            d: 'SSH brute force · sensor-eus1',
          },
          {
            t: '13:41:19',
            d: 'SSH brute force · sensor-eus1',
          },
        ],
      },
      {
        title: 'Same /24 (31)',
        rows: [
          {
            t: '14:20:51',
            d: '198.51.100.41 · SSH brute force',
          },
          {
            t: '14:18:12',
            d: '198.51.100.9 · Telnet login attempts',
          },
          {
            t: '14:02:33',
            d: '198.51.100.41 · SSH brute force',
          },
        ],
      },
      {
        title: 'Same ASN (140)',
        rows: [
          {
            t: '14:21:58',
            d: '198.51.100.88 · SSH brute force',
          },
          {
            t: '14:21:30',
            d: '198.51.100.41 · SSH brute force',
          },
          {
            t: '14:20:51',
            d: '198.51.100.41 · SSH brute force',
          },
        ],
      },
      {
        title: 'Same IOC (0)',
        rows: [],
      },
      {
        title: '±10 min window (58)',
        rows: [
          {
            t: '14:22:15',
            d: '192.0.2.145 · Malware download attempt',
          },
          {
            t: '14:22:11',
            d: '203.0.113.77 · Telnet login attempts',
          },
          {
            t: '14:21:58',
            d: '198.51.100.88 · SSH brute force',
          },
        ],
      },
    ],
    enrich: {
      score: '100 of 100',
    },
    hasLocation: true,
    hasEnrichment: true,
  },
  IOC: {
    ev: {
      sev: 3,
      cls: 'IOC',
      seq: '884216',
      cat: 'C2 server',
    },
    summary: [
      {
        k: 'Indicator',
        v: '[2001:db8:4::20]:443',
        vStyle: 'mono',
        sub: 'type ip:port',
      },
      {
        k: 'Malware family',
        v: 'AsyncRAT',
        vStyle: 'body',
        sub: '',
      },
      {
        k: 'Network',
        v: 'AS64503',
        vStyle: 'mono',
        sub: 'Germany',
      },
      {
        k: 'First seen',
        v: '2026-10-14 13:58:00 UTC',
        vStyle: 'mono',
        sub: '',
      },
      {
        k: 'Valid until',
        v: '2026-10-21 13:58:00 UTC',
        vStyle: 'mono',
        sub: '',
      },
    ],
    prov: {
      source: 'ThreatFox (abuse.ch)',
      className: 'Indicator',
      licence: 'abuse.ch terms, non-commercial',
      upstream: 'threatfox:ioc:1349801',
      sha: '41d7b0c3…8e2f19aa',
    },
    times: [
      {
        k: 'Observed',
        v: 'not provided by source',
      },
      {
        k: 'Reported',
        v: '2026-10-14 13:58:00 UTC',
      },
      {
        k: 'Ingested',
        v: '2026-10-14 14:00:03 UTC (+2m 3s)',
      },
    ],
    conf: {
      value: 75,
      pct: '75%',
      basis: 'Upstream confidence 75 (ThreatFox)',
    },
    loc: {
      acc: '± 20 km',
      map: 'maps/mini-de.svg',
      alt: 'Germany, accuracy ring of 20 km around the located network',
      label: 'approx ± 20 km',
    },
    cls: {
      tech: 'T1071.001',
      techName: 'Web Protocols',
      rule: 'rule threatfox_c2_v1: threat_type botnet_cc',
    },
    related: [
      {
        title: 'Same IP (1)',
        rows: [
          {
            t: '13:58:00',
            d: 'C2 server · ThreatFox',
          },
        ],
      },
      {
        title: 'Same /48 (3)',
        rows: [
          {
            t: '13:52:10',
            d: '[2001:db8:4::31]:8443 · C2 server',
          },
          {
            t: '11:04:47',
            d: '[2001:db8:4::20]:8080 · C2 server',
          },
          {
            t: '09:26:13',
            d: '2001:db8:4::7 · C2 server',
          },
        ],
      },
      {
        title: 'Same ASN (22)',
        rows: [
          {
            t: '13:52:10',
            d: '[2001:db8:4::31]:8443 · C2 server',
          },
          {
            t: '12:40:09',
            d: '2001:db8:4::9 · Malware URL',
          },
          {
            t: '11:04:47',
            d: '[2001:db8:4::20]:8080 · C2 server',
          },
        ],
      },
      {
        title: 'Same IOC (2)',
        rows: [
          {
            t: '13:58:00',
            d: 'ThreatFox · AsyncRAT',
          },
          {
            t: '13:59:41',
            d: 'URLhaus · AsyncRAT payload host',
          },
        ],
      },
      {
        title: '±10 min window (17)',
        rows: [
          {
            t: '14:05:40',
            d: 'Malware URL · URLhaus',
          },
          {
            t: '13:52:10',
            d: 'C2 server · ThreatFox',
          },
          {
            t: '13:50:02',
            d: 'C2 server · ThreatFox',
          },
        ],
      },
    ],
    enrich: {
      score: '25 of 100',
    },
    hasLocation: true,
    hasEnrichment: true,
  },
  KEV: {
    ev: {
      sev: 4,
      cls: 'KEV',
      seq: '884220',
      cat: 'Known exploited vuln',
    },
    summary: [
      {
        k: 'CVE',
        v: 'CVE-2024-3400',
        vStyle: 'mono',
        sub: '',
      },
      {
        k: 'Vendor',
        v: 'Palo Alto Networks',
        vStyle: 'body',
        sub: 'PAN-OS',
      },
      {
        k: 'Date added',
        v: '2024-04-12',
        vStyle: 'mono',
        sub: '',
      },
      {
        k: 'Due date',
        v: '2024-04-19',
        vStyle: 'mono',
        sub: '',
      },
      {
        k: 'Ransomware use',
        v: 'Unknown',
        vStyle: 'body',
        sub: '',
      },
    ],
    prov: {
      source: 'CISA KEV catalogue',
      className: 'Known exploited vulnerability',
      licence: 'CC0',
      upstream: 'CVE-2024-3400',
      sha: 'c08e5a7d…6b13f402',
    },
    times: [
      {
        k: 'Observed',
        v: 'not applicable',
      },
      {
        k: 'Reported',
        v: '2024-04-12 00:00:00 UTC',
      },
      {
        k: 'Ingested',
        v: '2026-10-14 06:00:11 UTC',
      },
    ],
    conf: {
      value: 100,
      pct: '100%',
      basis: 'Authoritative catalogue (CISA)',
    },
    loc: {
      acc: '',
      map: '',
      alt: '',
      label: '',
    },
    cls: {
      tech: 'T1190',
      techName: 'Exploit Public-Facing Application',
      rule: 'rule kev_entry_v1: listed in CISA KEV',
    },
    related: [
      {
        title: 'Linked indicators (0)',
        rows: [],
      },
      {
        title: 'Same vendor (2)',
        rows: [
          {
            t: '2024-11-18',
            d: 'CVE-2024-0012 · PAN-OS',
          },
          {
            t: '2024-11-18',
            d: 'CVE-2024-9474 · PAN-OS',
          },
        ],
      },
    ],
    enrich: {
      score: '',
    },
    hasLocation: false,
    hasEnrichment: false,
  },
};
