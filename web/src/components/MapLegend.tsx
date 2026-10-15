import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, SeverityGlyph } from './ui';
import type { Severity } from '../data/events';
export function MapLegend({ honeypot }: { honeypot: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`map-legend ${open ? 'open' : ''}`}>
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        Legend{open ? <ChevronDown /> : <ChevronUp />}
      </Button>
      {open && (
        <div className="legend-content">
          <h3 className="label">What the marks mean</h3>
          <dl>
            <div>
              <dt>Dot</dt>
              <dd>An IP a feed reported, at its city · approx · city</dd>
            </div>
            <div>
              <dt>Shaded country</dt>
              <dd>Only the country is known · approx · country</dd>
            </div>
            <div>
              <dt>Line</dt>
              <dd>A hit on our honeypot. Drawn only when both ends are exact</dd>
            </div>
            <div>
              <dt>Not on map</dt>
              <dd>Exploited CVEs and breaches: feed, timeline and Reports</dd>
            </div>
          </dl>
          <h3 className="label">Severity: shape and colour</h3>
          <div className="legend-severities">
            {([0, 1, 2, 3, 4] as Severity[]).map((level) => (
              <SeverityGlyph key={level} level={level} />
            ))}
          </div>
          {!honeypot && (
            <p className="text-tertiary">
              Honeypot not deployed yet, so no lines right now. Indicators and reports still shown.
            </p>
          )}
          <a href="/about">More about the data</a>
        </div>
      )}
    </div>
  );
}
