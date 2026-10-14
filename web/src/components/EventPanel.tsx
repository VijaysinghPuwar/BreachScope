import { useState } from 'react';
import { ArrowLeft, Braces, X } from 'lucide-react';
import { classNames, utc, type Observation } from '../data/events';
import { locationLabel, rawRecordUrl } from '../lib/location';
import { relativeTime } from '../lib/live';
import { Banner, Button, Chip, Modal, PanelSection, SeverityGlyph } from './ui';
function Fields({ rows }: { rows: [string, string | number | undefined | null][] }) {
  return (
    <dl className="detail-list">
      {rows
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
export function EventPanel({
  event,
  onClose,
  back = false,
  sample,
  now,
}: {
  event: Observation;
  onClose(): void;
  back?: boolean;
  sample: boolean;
  now: number;
}) {
  const [raw, setRaw] = useState(false);
  const [copyState, setCopyState] = useState('');
  const record = JSON.stringify(event.raw ?? event, null, 2);
  const url = rawRecordUrl(event);
  const location = locationLabel(event);
  const times = [
    ['Reported', event.reported_at],
    ['Observed', event.observed_at],
    ['Ingested', event.ingested_at],
    ['Valid until', event.valid_until],
  ];
  return (
    <div className="event-panel">
      <header className="event-header">
        <div className="event-eyebrow">
          <span className="mono text-tertiary event-uid">{event.event_uid}</span>
          <Button
            variant="ghost"
            iconOnly
            aria-label={back ? 'Back to feed' : 'Close event detail'}
            onClick={onClose}
          >
            {back ? <ArrowLeft /> : <X />}
          </Button>
        </div>
        <div className="event-class">
          <SeverityGlyph level={event.severity} />
          <Chip code={event.data_class} />
          {sample && <span>Sample data</span>}
        </div>
        <h2>{event.category}</h2>
        <div className="event-actions">
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(record);
                setCopyState('Copied');
              } catch {
                setRaw(true);
              }
            }}
          >
            <Braces />
            Copy JSON
          </Button>
          <Button variant="ghost" onClick={() => setRaw(true)}>
            View JSON
          </Button>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="button button-ghost">
              Open raw record
            </a>
          )}
        </div>
        <span className="sr-only" role="status">
          {copyState}
        </span>
      </header>
      {event.data_class === 'IOC' && (
        <div className="panel-banner">
          <Banner>Indicator, not an observed attack. Reported by {event.source}.</Banner>
        </div>
      )}
      {event.data_class === 'KEV' && (
        <div className="panel-banner">
          <Banner>Not geographic. Shown on the timeline as ticks.</Banner>
        </div>
      )}
      {(event.src || event.asn || Object.keys(event.attrs ?? {}).length > 0) && (
        <PanelSection title="Summary">
          <Fields
            rows={[
              [event.data_class === 'KEV' ? 'CVE' : 'IP / indicator', event.src],
              ['ASN', event.asn],
              ['Country', event.country],
            ]}
          />
          <Fields
            rows={Object.entries(event.attrs ?? {}).map(([key, value]) => [
              key.replaceAll('_', ' '),
              value,
            ])}
          />
        </PanelSection>
      )}
      <PanelSection title="Provenance">
        <Fields
          rows={[
            ['Source', event.source],
            ['Data class', classNames[event.data_class]],
            ['Licence', event.raw?.licence],
            ['Upstream id', event.raw?.source_record_id],
          ]}
        />
      </PanelSection>
      <PanelSection title="Time">
        <dl className="detail-list time-list">
          {times
            .filter(([, time]) => time)
            .map(([label, time]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <time className="mono" dateTime={time!}>
                    {utc(time!)} UTC
                  </time>
                  <span className="detail-sub">{relativeTime(time!, now)}</span>
                </dd>
              </div>
            ))}
        </dl>
      </PanelSection>
      {(event.confidence !== null || event.confidence_basis) && (
        <PanelSection title="Confidence">
          {event.confidence !== null && (
            <div className="confidence">
              <meter min="0" max="100" value={event.confidence} aria-label="Confidence" />
              <span className="mono">{event.confidence}%</span>
            </div>
          )}
          {event.confidence_basis && <p>{event.confidence_basis}</p>}
        </PanelSection>
      )}
      {location && (
        <PanelSection title="Location">
          <p>{location}</p>
          <Fields
            rows={[
              ['Method', event.geo_method],
              ['Country', event.country],
              ['Coordinates', event.coordinates?.join(', ')],
              [
                'Accuracy',
                event.geo_accuracy_km !== null ? `${event.geo_accuracy_km} km` : undefined,
              ],
            ]}
          />
          {event.geo_method === 'dbip_city_lite' && event.geo_accuracy_km === null && (
            <p>Accuracy: not published by DB-IP Lite</p>
          )}
          <p className="text-secondary">IP location identifies a network, not a person.</p>
        </PanelSection>
      )}
      <Modal open={raw} onOpenChange={setRaw} title="Raw record">
        <pre className="raw-record mono">{record}</pre>
      </Modal>
    </div>
  );
}
