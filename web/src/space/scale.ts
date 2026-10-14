// Zoom and scale maths for the Space view. Pure functions, no DOM.
//
// `outer` is log10 of the camera's distance from what it looks at, in metres. Zooming
// adds to or subtracts from it, so one number covers the 10 km of a small moon and the
// 46.5 billion light-years to the edge of the observable universe.

import { LIGHT_SPEED, M_PER_AU, M_PER_LY, type SpaceObject } from './data';
import { lerp, type Vec3 } from './astro';

/** Most zoomed out: the observable universe fits with room around it. */
export const MAX_OUTER = 27.6;
/** Camera distance never drops below this many radii of the focused body. */
export const MIN_RADII = 2.2;
/** Vertical field of view of the camera, degrees. */
export const FOV_DEG = 50;

export type UnitId = 'km' | 'AU' | 'ly' | 'Mly' | 'Gly';

export const UNIT_METERS: Record<UnitId, number> = {
  km: 1_000,
  AU: M_PER_AU,
  ly: M_PER_LY,
  Mly: 1e6 * M_PER_LY,
  Gly: 1e9 * M_PER_LY,
};

export type ScaleId =
  'earth-moon' | 'solar-system' | 'nearby-stars' | 'milky-way' | 'galaxies' | 'universe';

export interface SpaceScale {
  id: ScaleId;
  name: string;
  /** The scale applies while `outer` is at or above this. */
  minOuter: number;
  /** Where "jump to this scale" lands. */
  home: number;
  unit: UnitId;
  definition: string;
}

/** Ordered from smallest to largest. The first one is renamed after the focused body. */
export const SCALES: readonly SpaceScale[] = [
  {
    id: 'earth-moon',
    name: 'Earth and Moon',
    minOuter: -Infinity,
    home: 8.05,
    unit: 'km',
    definition: '1 light second = 299,792 km',
  },
  {
    id: 'solar-system',
    name: 'Solar System',
    minOuter: 10.6,
    home: 13.1,
    unit: 'AU',
    definition: '1 AU = 149.6 million km',
  },
  {
    id: 'nearby-stars',
    name: 'Nearby stars',
    minOuter: 16.3,
    home: 17.6,
    unit: 'ly',
    definition: '1 ly = 63,241 AU',
  },
  {
    id: 'milky-way',
    name: 'Milky Way',
    minOuter: 19.3,
    home: 21.2,
    unit: 'ly',
    definition: '1 ly = 63,241 AU',
  },
  {
    id: 'galaxies',
    name: 'Nearby galaxies',
    minOuter: 22,
    home: 24,
    unit: 'Mly',
    definition: '1 Mly = 1 million ly',
  },
  {
    id: 'universe',
    name: 'Observable universe',
    minOuter: 25.3,
    home: 27.2,
    unit: 'Gly',
    definition: '1 Gly = 1 billion ly',
  },
];

export const START_OUTER = SCALES[0]!.home;

/** Name of the closest scale for the body in focus. */
export function localScaleName(focus: SpaceObject): string {
  if (focus.id === 'earth') return 'Earth and Moon';
  if (focus.id === 'sun') return 'The Sun';
  if (focus.kind === 'moon') return focus.name;
  return `${focus.name} system`;
}

export function minOuterFor(focus: SpaceObject): number {
  return Math.log10((focus.radiusKm ?? 1_000) * 1_000 * MIN_RADII);
}

/** A pleasant first view of a body: whole disc in frame with its nearest moons. */
export function homeOuterFor(focus: SpaceObject): number {
  return minOuterFor(focus) + 0.9;
}

export function clampOuter(outer: number, minOuter: number): number {
  return Math.min(MAX_OUTER, Math.max(minOuter, outer));
}

export function scaleFor(outer: number): SpaceScale {
  let found = SCALES[0]!;
  for (const scale of SCALES) if (outer >= scale.minOuter) found = scale;
  return found;
}

export function scaleIndex(outer: number): number {
  return SCALES.indexOf(scaleFor(outer));
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * What the camera looks at. Close in it is the focused body; zooming out it drifts to
 * the Sun, then to the Galactic Centre, so each scale is centred on what matters there.
 */
export function targetFor(outer: number, focus: Vec3, sun: Vec3, galacticCentre: Vec3): Vec3 {
  const local = lerp(focus, sun, smoothstep(10.6, 12, outer));
  return lerp(local, galacticCentre, smoothstep(18.8, 20.6, outer));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How far past the camera distance an object can be and still belong to the view, in
 * decades. 1.2 is about 16 times the camera distance: Neptune stays in the Solar System
 * view, while Sirius, 8.6 light-years away, waits for the nearby stars.
 */
export const RANGE_DECADES = 1.2;
/** Screen gap from its parent below which an object has collapsed into it, in px. */
export const COLLAPSE_PX = 4;

/** 1 inside the view's range, falling to 0 over 0.4 decades beyond it. */
export function rangeFade(distanceFromTargetM: number, outer: number): number {
  if (distanceFromTargetM <= 0) return 1;
  return clamp01((outer + RANGE_DECADES - Math.log10(distanceFromTargetM)) / 0.4);
}

/** 0 once an object sits on top of its parent on screen, 1 from 10 px further out. */
export function separationFade(separationPx: number): number {
  return clamp01((separationPx - COLLAPSE_PX) / 10);
}

/** Metres per pixel at the target, for a viewport `heightPx` tall. */
export function metresPerPixel(outer: number, heightPx: number): number {
  return (2 * Math.tan(((FOV_DEG / 2) * Math.PI) / 180) * 10 ** outer) / Math.max(1, heightPx);
}

/** Powers of ten, in the scale unit, that make useful reference circles at this zoom. */
export function decadeTicks(outer: number, unit: UnitId): number[] {
  const perUnit = UNIT_METERS[unit];
  const low = Math.ceil(Math.log10((0.06 * 10 ** outer) / perUnit) - 1e-9);
  const high = Math.floor(Math.log10((1.6 * 10 ** outer) / perUnit) + 1e-9);
  const ticks: number[] = [];
  for (let power = low; power <= high; power++) ticks.push(10 ** power * perUnit);
  return ticks;
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });

export function formatNumber(value: number): string {
  if (value !== 0 && (Math.abs(value) >= 1e15 || Math.abs(value) < 1e-4)) {
    return value.toExponential(2).replace('e+', 'e');
  }
  return numberFormat.format(value);
}

export function formatDistance(distanceM: number, unit: UnitId): string {
  return `${formatNumber(distanceM / UNIT_METERS[unit])} ${unit}`;
}

/** The unit a person would naturally use for a distance on its own. */
export function naturalUnit(distanceM: number): UnitId {
  if (distanceM < 0.01 * M_PER_AU) return 'km';
  if (distanceM < 0.1 * M_PER_LY) return 'AU';
  if (distanceM < 1e6 * M_PER_LY) return 'ly';
  if (distanceM < 1e9 * M_PER_LY) return 'Mly';
  return 'Gly';
}

/** Light travel time as plain words. */
export function formatLightTime(distanceM: number): string {
  const seconds = distanceM / LIGHT_SPEED;
  const units: [number, string][] = [
    [365.25 * 86_400, 'year'],
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [size, name] of units) {
    if (seconds >= size || size === 1) {
      const value = seconds / size;
      if (value >= 1e9) return `${numberFormat.format(value / 1e9)} billion ${name}s`;
      if (value >= 1e6) return `${numberFormat.format(value / 1e6)} million ${name}s`;
      const text = value < 1 ? formatNumber(value) : numberFormat.format(value);
      return `${text} ${name}${text === '1' ? '' : 's'}`;
    }
  }
  return '';
}

/** Short description of the view, used for the canvas aria-label. */
export function describeView(
  scaleName: string,
  definition: string,
  outer: number,
  names: readonly string[],
): string {
  const unit = scaleFor(outer).unit;
  const across = formatDistance(2 * Math.tan(((FOV_DEG / 2) * Math.PI) / 180) * 10 ** outer, unit);
  const shown = names.length > 0 ? ` Labelled: ${names.join(', ')}.` : '';
  return `${scaleName} scale, ${definition}. About ${across} across the view.${shown}`;
}
