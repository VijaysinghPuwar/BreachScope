import { useEffect, useState } from 'react';

/** The intro stays at least this long so it reads as a step, not a flicker. */
const MIN_MS = 1600;
/** Never block the app longer than this, even if the map cannot start. */
const MAX_MS = 9000;
const FADE_MS = 600;

export function Intro({
  feedsLoaded,
  mapReady,
  eventCount,
}: {
  feedsLoaded: boolean;
  mapReady: boolean;
  eventCount: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => clearInterval(timer);
  }, []);

  const step = !feedsLoaded ? 0 : !mapReady ? 1 : 2;
  const done = (step === 2 && elapsed >= MIN_MS) || elapsed >= MAX_MS;
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [done]);
  if (gone) return null;

  // The bar moves with real progress, eased so it never jumps to the end.
  const progress = Math.min(1, (step + Math.min(elapsed / MIN_MS, 1)) / 3);
  const status = [
    'Loading live feeds',
    `${eventCount.toLocaleString('en-US')} events`,
    `${eventCount.toLocaleString('en-US')} events`,
  ][step];
  return (
    <div className="intro" data-leaving={done} role="status" aria-live="polite">
      <div className="intro-card">
        <div className="intro-wordmark">BreachScope</div>
        <div className="intro-track" aria-hidden="true">
          <div className="intro-bar" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="intro-status">{status}</p>
      </div>
    </div>
  );
}
