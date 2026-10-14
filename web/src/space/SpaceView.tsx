import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Globe2, List, Minus, Plus, X } from 'lucide-react';
import type { SpaceObject } from './data';
import {
  SCALES,
  START_OUTER,
  MIN_OUTER,
  clampOuter,
  decadeTicks,
  describeView,
  formatDistance,
  formatLightTime,
  naturalUnit,
  pixelsPerDecade,
  radiusShare,
  scaleFor,
  visibleObjects,
  type PlacedObject,
} from './scale';
import styles from './SpaceView.module.css';

export interface SpaceViewProps {
  onReturnToEarth(): void;
  reducedMotion: boolean;
}

/** Decades per key press or zoom button press. */
const KEY_STEP = 0.25;
/** Decades per pixel of wheel movement. A mouse notch (100 px) moves a quarter decade. */
const WHEEL_STEP = 0.0025;
/** Zooming in this many decades past the closest view hands back to the globe. */
const RETURN_OVERSHOOT = 0.6;
/** Gap between the disc and the edge of the view, in px. */
const RIM_GAP = 28;
/** Click or tap tolerance when picking an object, in px. */
const PICK_PX = 18;

const MEASURE_TEXT: Record<SpaceObject['measure'], string> = {
  proper: 'Straight-line distance.',
  'light-travel': 'Light travel distance: how far the light has travelled to reach us.',
  comoving: 'Comoving distance: where the object is today, after cosmic expansion.',
};

interface Palette {
  bg: string;
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  borderDefault: string;
  borderStrong: string;
  font: string;
}

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

interface Geometry {
  cx: number;
  cy: number;
  radius: number;
}

function geometryFor(width: number, height: number): Geometry {
  return {
    cx: width / 2,
    cy: height / 2,
    radius: Math.max(40, Math.min(width, height) / 2 - RIM_GAP),
  };
}

function pointFor(placed: PlacedObject, geometry: Geometry) {
  const r = placed.share * geometry.radius;
  const angle = (placed.object.angleDeg * Math.PI) / 180;
  return { x: geometry.cx + r * Math.cos(angle), y: geometry.cy - r * Math.sin(angle), r };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function draw(
  canvas: HTMLCanvasElement,
  palette: Palette,
  width: number,
  height: number,
  outer: number,
  placed: PlacedObject[],
  selectedId: string | null,
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
  if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = palette.bg;
  context.fillRect(0, 0, width, height);

  const geometry = geometryFor(width, height);
  const { cx, cy, radius } = geometry;
  const scale = scaleFor(outer);

  // Label boxes already drawn, so later labels can avoid them.
  const taken: Box[] = [];

  // Decade rings: one thin ring per power of ten in the scale's unit.
  context.lineWidth = 1;
  context.font = `400 11px ${palette.font}`;
  context.textBaseline = 'bottom';
  context.textAlign = 'left';
  for (const tick of decadeTicks(outer, scale.unit)) {
    const r = radiusShare(tick, outer) * radius;
    if (r < 6) continue;
    // Dashed so scale rings never read as orbits, which are solid.
    context.setLineDash([2, 4]);
    context.strokeStyle = palette.borderStrong;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    const text = formatDistance(tick, scale.unit);
    const textWidth = context.measureText(text).width;
    context.fillStyle = palette.tertiary;
    context.fillText(text, cx + 4, cy - r - 2);
    taken.push({ left: cx + 2, top: cy - r - 16, right: cx + 6 + textWidth, bottom: cy - r });
  }

  // Rings for orbits and boundaries go under every dot and label.
  for (const item of placed) {
    if (item.object.kind !== 'orbit' && item.object.kind !== 'boundary') continue;
    const r = item.share * radius;
    context.globalAlpha = item.opacity;
    context.strokeStyle = item.object.id === selectedId ? palette.accent : palette.borderDefault;
    context.lineWidth = item.object.id === selectedId ? 1.5 : 1;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
  }

  // Origin.
  context.globalAlpha = 1;
  context.fillStyle = palette.accent;
  context.beginPath();
  context.arc(cx, cy, 3.5, 0, Math.PI * 2);
  context.fill();

  context.font = `500 12px ${palette.font}`;
  const originLabel = scale.origin;
  const originWidth = context.measureText(originLabel).width;
  context.fillStyle = palette.secondary;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(originLabel, cx + 8, cy + 6);
  taken.push({ left: cx - 6, top: cy - 6, right: cx + 12 + originWidth, bottom: cy + 22 });

  // Selected first so its label always wins, then outer objects, which have more room.
  const order = [...placed].sort((a, b) => {
    if (a.object.id === selectedId) return -1;
    if (b.object.id === selectedId) return 1;
    return b.share - a.share;
  });

  for (const item of order) {
    const { x, y } = pointFor(item, geometry);
    const selected = item.object.id === selectedId;
    context.globalAlpha = item.opacity;

    if (item.object.kind !== 'boundary') {
      context.beginPath();
      context.arc(x, y, 3, 0, Math.PI * 2);
      if (item.object.kind === 'galaxy') {
        context.strokeStyle = palette.primary;
        context.lineWidth = 1.25;
        context.stroke();
      } else {
        context.fillStyle = palette.primary;
        context.fill();
      }
    } else {
      context.beginPath();
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fillStyle = palette.tertiary;
      context.fill();
    }
    if (selected) {
      context.strokeStyle = palette.accent;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.stroke();
    }

    if (item.opacity < 0.35 && !selected) continue;
    const name = item.object.name;
    const distance = formatDistance(item.object.distanceM, scale.unit);
    context.font = `${selected ? 600 : 500} 12px ${palette.font}`;
    const nameWidth = context.measureText(name).width;
    context.font = `400 11px ${palette.font}`;
    const distanceWidth = context.measureText(distance).width;
    const labelWidth = Math.max(nameWidth, distanceWidth);
    let leftSide = Math.cos((item.object.angleDeg * Math.PI) / 180) < -0.2;
    // Flip to the other side rather than run off the canvas.
    if (leftSide && x - 10 - labelWidth < 4) leftSide = false;
    else if (!leftSide && x + 10 + labelWidth > width - 4) leftSide = true;
    const lx = leftSide ? x - 10 - labelWidth : x + 10;
    const box = { left: lx - 2, top: y - 16, right: lx + labelWidth + 2, bottom: y + 14 };
    if (!selected && taken.some((other) => overlaps(box, other))) continue;
    taken.push(box);

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = palette.primary;
    context.font = `${selected ? 600 : 500} 12px ${palette.font}`;
    context.fillText(name, lx, y - 2);
    context.fillStyle = palette.tertiary;
    context.font = `400 11px ${palette.font}`;
    context.fillText(distance, lx, y + 11);
  }
  context.globalAlpha = 1;
}

export default function SpaceView({ onReturnToEarth, reducedMotion }: SpaceViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [outer, setOuter] = useState(START_OUTER);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const target = useRef(START_OUTER);
  const current = useRef(START_OUTER);
  const frame = useRef(0);
  const overshoot = useRef(0);
  const reducedRef = useRef(reducedMotion);
  const returnRef = useRef(onReturnToEarth);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    returnRef.current = onReturnToEarth;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Moves the view towards `target`, eased unless reduced motion is on. */
  const settle = useCallback(() => {
    if (reducedRef.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      current.current = target.current;
      setOuter(target.current);
      return;
    }
    if (frame.current) return;
    const step = () => {
      const gap = target.current - current.current;
      const done = reducedRef.current || Math.abs(gap) < 0.002;
      current.current = done ? target.current : current.current + gap * 0.2;
      setOuter(current.current);
      frame.current = done ? 0 : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, []);

  /** Positive `decades` zooms out. */
  const zoomBy = useCallback(
    (decades: number) => {
      if (decades < 0 && target.current <= MIN_OUTER + 1e-6) {
        overshoot.current -= decades;
        if (overshoot.current >= RETURN_OVERSHOOT) {
          overshoot.current = 0;
          returnRef.current();
        }
        return;
      }
      overshoot.current = 0;
      target.current = clampOuter(target.current + decades);
      settle();
    },
    [settle],
  );

  const jumpTo = useCallback(
    (outerValue: number) => {
      overshoot.current = 0;
      target.current = clampOuter(outerValue);
      settle();
    },
    [settle],
  );

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomBy(pixels * WHEEL_STEP);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const placed = useMemo(() => visibleObjects(outer), [outer]);
  const scale = scaleFor(outer);
  const geometry = geometryFor(size.width, size.height);
  const selected = placed.find((item) => item.object.id === selectedId)?.object ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || size.width === 0) return;
    draw(canvas, readPalette(root), size.width, size.height, outer, placed, selectedId);
  }, [outer, placed, selectedId, size]);

  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: { id: string; gap: number } | null = null;
    for (const item of placed) {
      if (item.opacity < 0.35) continue;
      const point = pointFor(item, geometry);
      let gap = Math.hypot(point.x - px, point.y - py);
      if (item.object.kind === 'boundary' || item.object.kind === 'orbit') {
        const ringGap = Math.abs(Math.hypot(px - geometry.cx, py - geometry.cy) - point.r);
        gap = Math.min(gap, ringGap + 6);
      }
      if (gap <= PICK_PX && (!best || gap < best.gap)) best = { id: item.object.id, gap };
    }
    setSelectedId(best ? best.id : null);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY } : null;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
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

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = downAt.current;
    const wasTap =
      pointers.current.size === 1 &&
      start !== null &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = 0;
    if (pointers.current.size === 0) downAt.current = null;
    if (wasTap && event.type === 'pointerup') pick(event.clientX, event.clientY);
  };

  const scaleIndex = SCALES.indexOf(scale);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const zoomIn = ['+', '=', 'ArrowUp', 'ArrowRight'];
    const zoomOut = ['-', '_', 'ArrowDown', 'ArrowLeft'];
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    if (zoomIn.includes(event.key)) zoomBy(-KEY_STEP);
    else if (zoomOut.includes(event.key)) zoomBy(KEY_STEP);
    else if (event.key === 'PageUp') jumpTo(SCALES[Math.max(0, scaleIndex - 1)]!.home);
    else if (event.key === 'PageDown')
      jumpTo(SCALES[Math.min(SCALES.length - 1, scaleIndex + 1)]!.home);
    else if (event.key === 'Home') jumpTo(SCALES[0]!.home);
    else if (event.key === 'End') jumpTo(SCALES[SCALES.length - 1]!.home);
    else if (event.key === 'Escape') {
      if (selectedId) setSelectedId(null);
      else onReturnToEarth();
    } else return;
    event.preventDefault();
  };

  const labelled = placed.filter((item) => item.opacity >= 0.35);
  const ariaLabel = describeView(
    outer,
    labelled.map((item) => item.object.name),
  );
  const decadePx = pixelsPerDecade(geometry.radius);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      tabIndex={0}
      role="region"
      aria-roledescription="zoomable space view"
      aria-label="Space view"
      onKeyDown={onKeyDown}
      data-testid="space-view"
      data-scale={scale.id}
      data-outer={outer.toFixed(2)}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className={styles.header}>
        <h2 className={styles.title}>{scale.name}</h2>
        <p className={styles.definition} aria-live="polite">
          {scale.name} · {scale.definition}
        </p>
        <nav aria-label="Scales" className={styles.scales}>
          <ol>
            {SCALES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.scaleButton}
                  aria-current={item.id === scale.id ? 'true' : undefined}
                  onClick={() => jumpTo(item.home)}
                >
                  {item.name}
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
          onClick={() => zoomBy(-KEY_STEP * 2)}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom out"
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
          <span>In view ({placed.length})</span>
        </button>
        {listOpen && (
          <ul id="space-object-list" className={styles.list} aria-label="Objects in view">
            {[...placed]
              .sort((a, b) => a.object.distanceM - b.object.distanceM)
              .map((item) => (
                <li key={item.object.id}>
                  <button
                    type="button"
                    className={styles.listButton}
                    aria-pressed={item.object.id === selectedId}
                    onClick={() => {
                      setSelectedId(item.object.id);
                      // On narrow screens the list and the card do not both fit.
                      if (window.matchMedia('(max-width: 820px)').matches) setListOpen(false);
                    }}
                  >
                    <span>{item.object.name}</span>
                    <span className={styles.muted}>
                      {formatDistance(item.object.distanceM, scale.unit)}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {selected && <DetailCard object={selected} onClose={() => setSelectedId(null)} />}
      </div>

      <div className={styles.footer}>
        <div className={styles.scaleBar} aria-hidden="true">
          <span className={styles.bar} style={{ width: `${Math.round(decadePx)}px` }} />
          <span>×10 distance</span>
        </div>
        <p className={styles.caption}>
          Distances to scale on a log axis. Directions are schematic.
        </p>
        <p className={styles.hint}>
          Scroll, pinch, or press + and - to zoom. Click an object for details.
        </p>
      </div>
    </div>
  );
}

function DetailCard({ object, onClose }: { object: SpaceObject; onClose(): void }) {
  const unit = naturalUnit(object.distanceM);
  // Only units that give a readable number for this distance.
  const alsoIn = (['km', 'AU', 'ly'] as const).filter(
    (other) =>
      other !== unit &&
      (other !== 'km' || object.distanceM < 1e15) &&
      (other !== 'AU' || object.distanceM < 1e19) &&
      (other !== 'ly' || object.distanceM > 1e14),
  );
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
        <dd>{formatDistance(object.distanceM, unit)}</dd>
        {alsoIn.length > 0 && (
          <>
            <dt>Also</dt>
            <dd>{alsoIn.map((other) => formatDistance(object.distanceM, other)).join(' · ')}</dd>
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
    </section>
  );
}
