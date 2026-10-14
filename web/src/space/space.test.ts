import { describe, expect, it } from 'vitest';
import { M_PER_AU, M_PER_LY, M_PER_PC, SPACE_OBJECTS, isFocusable, objectById } from './data';
import {
  MAX_OUTER,
  SCALES,
  clampOuter,
  decadeTicks,
  describeView,
  formatDistance,
  formatLightTime,
  handoverRange,
  homeOuterFor,
  localScaleName,
  minOuterFor,
  naturalUnit,
  rangeFade,
  RANGE_DECADES,
  COLLAPSE_PX,
  scaleFor,
  separationFade,
  targetFor,
} from './scale';
import { length, sub } from './astro';
import { computeWorld } from './world';

describe('scales', () => {
  it.each([
    [7, 'earth-moon'],
    [10.59, 'earth-moon'],
    [10.6, 'solar-system'],
    [16.29, 'solar-system'],
    [16.3, 'nearby-stars'],
    [19.3, 'milky-way'],
    [22, 'galaxies'],
    [25.3, 'universe'],
    [MAX_OUTER, 'universe'],
  ])('outer %d picks %s', (outer, id) => {
    expect(scaleFor(outer).id).toBe(id);
  });

  it('has each home inside its own scale', () => {
    for (const scale of SCALES) expect(scaleFor(scale.home).id).toBe(scale.id);
  });

  it('orders the scales by threshold', () => {
    for (let index = 1; index < SCALES.length; index++) {
      expect(SCALES[index]!.minOuter).toBeGreaterThan(SCALES[index - 1]!.minOuter);
    }
  });

  it('stops zooming in just above the surface of the focused body', () => {
    const earth = objectById.get('earth')!;
    expect(minOuterFor(earth)).toBeCloseTo(Math.log10(6_371_000 * 2.2), 10);
    expect(clampOuter(0, minOuterFor(earth))).toBe(minOuterFor(earth));
    expect(clampOuter(99, 0)).toBe(MAX_OUTER);
    for (const object of SPACE_OBJECTS.filter(isFocusable)) {
      expect(homeOuterFor(object)).toBeGreaterThan(minOuterFor(object));
      expect(scaleFor(homeOuterFor(object)).id).toBe('earth-moon');
    }
  });

  it('names the closest scale after the focused body', () => {
    expect(localScaleName(objectById.get('earth')!)).toBe('Earth and Moon');
    expect(localScaleName(objectById.get('jupiter')!)).toBe('Jupiter system');
    expect(localScaleName(objectById.get('io')!)).toBe('Io');
  });

  it('looks at the focus close in, the Sun further out, then the Galactic Centre', () => {
    const focus = [M_PER_AU, 0, 0] as const;
    const sun = [0, 0, 0] as const;
    const centre = [0, 26_000 * M_PER_LY, 0] as const;
    expect(targetFor(9, focus, sun, centre)).toEqual([M_PER_AU, 0, 0]);
    expect(targetFor(15, focus, sun, centre)).toEqual([0, 0, 0]);
    expect(targetFor(24, focus, sun, centre)).toEqual([0, 26_000 * M_PER_LY, 0]);
  });

  it('slides between targets only while both stay on screen', () => {
    const [start, end] = handoverRange(M_PER_AU);
    // Gap as a share of the camera distance at the start and end of the slide.
    expect(M_PER_AU / 10 ** start).toBeCloseTo(0.63, 2);
    expect(M_PER_AU / 10 ** end).toBeCloseTo(0.16, 2);
    // Earth's slide happens well above the Earth and Moon home view.
    expect(start).toBeGreaterThan(SCALES[0]!.home + 2);
  });
});

describe('reference data', () => {
  it('uses the IAU constants', () => {
    expect(M_PER_AU).toBe(149_597_870_700);
    expect(M_PER_LY / M_PER_AU).toBeCloseTo(63_241.08, 1);
    expect(M_PER_PC / M_PER_LY).toBeCloseTo(3.2616, 4);
  });

  it('has unique ids, positive distances and a source for everything', () => {
    expect(new Set(SPACE_OBJECTS.map((object) => object.id)).size).toBe(SPACE_OBJECTS.length);
    for (const object of SPACE_OBJECTS) {
      expect(Number.isFinite(object.distanceM)).toBe(true);
      expect(object.distanceM).toBeGreaterThan(0);
      expect(object.source.length).toBeGreaterThan(10);
      expect(object.note.length).toBeGreaterThan(5);
    }
  });

  it('gives every body with a surface a texture', () => {
    for (const object of SPACE_OBJECTS.filter(isFocusable)) {
      expect(object.skin).toBeDefined();
      expect(object.radiusKm).toBeGreaterThan(0);
    }
  });

  it('has valid sky coordinates', () => {
    for (const object of SPACE_OBJECTS) {
      if (object.placement.type !== 'sky') continue;
      expect(object.placement.ra).toMatch(/^\d\d \d\d [\d.]+$/);
      expect(object.placement.dec).toMatch(/^[+-]\d\d \d\d [\d.]+$/);
    }
  });

  it('matches the published values for the key objects', () => {
    expect(objectById.get('moon')!.distanceM).toBe(384_400_000);
    expect(objectById.get('jupiter')!.distanceM / M_PER_AU).toBeCloseTo(5.2, 1);
    expect(objectById.get('galactic-centre')!.distanceM / M_PER_LY).toBe(26_000);
    expect(objectById.get('m31')!.distanceM / M_PER_LY).toBeCloseTo(2.5e6, -3);
    expect(objectById.get('edge')!.distanceM / M_PER_LY).toBeCloseTo(46.5e9, -6);
  });

  it('has no em or en dashes in any text', () => {
    for (const object of SPACE_OBJECTS) {
      expect(`${object.name} ${object.note} ${object.source}`).not.toMatch(/[\u2013\u2014]/);
    }
    for (const scale of SCALES) {
      expect(`${scale.name} ${scale.definition}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('formatting', () => {
  it('formats distances in a unit', () => {
    expect(formatDistance(5.2 * M_PER_AU, 'AU')).toBe('5.2 AU');
    expect(formatDistance(384_400_000, 'km')).toBe('384,000 km');
    expect(formatDistance(46.5e9 * M_PER_LY, 'Gly')).toBe('46.5 Gly');
  });

  it('lists powers of ten around the camera distance', () => {
    const ticks = decadeTicks(13, 'AU').map((tick) => tick / M_PER_AU);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) expect(Math.log10(tick) % 1).toBeCloseTo(0, 9);
  });

  it('picks a natural unit', () => {
    expect(naturalUnit(384_400_000)).toBe('km');
    expect(naturalUnit(5 * M_PER_AU)).toBe('AU');
    expect(naturalUnit(4.2 * M_PER_LY)).toBe('ly');
    expect(naturalUnit(2.5e6 * M_PER_LY)).toBe('Mly');
    expect(naturalUnit(46.5e9 * M_PER_LY)).toBe('Gly');
  });

  it('writes light travel time in words', () => {
    expect(formatLightTime(384_400_000)).toBe('1.28 seconds');
    expect(formatLightTime(M_PER_AU)).toBe('8.32 minutes');
    expect(formatLightTime(4.2465 * M_PER_LY)).toBe('4.25 years');
    expect(formatLightTime(2.5e6 * M_PER_LY)).toBe('2.5 million years');
  });

  it('describes the view for screen readers', () => {
    const text = describeView('Solar System', '1 AU = 149.6 million km', 13, ['Earth', 'Mars']);
    expect(text).toMatch(/^Solar System scale, 1 AU = 149.6 million km\./);
    expect(text).toContain('Labelled: Earth, Mars.');
  });
});

describe('what each scale shows', () => {
  const world = computeWorld(new Date('2026-10-14T12:00Z'));
  const sun = world.positions.get('sun')!;
  const centre = world.positions.get('galactic-centre')!;
  const shown = (outer: number) => {
    const target = targetFor(outer, world.positions.get('earth')!, sun, centre);
    return SPACE_OBJECTS.filter(
      (object) => rangeFade(length(sub(world.positions.get(object.id)!, target)), outer) > 0,
    ).map((object) => object.id);
  };
  const home = (id: string) => SCALES.find((scale) => scale.id === id)!.home;

  it('fades out objects far beyond the camera distance', () => {
    expect(rangeFade(1e12, 13)).toBe(1);
    expect(rangeFade(10 ** (13 + RANGE_DECADES), 13)).toBe(0);
    expect(rangeFade(10 ** (13 + RANGE_DECADES - 0.2), 13)).toBeCloseTo(0.5, 10);
  });

  it('fades out objects that collapse into their parent on screen', () => {
    expect(separationFade(0)).toBe(0);
    expect(separationFade(COLLAPSE_PX)).toBe(0);
    expect(separationFade(COLLAPSE_PX + 5)).toBeCloseTo(0.5, 10);
    expect(separationFade(100)).toBe(1);
  });

  it('keeps Earth and Moon to the Earth system', () => {
    const ids = shown(home('earth-moon'));
    expect(ids).toEqual(expect.arrayContaining(['earth', 'moon', 'iss', 'geo']));
    expect(ids).not.toContain('jupiter');
    expect(ids).not.toContain('sirius');
  });

  it('keeps stars out of the Solar System view', () => {
    const ids = shown(home('solar-system'));
    expect(ids).toEqual(expect.arrayContaining(['sun', 'earth', 'jupiter', 'neptune']));
    for (const id of ['proxima', 'sirius', 'betelgeuse', 'orion-nebula', 'm31']) {
      expect(ids).not.toContain(id);
    }
  });

  it('shows the nearest stars but not distant nebulae or galaxies', () => {
    const ids = shown(home('nearby-stars'));
    expect(ids).toEqual(expect.arrayContaining(['proxima', 'sirius', 'vega']));
    for (const id of ['orion-nebula', 'galactic-centre', 'm31']) expect(ids).not.toContain(id);
  });

  it('shows the Galactic Centre and the Magellanic Clouds in the Milky Way view', () => {
    expect(shown(home('milky-way'))).toEqual(
      expect.arrayContaining(['galactic-centre', 'lmc', 'smc', 'sun']),
    );
    expect(shown(home('milky-way'))).not.toContain('m87');
  });

  it('reaches the edge of the observable universe only at the largest scale', () => {
    expect(shown(home('galaxies'))).toEqual(expect.arrayContaining(['m31', 'm87']));
    expect(shown(home('galaxies'))).not.toContain('gn-z11');
    expect(shown(home('universe'))).toEqual(expect.arrayContaining(['gn-z11', 'edge']));
  });
});
