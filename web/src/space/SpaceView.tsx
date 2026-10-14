import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Globe2, List, Minus, Pause, Play, Plus, X } from 'lucide-react';
import { objectById, isFocusable, type SpaceObject } from './data';
import { SpaceEngine, type FrameInfo, type Palette } from './engine';
import {
  MAX_OUTER,
  SCALES,
  clampOuter,
  describeView,
  formatDistance,
  formatLightTime,
  homeOuterFor,
  localScaleName,
  minOuterFor,
  naturalUnit,
  scaleFor,
  scaleIndex,
} from './scale';
import { length, sub } from './astro';
import styles from './SpaceView.module.css';

export interface SpaceViewProps {
  onReturnToEarth(): void;
  reducedMotion: boolean;
}

/** Decades per key press. */
const KEY_STEP = 0.2;
/** Decades per pixel of wheel movement. A mouse notch (100 px) moves a fifth of a decade. */
const WHEEL_STEP = 0.002;
/** Zooming in this far past the closest view of Earth hands back to the globe. */
const RETURN_OVERSHOOT = 0.6;
const FLIGHT_MS = 1_800;

const PLANET_BAR = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

const SPEEDS: { label: string; days: number }[] = [
  { label: 'Paused', days: 0 },
  { label: '1 hour per second', days: 1 / 24 },
  { label: '1 day per second', days: 1 },
  { label: '1 week per second', days: 7 },
  { label: '1 month per second', days: 30.44 },
  { label: '1 year per second', days: 365.25 },
];

const MEASURE_TEXT: Record<SpaceObject['measure'], string> = {
  proper: 'Straight-line distance.',
  'light-travel': 'Light travel distance: how far the light has travelled to reach us.',
  comoving: 'Comoving distance: where the object is today, after cosmic expansion.',
};

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: token('--bg-base', '#0e1013'),
    primary: token('--text-primary', '#e4e6e9'),
    secondary: token('--text-secondary', '#a2a8b0'),
    tertiary: token('--text-tertiary', '#888f97'),
    accent: token('--accent', '#8ea4c2'),
    borderDefault: token('--border-default', '#2e343b'),
    borderStrong: token('--border-strong', '#5f6a78'),
    font: token('--font-sans', 'system-ui, sans-serif'),
  };
}

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Flight {
  start: number;
  fromOuter: number;
  toOuter: number;
  /** Extra decades to pull back mid-flight so the trip is visible. */
  lift: number;
}

export default function SpaceView({ onReturnToEarth, reducedMotion }: SpaceViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpaceEngine | null>(null);

  const [webgl, setWebgl] = useState(canUseWebGL);
  const [ready, setReady] = useState(false);
  const [outer, setOuter] = useState(homeOuterFor(objectById.get('earth')!));
  const [focusId, setFocusId] = useState('earth');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inView, setInView] = useState<string[]>([]);
  const [labelled, setLabelled] = useState<string[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [shownDate, setShownDate] = useState(() => new Date());
  const [sunDistance, setSunDistance] = useState(0);

  const target = useRef(outer);
  const current = useRef(outer);
  const flight = useRef<Flight | null>(null);
  const overshoot = useRef(0);
  const focusRef = useRef(focusId);
  const speedRef = useRef(0);
  const lastTick = useRef(0);
  const lastFrame = useRef(0);
  const dateShownAt = useRef(0);
  const reducedRef = useRef(reducedMotion);
  const returnRef = useRef(onReturnToEarth);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    returnRef.current = onReturnToEarth;
    engineRef.current?.setReducedMotion(reducedMotion);
  });

  /** Positive `decades` zooms out. */
  const zoomBy = useCallback((decades: number) => {
    const engine = engineRef.current;
    if (!engine || flight.current) return;
    const floor = minOuterFor(objectById.get(focusRef.current)!);
    if (decades < 0 && target.current <= floor + 1e-6) {
      if (focusRef.current !== 'earth') return;
      overshoot.current -= decades;
      if (overshoot.current >= RETURN_OVERSHOOT) {
        overshoot.current = 0;
        returnRef.current();
      }
      return;
    }
    overshoot.current = 0;
    target.current = clampOuter(target.current + decades, floor);
    engine.requestRender();
  }, []);
  // One engine per mount. Everything it allocates on the GPU is freed on unmount.
  useEffect(() => {
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    const root = rootRef.current;
    if (!stage || !overlay || !root) return;
    let engine: SpaceEngine;
    const tick = (now: number) => {
      const eng = engineRef.current;
      if (!eng) return false;
      let busy = false;
      const trip = flight.current;
      if (trip) {
        const t = reducedRef.current ? 1 : Math.min(1, (now - trip.start) / FLIGHT_MS);
        eng.flightT = t;
        current.current =
          trip.fromOuter + (trip.toOuter - trip.fromOuter) * t + trip.lift * Math.sin(Math.PI * t);
        if (t >= 1) {
          flight.current = null;
          eng.flightFrom = null;
          current.current = target.current = trip.toOuter;
        } else busy = true;
      } else {
        const gap = target.current - current.current;
        if (reducedRef.current || Math.abs(gap) < 0.002) current.current = target.current;
        else {
          // Time-based easing: the same 120 ms time constant on fast and slow devices.
          const dt = lastFrame.current ? Math.min(200, now - lastFrame.current) : 16;
          current.current += gap * (1 - Math.exp(-dt / 120));
          busy = true;
        }
      }
      eng.outer = current.current;
      lastFrame.current = busy ? now : 0;
      if (speedRef.current) {
        const elapsed = lastTick.current ? Math.min(250, now - lastTick.current) : 0;
        eng.date = new Date(eng.date.getTime() + (elapsed / 1000) * speedRef.current * 86_400_000);
        lastTick.current = now;
        if (now - dateShownAt.current > 200) {
          dateShownAt.current = now;
          setShownDate(eng.date);
        }
        busy = true;
      }
      return busy;
    };
    const onFrame = (info: FrameInfo) => {
      setOuter((previous) =>
        Math.abs(previous - info.outer) > 0.004 || scaleFor(previous) !== scaleFor(info.outer)
          ? info.outer
          : previous,
      );
      const ids = [...new Set(info.spots.map((spot) => spot.id))];
      const names = info.spots.filter((spot) => spot.labelled).map((spot) => spot.id);
      setInView((previous) => (previous.join() === ids.join() ? previous : ids));
      setLabelled((previous) => (previous.join() === names.join() ? previous : names));
      const eng = engineRef.current;
      const chosen = eng?.selectedId ? objectById.get(eng.selectedId) : undefined;
      const fromSun =
        eng && chosen && (chosen.placement.type === 'kepler' || chosen.id === 'earth')
          ? eng.distanceBetween(chosen.id, 'sun')
          : 0;
      setSunDistance((previous) => (Math.abs(previous - fromSun) > 1e6 ? fromSun : previous));
      setReady(true);
    };
    try {
      engine = new SpaceEngine(
        stage,
        overlay,
        {
          palette: readPalette(root),
          outer: current.current,
          date: new Date(),
          reducedMotion: reducedRef.current,
        },
        { tick, onFrame },
      );
    } catch (error) {
      console.error('Space view could not start WebGL.', error);
      // Deferred so the fallback renders after this effect, not during it.
      queueMicrotask(() => setWebgl(false));
      return;
    }
    engineRef.current = engine;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      engine.resize(
        entry.contentRect.width,
        entry.contentRect.height,
        window.devicePixelRatio || 1,
      );
    });
    observer.observe(root);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomBy(pixels * WHEEL_STEP);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', onWheel);
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [zoomBy]);

  const focus = objectById.get(focusId)!;
  const minOuter = minOuterFor(focus);

  const jumpTo = useCallback((outerValue: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    overshoot.current = 0;
    target.current = clampOuter(outerValue, minOuterFor(objectById.get(focusRef.current)!));
    engine.requestRender();
  }, []);

  const flyTo = useCallback((id: string) => {
    const engine = engineRef.current;
    const object = objectById.get(id);
    if (!engine || !object || !isFocusable(object)) return;
    const from = engine.currentTarget();
    const to = engine.positionOf(id) ?? from;
    const toOuter = homeOuterFor(object);
    const fromOuter = current.current;
    const lift = Math.max(
      0,
      Math.log10(length(sub(to, from)) + 1) + 0.3 - Math.max(fromOuter, toOuter),
    );
    focusRef.current = id;
    engine.focusId = id;
    engine.flightFrom = from;
    engine.flightT = 0;
    flight.current = { start: performance.now(), fromOuter, toOuter, lift };
    setFocusId(id);
    setSelectedId(id);
    engine.selectedId = id;
    engine.requestRender();
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const engine = engineRef.current;
    if (engine) {
      engine.selectedId = id;
      engine.requestRender();
    }
  }, []);

  const setTimeSpeed = (days: number) => {
    speedRef.current = days;
    lastTick.current = 0;
    setSpeed(days);
    engineRef.current?.requestRender();
  };

  const resetTime = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.date = new Date();
    setShownDate(engine.date);
    engine.requestRender();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY } : null;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size !== 2) return;
    const [a, b] = [...pointers.current.values()];
    const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinchDistance.current > 0 && distance > 0) {
      // Spreading two fingers by 10x zooms in by two decades.
      zoomBy(-2 * Math.log10(distance / pinchDistance.current));
    }
    pinchDistance.current = distance;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = downAt.current;
    const wasTap =
      pointers.current.size === 1 &&
      start !== null &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = 0;
    if (pointers.current.size === 0) downAt.current = null;
    if (!wasTap || event.type !== 'pointerup') return;
    const rect = event.currentTarget.getBoundingClientRect();
    select(engineRef.current?.pick(event.clientX - rect.left, event.clientY - rect.top) ?? null);
  };

  const scale = scaleFor(outer);
  const index = scaleIndex(outer);
  const scaleName = index === 0 ? localScaleName(focus) : scale.name;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    const engine = engineRef.current;
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      const turn: Record<string, [number, number]> = {
        ArrowLeft: [-10, 0],
        ArrowRight: [10, 0],
        ArrowUp: [0, -6],
        ArrowDown: [0, 6],
      };
      const [dTheta, dPhi] = turn[event.key] ?? [0, 0];
      engine?.orbitBy(dTheta, dPhi);
    } else if (['+', '=', 'ArrowUp'].includes(event.key)) zoomBy(-KEY_STEP);
    else if (['-', '_', 'ArrowDown'].includes(event.key)) zoomBy(KEY_STEP);
    else if (event.key === 'ArrowLeft') engine?.orbitBy(-10, 0);
    else if (event.key === 'ArrowRight') engine?.orbitBy(10, 0);
    else if (event.key === 'PageUp')
      jumpTo(index <= 1 ? homeOuterFor(focus) : SCALES[index - 1]!.home);
    else if (event.key === 'PageDown') jumpTo(SCALES[Math.min(SCALES.length - 1, index + 1)]!.home);
    else if (event.key === 'Home') jumpTo(homeOuterFor(focus));
    else if (event.key === 'End') jumpTo(MAX_OUTER - 0.4);
    else if (event.key === 'Escape') {
      if (selectedId) select(null);
      else onReturnToEarth();
    } else return;
    event.preventDefault();
  };

  const selected = selectedId ? (objectById.get(selectedId) ?? null) : null;
  const labelledNames = labelled.map((id) => objectById.get(id)?.name ?? id).slice(0, 14);
  const ariaLabel = describeView(scaleName, scale.definition, outer, labelledNames);
  const inViewObjects = inView
    .map((id) => objectById.get(id))
    .filter((object): object is SpaceObject => object !== undefined)
    .sort((a, b) => a.distanceM - b.distanceM);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      tabIndex={0}
      role="region"
      aria-roledescription="3D space view"
      aria-label="Space view"
      onKeyDown={onKeyDown}
      data-testid="space-view"
      data-scale={scale.id}
      data-outer={outer.toFixed(2)}
      data-focus={focusId}
      data-ready={ready ? 'true' : 'false'}
      data-webgl={webgl ? 'true' : 'false'}
    >
      <div
        ref={stageRef}
        className={styles.canvas}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas ref={overlayRef} className={styles.overlay} aria-hidden="true" />

      {!webgl && (
        <div className={styles.fallback} role="alert">
          <p className={styles.fallbackTitle}>This device can&apos;t draw the 3D space view.</p>
          <p>WebGL is turned off or not supported in this browser.</p>
        </div>
      )}

      <div className={styles.header}>
        <h2 className={styles.title}>{scaleName}</h2>
        <p className={styles.definition} aria-live="polite">
          {scaleName} · {scale.definition}
        </p>
        <nav aria-label="Scales" className={styles.scales}>
          <ol>
            {SCALES.map((item, position) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.scaleButton}
                  aria-current={item.id === scale.id ? 'true' : undefined}
                  onClick={() => jumpTo(position === 0 ? homeOuterFor(focus) : item.home)}
                >
                  {position === 0 ? localScaleName(focus) : item.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom in"
          disabled={outer <= minOuter + 0.01 && focusId !== 'earth'}
          onClick={() => zoomBy(-KEY_STEP * 2)}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom out"
          disabled={outer >= MAX_OUTER - 0.01}
          onClick={() => zoomBy(KEY_STEP * 2)}
        >
          <Minus aria-hidden="true" />
        </button>
        <button type="button" className={styles.button} onClick={onReturnToEarth}>
          <Globe2 aria-hidden="true" />
          <span>Back to Earth</span>
        </button>
      </div>

      <div className={styles.side}>
        <button
          type="button"
          className={styles.button}
          aria-expanded={listOpen}
          aria-controls="space-object-list"
          onClick={() => setListOpen((open) => !open)}
        >
          <List aria-hidden="true" />
          <span>In view ({inViewObjects.length})</span>
        </button>
        {listOpen && (
          <ul id="space-object-list" className={styles.list} aria-label="Objects in view">
            {inViewObjects.map((object) => (
              <li key={object.id}>
                <button
                  type="button"
                  className={styles.listButton}
                  aria-pressed={object.id === selectedId}
                  onClick={() => {
                    select(object.id);
                    if (window.matchMedia('(max-width: 820px)').matches) setListOpen(false);
                  }}
                >
                  <span>{object.name}</span>
                  <span className={styles.muted}>
                    {formatDistance(object.distanceM, naturalUnit(object.distanceM))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <DetailCard
            object={selected}
            focused={selected.id === focusId}
            nowFromSun={sunDistance}
            onFly={() => flyTo(selected.id)}
            onClose={() => select(null)}
          />
        )}
      </div>

      <div className={styles.footer}>
        <nav aria-label="Fly to" className={styles.planets}>
          {PLANET_BAR.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.planetButton}
              aria-pressed={id === focusId}
              onClick={() => flyTo(id)}
            >
              {objectById.get(id)!.name}
            </button>
          ))}
        </nav>
        <div className={styles.timebar}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={speed ? 'Pause time' : 'Play time'}
            onClick={() => setTimeSpeed(speed ? 0 : 1)}
          >
            {speed ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <label className={styles.speed}>
            <span className={styles.srOnly}>Time speed</span>
            <select value={speed} onChange={(event) => setTimeSpeed(Number(event.target.value))}>
              {SPEEDS.map((option) => (
                <option key={option.label} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <time className={styles.date} dateTime={shownDate.toISOString()}>
            {dateFormat.format(shownDate)}
          </time>
          <button type="button" className={styles.button} onClick={resetTime}>
            Now
          </button>
        </div>
        <p className={styles.caption}>
          Planets, the Moon, stars and galaxies are at their real positions for this date. Moons of
          other planets, galaxy shapes, belts and the Milky Way&apos;s spiral are illustrative.
        </p>
        <p className={styles.hint}>
          Drag to turn, scroll or pinch to zoom. Click anything for details.
        </p>
      </div>
    </div>
  );
}

function DetailCard({
  object,
  focused,
  nowFromSun,
  onFly,
  onClose,
}: {
  object: SpaceObject;
  focused: boolean;
  nowFromSun: number;
  onFly(): void;
  onClose(): void;
}) {
  const unit = naturalUnit(object.distanceM);
  // Only units that give a readable number for this distance.
  const alsoIn = (['km', 'AU', 'ly'] as const).filter(
    (other) =>
      other !== unit &&
      (other !== 'km' || object.distanceM < 1e15) &&
      (other !== 'AU' || object.distanceM < 1e19) &&
      (other !== 'ly' || object.distanceM > 1e14),
  );
  const from =
    object.from === 'Sun' || object.from === 'Earth' ? `the ${object.from}` : object.from;
  return (
    <section className={styles.card} aria-label={`${object.name} details`}>
      <header className={styles.cardHeader}>
        <h3>{object.name}</h3>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <dl className={styles.facts}>
        <dt>Distance</dt>
        <dd>
          {formatDistance(object.distanceM, unit)} from {from}
        </dd>
        {alsoIn.length > 0 && (
          <>
            <dt>Also</dt>
            <dd>{alsoIn.map((other) => formatDistance(object.distanceM, other)).join(' · ')}</dd>
          </>
        )}
        {nowFromSun > 0 && (
          <>
            <dt>On this date</dt>
            <dd>{formatDistance(nowFromSun, 'AU')} from the Sun</dd>
          </>
        )}
        {object.radiusKm !== undefined && (
          <>
            <dt>Radius</dt>
            <dd>{formatDistance(object.radiusKm * 1_000, 'km')}</dd>
          </>
        )}
        {object.measure !== 'comoving' && (
          <>
            <dt>Light time</dt>
            <dd>{formatLightTime(object.distanceM)}</dd>
          </>
        )}
        <dt>Measure</dt>
        <dd>{MEASURE_TEXT[object.measure]}</dd>
      </dl>
      <p className={styles.note}>{object.note}</p>
      <p className={styles.source}>
        <span className={styles.muted}>Source: </span>
        {object.source}
      </p>
      {isFocusable(object) && !focused && (
        <button type="button" className={styles.button} onClick={onFly}>
          Fly to {object.name}
        </button>
      )}
    </section>
  );
}
