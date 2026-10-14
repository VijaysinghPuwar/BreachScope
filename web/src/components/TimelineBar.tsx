import { histogram, day, minute } from '../lib/live';
import type { Observation } from '../data/events';
import { useEffect, useState } from 'react';
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button, SeverityGlyph, Tooltip } from './ui';
import { utc, type Severity } from '../data/events';

export function TimelineBar({
  events,
  now,
  sample,
  replay,
  onReplay,
  mobile = false,
  onPlayhead,
  onHide,
}: {
  events: Observation[];
  now: number;
  sample: boolean;
  replay: boolean;
  onReplay(value: boolean): void;
  mobile?: boolean;
  onPlayhead?(value: number | null): void;
  onHide?(): void;
}) {
  const bins = histogram(events, now);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.counts.reduce((a, b) => a + b, 0)));
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(96);
  const [speed, setSpeed] = useState('60');
  useEffect(() => {
    if (!playing || !replay) return;
    const interval = setInterval(
      () => setPosition((value) => (value >= 96 ? 0 : value + 1)),
      Math.max(100, 15000 / Number(speed)),
    );
    return () => clearInterval(interval);
  }, [playing, replay, speed]);
  useEffect(() => {
    onPlayhead?.(replay ? now - day + position * 15 * minute : null);
  }, [position, replay, onPlayhead, now]);
  const playhead = utc(new Date(now - day + position * 15 * minute).toISOString());
  return (
    <section
      className={`timeline ${replay ? 'timeline-replay' : ''} ${mobile ? 'timeline-mobile' : ''}`}
      aria-label="Timeline"
    >
      <div className="timeline-heading">
        <div className="timeline-title">
          <strong>{replay ? 'Replay' : 'Last 24h'}</strong>
          <span className="caption text-tertiary">
            {replay ? `${playhead} UTC` : `15-minute bins${sample ? ' · Sample data' : ''}`}
          </span>
        </div>
        <div className="timeline-key">
          {([0, 1, 2, 3, 4] as Severity[]).map((level) => (
            <SeverityGlyph key={level} level={level} />
          ))}
        </div>
        {onHide && (
          <Button variant="ghost" onClick={onHide}>
            <ChevronDown aria-hidden="true" />
            Hide timeline
          </Button>
        )}
        <Button variant="ghost" onClick={() => onReplay(!replay)}>
          {replay ? 'Back to live' : 'Replay'}
        </Button>
      </div>
      {replay && (
        <div className="replay-controls">
          <Button
            iconOnly
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            aria-pressed={playing}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            iconOnly
            aria-label="Step back one bin"
            onClick={() => setPosition((value) => Math.max(0, value - 1))}
          >
            <SkipBack />
          </Button>
          <Button
            iconOnly
            aria-label="Step forward one bin"
            onClick={() => setPosition((value) => Math.min(96, value + 1))}
          >
            <SkipForward />
          </Button>
          <label>
            <span className="sr-only">Replay speed</span>
            <select value={speed} onChange={(event) => setSpeed(event.target.value)}>
              {['1', '10', '60', '600'].map((value) => (
                <option key={value} value={value}>
                  ×{value}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="timeline-plot">
        <svg
          viewBox="0 0 1152 52"
          preserveAspectRatio="none"
          role="img"
          aria-label="Events in 96 fifteen-minute bins, stacked from Info to Critical"
        >
          <title>Events by severity</title>
          {bins.map(({ counts, time }, index) => {
            let y = 50;
            return (
              <g key={index}>
                {counts.map((count, level) => {
                  const height = (count / maxCount) * 48;
                  y -= height;
                  return (
                    <rect
                      key={level}
                      x={index * 12}
                      y={y}
                      width="9"
                      height={height}
                      fill={`var(--sev-${level})`}
                    >
                      <title>
                        {utc(new Date(time).toISOString())} UTC ·{' '}
                        {['Info', 'Low', 'Medium', 'High', 'Critical'][level]}: {count}
                      </title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
          {replay && (
            <line
              x1={position * 12}
              x2={position * 12}
              y1="0"
              y2="52"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          )}
        </svg>
        <div className="timeline-ticks">
          {bins.flatMap((bin, index) =>
            bin.kev.map((event) => (
              <Tooltip
                key={event.event_uid}
                content={`${event.attrs?.cve ?? event.src} · ${utc(event.reported_at ?? event.observed_at!)} UTC`}
              >
                <button
                  type="button"
                  className="timeline-tick"
                  style={{ left: `${(index / 96) * 100}%` }}
                  aria-label={`KEV ${event.attrs?.cve ?? event.src}`}
                >
                  <span />
                  KEV
                </button>
              </Tooltip>
            )),
          )}
        </div>
      </div>
      {replay && (
        <input
          className="playhead"
          type="range"
          min="0"
          max="96"
          value={position}
          aria-label="Playhead"
          aria-valuetext={`${playhead} UTC`}
          onChange={(event) => setPosition(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.shiftKey && ['ArrowRight', 'ArrowLeft'].includes(event.key)) {
              event.preventDefault();
              setPosition((value) =>
                Math.max(0, Math.min(96, value + (event.key === 'ArrowRight' ? 4 : -4))),
              );
            }
          }}
        />
      )}
      <div className="timeline-axis mono">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <span key={fraction}>
            {utc(new Date(now - day + fraction * day).toISOString())}
            {fraction === 1 ? ' UTC' : ''}
          </span>
        ))}
      </div>
    </section>
  );
}
