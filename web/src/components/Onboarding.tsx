import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MapPin, MousePointerClick, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui';
import { markGuideSeen } from '../lib/guide';

/**
 * First-visit guide: a welcome card, then an optional tour that points at
 * the real controls one by one. Each tour target carries a `data-tour`
 * attribute; steps whose target is not on screen at this size are skipped,
 * so the same tour works on desktop, tablet and phone.
 */

interface Step {
  target: string;
  title: string;
  body: string;
}

const steps: Step[] = [
  {
    target: 'map',
    title: 'The map',
    body: 'Each dot is an IP address that a public feed reported as malicious, such as a botnet control server or a malware download host. It sits at its city. Shape and colour both show severity. Click a dot to open its record.',
  },
  {
    target: 'feed',
    title: 'The feed',
    body: 'Every record as a list, newest first, with totals at the top. Pick a row to see the source, licence, timestamps and how precise the location is.',
  },
  {
    target: 'filters',
    title: 'Data types',
    body: 'Turn each kind of record on or off. Indicators go on the map. Exploited vulnerabilities and breaches have no location, so they appear in the feed, the timeline and Reports.',
  },
  {
    target: 'search',
    title: 'Search',
    body: 'Find an IP, ASN, CVE, country or malware family. Shortcut: Cmd K or Ctrl K.',
  },
  {
    target: 'timeline',
    title: 'Timeline and replay',
    body: 'See the last 24 hours as a histogram, or switch to Replay and scrub back through it.',
  },
  {
    target: 'guide',
    title: 'You are set',
    body: 'Reports lists exploited vulnerabilities and breaches. Status shows the health of each feed. Open this guide again from here at any time.',
  },
];

const CARD_W = 320;
const GAP = 12;
const MARGIN = 16;

function findTarget(name: string): DOMRect | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
}

function Welcome({ onTour, onClose }: { onTour(): void; onClose(): void }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose]);
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <Button
        variant="ghost"
        iconOnly
        className="welcome-close"
        aria-label="Close welcome"
        onClick={onClose}
      >
        <X />
      </Button>
      <p className="label text-tertiary">Welcome to BreachScope</p>
      <h2 id="welcome-title">A live map of reported cyber threats</h2>
      <p className="text-secondary">
        BreachScope reads public security feeds every few minutes and shows what they report: botnet
        servers, malware hosts, scanning IPs, exploited vulnerabilities and data breaches.
      </p>
      <ul className="welcome-points">
        <li>
          <MapPin aria-hidden="true" />
          <span>Dots are IP addresses reported as malicious, placed at their city.</span>
        </li>
        <li>
          <MousePointerClick aria-hidden="true" />
          <span>
            Click a dot or a feed row to see who reported it, when, and under what licence.
          </span>
        </li>
        <li>
          <ShieldCheck aria-hidden="true" />
          <span>Real data only. Lines between places appear only when both ends are exact.</span>
        </li>
      </ul>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onTour}>
          Show me around
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Explore on my own
        </Button>
      </div>
    </section>
  );
}

function Tour({ onDone }: { onDone(): void }) {
  // Fixed at the start so the step count does not change mid-tour.
  const [available] = useState(() => steps.filter((step) => findTarget(step.target)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [cardH, setCardH] = useState(200);
  const step = available[index];

  // Panels open and close while the tour runs, so the target is measured
  // again on a short interval rather than once.
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      setRect(findTarget(step.target));
      setSize({ w: window.innerWidth, h: window.innerHeight });
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [step]);
  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [index, size.w]);
  useEffect(() => heading.current?.focus(), [index]);

  if (!step) return null;
  const last = index === available.length - 1;
  const next = () => (last ? onDone() : setIndex(index + 1));
  const width = Math.min(CARD_W, size.w - 2 * MARGIN);
  // A target that fills most of the screen (the map) gets a free card
  // and no outline: outlining the whole screen says nothing.
  const big = !rect || rect.width * rect.height > size.w * size.h * 0.4;
  let top: number;
  let left: number;
  if (big || !rect) {
    // Low on the screen, so the dots it describes stay visible above it.
    top = size.h - cardH - 96;
    left = (size.w - width) / 2;
  } else {
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - cardH;
    const right = rect.right + GAP;
    if (rect.width < 80 && rect.height > 100 && right + width <= size.w - MARGIN) {
      // A tall, narrow target (the feed rail): the card sits beside it.
      top = rect.top;
      left = right;
    } else {
      top = below + cardH <= size.h - MARGIN ? below : above >= MARGIN ? above : MARGIN;
      left = rect.left + rect.width / 2 - width / 2;
    }
  }
  left = Math.max(MARGIN, Math.min(left, size.w - width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, size.h - cardH - MARGIN));
  return (
    <>
      {rect && !big && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={{ top, left, width }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
          if (event.key === 'ArrowRight') next();
          if (event.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
        }}
      >
        <div className="tour-head">
          <span className="caption text-tertiary mono">
            {index + 1} of {available.length}
          </span>
          <Button variant="ghost" iconOnly aria-label="End tour" onClick={onDone}>
            <X />
          </Button>
        </div>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          {index > 0 && (
            <Button variant="ghost" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={next}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );
}

export type GuideState = 'welcome' | 'tour' | null;

export function Onboarding({
  state,
  onState,
}: {
  state: GuideState;
  onState(value: GuideState): void;
}) {
  const finish = useCallback(() => {
    markGuideSeen();
    onState(null);
  }, [onState]);
  if (state === 'welcome') return <Welcome onTour={() => onState('tour')} onClose={finish} />;
  if (state === 'tour') return <Tour onDone={finish} />;
  return null;
}
