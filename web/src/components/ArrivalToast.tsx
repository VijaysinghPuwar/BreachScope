import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { eventTime, type Observation } from '../data/events';
import { relativeTime } from '../lib/live';
import { SeverityGlyph } from './ui';

const SHOW_MS = 7000;

/** One line saying where an event is, or who it is about. */
function subject(event: Observation) {
  if (event.data_class === 'BRCH') {
    const records = Number(event.attrs?.records ?? 0).toLocaleString('en-US');
    return `${event.attrs?.organisation ?? event.src} · ${records} accounts`;
  }
  if (event.data_class === 'KEV')
    return [event.attrs?.cve, event.attrs?.vendor].filter(Boolean).join(' · ');
  const place = [event.attrs?.city, event.country].filter(Boolean).join(', ');
  return place || event.src || event.source;
}

/**
 * Announces the newest arrival after each poll (and the newest event once on
 * first load). A breach report also sends one screen-wide pulse: breaches have
 * no location in the data, so the alert is global rather than pinned to a
 * place the source never named.
 */
export function ArrivalToast({
  events,
  newIds,
  now,
  enabled,
  onSelect,
}: {
  events: Observation[];
  newIds: Set<string>;
  now: number;
  enabled: boolean;
  onSelect(event: Observation): void;
}) {
  const [current, setCurrent] = useState<{ event: Observation; more: number } | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [hovered, setHovered] = useState(false);
  const announcedFirst = useRef(false);

  useEffect(() => {
    if (!enabled || events.length === 0) return;
    const byTime = (a: Observation, b: Observation) =>
      Date.parse(eventTime(b)) - Date.parse(eventTime(a));
    let arrivals: Observation[];
    if (!announcedFirst.current) {
      announcedFirst.current = true;
      arrivals = [...events].sort(byTime).slice(0, 1);
    } else {
      arrivals = events.filter((e) => newIds.has(e.event_uid)).sort(byTime);
    }
    if (arrivals.length === 0) return;
    // A breach outranks anything else in the same poll.
    const lead = arrivals.find((e) => e.data_class === 'BRCH') ?? arrivals[0]!;
    setCurrent({ event: lead, more: arrivals.length - 1 });
    if (lead.data_class === 'BRCH') setPulseKey((k) => k + 1);
  }, [events, newIds, enabled]);

  useEffect(() => {
    if (!current || hovered) return;
    const timer = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current, hovered]);

  return (
    <>
      {pulseKey > 0 && <div key={pulseKey} className="global-pulse" aria-hidden="true" />}
      {current && (
        <div
          className="arrival-toast"
          role="status"
          aria-live="polite"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            className="arrival-body"
            onClick={() => {
              onSelect(current.event);
              setCurrent(null);
            }}
          >
            <span className="arrival-title">
              <SeverityGlyph level={current.event.severity} compact />
              {current.event.data_class === 'BRCH'
                ? 'New breach disclosed'
                : current.event.category}
            </span>
            <span className="arrival-subject">{subject(current.event)}</span>
            <span className="arrival-meta">
              {current.event.source} · {relativeTime(eventTime(current.event), now)}
              {current.more > 0 && ` · +${current.more} more`}
            </span>
          </button>
          <button
            type="button"
            className="arrival-close"
            aria-label="Dismiss"
            onClick={() => setCurrent(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
