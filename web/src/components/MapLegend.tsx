import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, SeverityGlyph } from './ui';
import type { Severity } from '../data/events';
export function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`map-legend ${open ? 'open' : ''}`}>
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        Legend{open ? <ChevronDown /> : <ChevronUp />}
      </Button>
      {open && (
        <div className="legend-content">
          <div className="legend-severities">
            {([0, 1, 2, 3, 4] as Severity[]).map((level) => (
              <SeverityGlyph key={level} level={level} />
            ))}
          </div>
          <h3 className="label">Location accuracy</h3>
          <dl>
            <div>
              <dt>City-level IP</dt>
              <dd>Point · approx · city</dd>
            </div>
            <div>
              <dt>Published accuracy</dt>
              <dd>Dashed ring · true radius in km</dd>
            </div>
            <div>
              <dt>Country only</dt>
              <dd>Shaded country · approx · country</dd>
            </div>
            <div>
              <dt>Unknown / vulnerability</dt>
              <dd>Feed and timeline only</dd>
            </div>
          </dl>
          <p>No sensors online. Telemetry arcs hidden. Indicators and reports still shown.</p>
        </div>
      )}
    </div>
  );
}
