import { describe, expect, it } from 'vitest';
import { M_PER_AU, M_PER_LY, M_PER_PC, SPACE_OBJECTS } from './data';
import {
  MAX_OUTER,
  MIN_OUTER,
  SCALES,
  SPAN,
  START_OUTER,
  clampOuter,
  decadeTicks,
  describeView,
  distanceAtShare,
  formatDistance,
  formatLightTime,
  naturalUnit,
  radiusShare,
  scaleFor,
  visibleObjects,
} from './scale';

const byId = (id: string) => SPACE_OBJECTS.find((object) => object.id === id)!;

describe('log mapping', () => {
  it('round-trips distance to radius share and back', () => {
    for (const outer of [MIN_OUTER, 12.9, 20.6, 24, MAX_OUTER]) {
      for (const share of [0, 0.1, 0.5, 0.87, 1]) {
        const back = radiusShare(distanceAtShare(share, outer), outer);
        expect(back).toBeCloseTo(share, 12);
      }
    }
  });

  it('puts the inner edge at the centre and the outer edge at the rim', () => {
    expect(radiusShare(10 ** (15 - SPAN), 15)).toBeCloseTo(0, 12);
    expect(radiusShare(1e15, 15)).toBeCloseTo(1, 12);
    expect(radiusShare(10 ** (15 - SPAN / 2), 15)).toBeCloseTo(0.5, 12);
  });

  it('moves objects inwards as the view zooms out', () => {
    const moon = byId('moon').distanceM;
    expect(radiusShare(moon, 9.5)).toBeGreaterThan(radiusShare(moon, 10));
  });

  it('clamps the zoom range', () => {
    expect(clampOuter(0)).toBe(MIN_OUTER);
    expect(clampOuter(99)).toBe(MAX_OUTER);
    expect(clampOuter(15)).toBe(15);
  });
});

describe('scale thresholds', () => {
  it.each([
    [MIN_OUTER, 'earth-moon'],
    [10.49, 'earth-moon'],
    [10.5, 'solar-system'],
    [16.49, 'solar-system'],
    [16.5, 'milky-way'],
    [21.49, 'milky-way'],
    [21.5, 'galaxies'],
    [24.99, 'galaxies'],
    [25, 'universe'],
    [MAX_OUTER, 'universe'],
  ])('outer %d picks %s', (outer, id) => {
    expect(scaleFor(outer).id).toBe(id);
  });

  it('has each home inside its own scale and inside the zoom range', () => {
    for (const scale of SCALES) {
      expect(scaleFor(scale.home).id).toBe(scale.id);
      expect(clampOuter(scale.home)).toBe(scale.home);
    }
    expect(START_OUTER).toBe(SCALES[0]!.home);
  });

  it('orders the scales by threshold', () => {
    for (let index = 1; index < SCALES.length; index++) {
      expect(SCALES[index]!.minOuter).toBeGreaterThan(SCALES[index - 1]!.minOuter);
    }
  });

  it('shows the defining objects at each home view', () => {
    const at = (outer: number) => visibleObjects(outer).map((item) => item.object.id);
    expect(at(SCALES[0]!.home)).toContain('moon');
    expect(at(SCALES[0]!.home)).not.toContain('mercury');
    expect(at(SCALES[1]!.home)).toEqual(expect.arrayContaining(['mercury', 'earth', 'neptune']));
    expect(at(SCALES[1]!.home)).not.toContain('moon');
    expect(at(SCALES[2]!.home)).toContain('galactic-centre');
    expect(at(SCALES[3]!.home)).toEqual(expect.arrayContaining(['m31', 'lmc', 'm87']));
    expect(at(SCALES[4]!.home)).toEqual(expect.arrayContaining(['edge', 'gn-z11']));
  });
});

describe('reference data', () => {
  it('uses the IAU constants', () => {
    expect(M_PER_AU).toBe(149_597_870_700);
    expect(M_PER_LY / M_PER_AU).toBeCloseTo(63_241.08, 1);
    expect(M_PER_PC / M_PER_LY).toBeCloseTo(3.2616, 4);
  });

  it('has positive, finite distances sorted nearest first', () => {
    for (const object of SPACE_OBJECTS) {
      expect(Number.isFinite(object.distanceM)).toBe(true);
      expect(object.distanceM).toBeGreaterThan(0);
    }
    for (let index = 1; index < SPACE_OBJECTS.length; index++) {
      expect(SPACE_OBJECTS[index]!.distanceM).toBeGreaterThanOrEqual(
        SPACE_OBJECTS[index - 1]!.distanceM,
      );
    }
  });

  it('has unique ids and a source for every object', () => {
    const ids = new Set(SPACE_OBJECTS.map((object) => object.id));
    expect(ids.size).toBe(SPACE_OBJECTS.length);
    for (const object of SPACE_OBJECTS) {
      expect(object.source.length).toBeGreaterThan(10);
      expect(object.note.length).toBeGreaterThan(5);
      expect(object.angleDeg).toBeGreaterThanOrEqual(0);
      expect(object.angleDeg).toBeLessThan(360);
    }
  });

  it('matches the published values for the key objects', () => {
    expect(byId('moon').distanceM).toBe(384_400_000);
    expect(byId('jupiter').distanceM / M_PER_AU).toBeCloseTo(5.2, 1);
    expect(byId('neptune').distanceM / M_PER_AU).toBeCloseTo(30.2, 1);
    expect(byId('galactic-centre').distanceM / M_PER_LY).toBe(26_000);
    expect(byId('m31').distanceM / M_PER_LY).toBeCloseTo(2.5e6, -3);
    expect(byId('edge').distanceM / M_PER_LY).toBeCloseTo(46.5e9, -6);
  });

  it('can reach every object somewhere in the zoom range', () => {
    for (const object of SPACE_OBJECTS) {
      const log = Math.log10(object.distanceM);
      expect(log).toBeGreaterThan(MIN_OUTER - SPAN);
      expect(log).toBeLessThan(MAX_OUTER);
    }
  });

  it('ends with the edge of the observable universe', () => {
    expect(SPACE_OBJECTS.at(-1)!.id).toBe('edge');
  });

  it('has no em or en dashes in any text', () => {
    for (const object of SPACE_OBJECTS) {
      expect(`${object.name} ${object.note} ${object.source}`).not.toMatch(/[\u2013\u2014]/);
    }
    for (const scale of SCALES)
      expect(`${scale.name} ${scale.definition}`).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('formatting', () => {
  it('formats distances in a unit', () => {
    expect(formatDistance(5.2 * M_PER_AU, 'AU')).toBe('5.2 AU');
    expect(formatDistance(384_400_000, 'km')).toBe('384,000 km');
    expect(formatDistance(46.5e9 * M_PER_LY, 'Gly')).toBe('46.5 Gly');
  });

  it('lists the powers of ten inside the window', () => {
    const ticks = decadeTicks(SCALES[1]!.home, 'AU').map((tick) => tick / M_PER_AU);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toBeCloseTo(0.1, 10);
    expect(ticks[1]).toBeCloseTo(1, 10);
    expect(ticks[2]).toBeCloseTo(10, 10);
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
    const text = describeView(SCALES[1]!.home, ['Earth', 'Mars']);
    expect(text).toMatch(/^Solar System scale, 1 AU = 149.6 million km\./);
    expect(text).toContain('from the Sun');
    expect(text).toContain('Labelled: Earth, Mars.');
  });
});
