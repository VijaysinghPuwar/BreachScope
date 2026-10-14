// Scale maths for the Space view. Pure functions, no DOM, so they are easy to test.
//
// The view is a disc. Radius on screen is linear in log10(distance): the centre is the
// inner edge of the window and the rim is the outer edge. `outer` is log10 of the
// distance at the rim in metres, and the window always spans SPAN decades. Zooming out
// is just adding to `outer`, which slides every object towards the centre.

import { LIGHT_SPEED, M_PER_AU, M_PER_LY, SPACE_OBJECTS, type SpaceObject } from './data';

/** Decades of distance visible between the centre and the rim. */
export const SPAN = 3;
/** Most zoomed in: the rim sits at 10^9 m, a little beyond the Moon. */
export const MIN_OUTER = 9;
/** Most zoomed out: just past the edge of the observable universe. */
export const MAX_OUTER = 27.2;
/** Objects fade in over this share of the radius as they leave the centre. */
export const FADE_SHARE = 0.12;

export type UnitId = 'km' | 'AU' | 'ly' | 'Mly' | 'Gly';

export interface Unit {
  id: UnitId;
  meters: number;
}

export const UNITS: Record<UnitId, Unit> = {
  km: { id: 'km', meters: 1_000 },
  AU: { id: 'AU', meters: M_PER_AU },
  ly: { id: 'ly', meters: M_PER_LY },
  Mly: { id: 'Mly', meters: 1e6 * M_PER_LY },
  Gly: { id: 'Gly', meters: 1e9 * M_PER_LY },
};

export interface SpaceScale {
  id: 'earth-moon' | 'solar-system' | 'milky-way' | 'galaxies' | 'universe';
  name: string;
  /** The scale applies while `outer` is at or above this. */
  minOuter: number;
  /** Where "jump to this scale" lands. */
  home: number;
  unit: UnitId;
  definition: string;
  origin: string;
}

/** Ordered from smallest to largest. */
export const SCALES: readonly SpaceScale[] = [
  {
    id: 'earth-moon',
    name: 'Earth and Moon',
    minOuter: MIN_OUTER,
    home: 9.4,
    unit: 'km',
    definition: '1 light second = 299,792 km',
    origin: 'Earth',
  },
  {
    id: 'solar-system',
    name: 'Solar System',
    minOuter: 10.5,
    home: 12.9,
    unit: 'AU',
    definition: '1 AU = 149.6 million km',
    origin: 'Sun',
  },
  {
    id: 'milky-way',
    name: 'Milky Way',
    minOuter: 16.5,
    home: 20.6,
    unit: 'ly',
    definition: '1 ly = 63,241 AU',
    origin: 'Sun',
  },
  {
    id: 'galaxies',
    name: 'Nearby galaxies',
    minOuter: 21.5,
    home: 24,
    unit: 'Mly',
    definition: '1 Mly = 1 million ly',
    origin: 'Milky Way',
  },
  {
    id: 'universe',
    name: 'Observable universe',
    minOuter: 25,
    home: 27,
    unit: 'Gly',
    definition: '1 Gly = 1 billion ly',
    origin: 'Milky Way',
  },
];

export const START_OUTER = SCALES[0]!.home;

export function clampOuter(outer: number): number {
  return Math.min(MAX_OUTER, Math.max(MIN_OUTER, outer));
}

export function scaleFor(outer: number): SpaceScale {
  let found = SCALES[0]!;
  for (const scale of SCALES) if (outer >= scale.minOuter) found = scale;
  return found;
}

/** Share of the radius (0 at the centre, 1 at the rim) for a distance in metres. */
export function radiusShare(distanceM: number, outer: number): number {
  return (Math.log10(distanceM) - (outer - SPAN)) / SPAN;
}

/** Inverse of radiusShare. */
export function distanceAtShare(share: number, outer: number): number {
  return 10 ** (outer - SPAN + share * SPAN);
}

/** Screen pixels that stand for a factor of ten in distance. */
export function pixelsPerDecade(radiusPx: number): number {
  return radiusPx / SPAN;
}

export interface PlacedObject {
  object: SpaceObject;
  share: number;
  /** 0 to 1. Objects near the centre fade so the middle does not pile up. */
  opacity: number;
}

export function visibleObjects(
  outer: number,
  objects: readonly SpaceObject[] = SPACE_OBJECTS,
): PlacedObject[] {
  const placed: PlacedObject[] = [];
  for (const object of objects) {
    const share = radiusShare(object.distanceM, outer);
    if (share < 0 || share > 1) continue;
    placed.push({ object, share, opacity: Math.min(1, share / FADE_SHARE) });
  }
  return placed;
}

/** Powers of ten, in the given unit, that fall inside the window. Returned in metres. */
export function decadeTicks(outer: number, unit: UnitId): number[] {
  const perUnit = UNITS[unit].meters;
  const low = Math.ceil(Math.log10(distanceAtShare(0, outer) / perUnit) - 1e-9);
  const high = Math.floor(Math.log10(distanceAtShare(1, outer) / perUnit) + 1e-9);
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
  return `${formatNumber(distanceM / UNITS[unit].meters)} ${unit}`;
}

/** The unit a person would naturally use for a distance on its own. */
export function naturalUnit(distanceM: number): UnitId {
  if (distanceM < 0.01 * M_PER_AU) return 'km';
  if (distanceM < 0.1 * M_PER_LY) return 'AU';
  if (distanceM < 1e6 * M_PER_LY) return 'ly';
  if (distanceM < 1e9 * M_PER_LY) return 'Mly';
  return 'Gly';
}

/** Light travel time as plain words, for distances where that is meaningful. */
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
export function describeView(outer: number, names: readonly string[]): string {
  const scale = scaleFor(outer);
  const from = formatDistance(distanceAtShare(0, outer), scale.unit);
  const to = formatDistance(distanceAtShare(1, outer), scale.unit);
  const shown = names.length > 0 ? ` Labelled: ${names.join(', ')}.` : '';
  return `${scale.name} scale, ${scale.definition}. Distances from ${from} to ${to} from the ${scale.origin}, on a log axis.${shown}`;
}
