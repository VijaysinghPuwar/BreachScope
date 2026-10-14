import { metrics, relativeTime } from '../lib/live';
import { useRef, useState } from 'react';
import { ListFilter, PanelLeftClose, Pause, Play } from 'lucide-react';
import { eventTime, utc, type Observation } from '../data/events';
import { Button, Chip, EmptyState, SeverityGlyph } from './ui';

export function FeedRow({
  event,
  selected,
  compact = false,
  isNew,
  now,
  onSelect,
}: {
  event: Observation;
  selected: boolean;
  compact?: boolean;
  isNew: boolean;
  now: number;
  onSelect(event: Observation): void;
}) {
  const detail = (
    event.data_class === 'KEV'
      ? [event.attrs?.cve ?? event.src, event.attrs?.vendor, event.attrs?.product]
      : [event.src, event.asn, event.country_code, event.attrs?.malware]
  )
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      className={`feed-row ${selected ? 'selected' : ''} ${compact ? 'compact' : ''} ${isNew ? 'is-new' : ''}`}
      data-uid={event.event_uid}
      aria-pressed={selected}
      data-seq={event.seq}
      onClick={() => onSelect(event)}
    >
      <span className="feed-primary">
        <SeverityGlyph level={event.severity} compact />
        <span className="feed-category">{event.category}</span>
        <Chip code={event.data_class} />
      </span>
      <span className="feed-detail mono" title={detail}>
        {detail}
      </span>
      <span className="feed-time mono">
        <time dateTime={eventTime(event)}>{utc(eventTime(event))}</time>
        <span className="feed-severity">{relativeTime(eventTime(event), now)}</span>
      </span>
    </button>
  );
}
export function Feed({
  events,
  selected,
  onSelect,
  onCollapse,
  clearFilters,
  sample,
  paused,
  onPause,
  queued = 0,
  mini = false,
  newIds,
  now,
}: {
  events: Observation[];
  selected: string | null;
  onSelect(event: Observation): void;
  onCollapse?(): void;
  clearFilters(): void;
  sample: boolean;
  paused: boolean;
  onPause(): void;
  queued?: number;
  mini?: boolean;
  newIds: Set<string>;
  now: number;
}) {
  const [sort, setSort] = useState('Newest');
  const [compact, setCompact] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const sorted = [...events].sort((a, b) =>
    sort === 'Severity'
      ? b.severity - a.severity || b.seq - a.seq
      : Date.parse(eventTime(b)) - Date.parse(eventTime(a)),
  );
  return (
    <div className={`feed ${mini ? 'feed-mini' : ''}`}>
      <div className="feed-heading">
        <div>
          <h2>Feed</h2>
          <span className="caption text-secondary">{events.length.toLocaleString()} events</span>
        </div>
        <div className="row-actions">
          <Button
            variant="ghost"
            iconOnly
            aria-label={paused ? 'Resume feed' : 'Pause feed'}
            aria-pressed={paused}
            onClick={onPause}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          {onCollapse && (
            <Button variant="ghost" iconOnly aria-label="Collapse feed" onClick={onCollapse}>
              <PanelLeftClose />
            </Button>
          )}
        </div>
      </div>
      <div className="metrics-grid">
        {metrics(events, now).map((counter) => (
          <div className="metric-tile" key={counter.label}>
            <span className="caption text-secondary">{counter.label}</span>
            <span className="metric">{counter.value}</span>
            {counter.window && <span className="caption text-tertiary">{counter.window}</span>}
            {counter.label === 'Anomalies' && (
              <span
                className="caption text-tertiary"
                title="Anomalies fire when z ≥ 6 and at least 20 events."
              >
                No anomalies in the last 14 days.
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="feed-toolbar">
        <span className="caption text-tertiary">{sample ? 'Sample data' : 'Events'} · UTC</span>
        <label className="select-label">
          <span className="sr-only">Sort events</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option>Newest</option>
            <option>Severity</option>
          </select>
        </label>
        <Button
          variant="ghost"
          iconOnly
          aria-label="Compact feed"
          aria-pressed={compact}
          onClick={() => setCompact(!compact)}
        >
          <ListFilter />
        </Button>
      </div>
      {paused && (
        <Button className="resume-feed" onClick={onPause}>
          {queued ? `${queued} new · Resume` : 'Resume'}
        </Button>
      )}
      <ul
        ref={list}
        className="feed-list"
        aria-label="Events"
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [
            ...(list.current?.querySelectorAll<HTMLButtonElement>('.feed-row') ?? []),
          ];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                  );
          buttons[next]?.focus();
        }}
      >
        {sorted.map((event) => (
          <li key={event.event_uid}>
            <FeedRow
              event={event}
              selected={selected === event.event_uid}
              isNew={newIds.has(event.event_uid)}
              now={now}
              compact={compact}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      {!events.length && (
        <EmptyState action={<Button onClick={clearFilters}>Clear filters</Button>}>
          No events match these filters.
        </EmptyState>
      )}
      <div className="feed-footer caption text-tertiary">
        {sample ? 'Sample data · ' : ''}
        <span className="mono">J / K</span> next / previous
      </div>
    </div>
  );
}
