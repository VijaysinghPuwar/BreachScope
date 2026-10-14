import type { LiveSource } from '../data/live';
import { utc } from '../data/events';
import { isStale, staleCopy } from '../lib/live';
import { Tooltip } from './ui';
export function Freshness({ sources, now }: { sources: LiveSource[]; now: number }) {
  const latest = Math.max(0, ...sources.map((s) => Date.parse(s.last_success ?? '') || 0));
  return (
    <Tooltip
      content={
        <ul className="source-freshness">
          {sources.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>
              <br />
              {source.last_success ? (
                <span className="mono">{utc(source.last_success)} UTC</span>
              ) : (
                'No successful update yet'
              )}
              <br />
              {source.records.toLocaleString()} records
              {isStale(source, now) && <p>{staleCopy(source, now)}</p>}
              {source.last_error && <p>{source.last_error}</p>}
            </li>
          ))}
        </ul>
      }
    >
      <span
        tabIndex={0}
        className="freshness caption"
        data-stale={sources.some((s) => isStale(s, now))}
      >
        {latest
          ? `Feeds updated ${Math.max(0, Math.floor((now - latest) / 60000))}m ago`
          : 'Awaiting feed updates'}
      </span>
    </Tooltip>
  );
}
