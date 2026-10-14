import { describe, expect, it } from 'vitest';
import {
  OBLIQUITY_DEG,
  bodyAxes,
  dot,
  eccentricAnomaly,
  equatorialToEcliptic,
  equatorialUnit,
  galacticAxes,
  gmstDeg,
  length,
  moonPosition,
  planetPosition,
  sexagesimal,
  sub,
  type Vec3,
} from './astro';
import { M_PER_AU, M_PER_LY, objectById, SPACE_OBJECTS } from './data';
import { EARTH_MOON_BARYCENTRE, computeWorld } from './world';

const longitude = (v: Vec3) => ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360;
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const elements = (id: string) => {
  const placement = objectById.get(id)!.placement;
  if (placement.type !== 'kepler') throw new Error(`${id} has no elements`);
  return placement.elements;
};

describe('Kepler orbits', () => {
  it('solves Kepler equation', () => {
    for (const e of [0, 0.0167, 0.2056, 0.9]) {
      for (const M of [-3, -1, 0, 0.5, 2.9]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
      }
    }
  });

  it('puts Earth at perihelion in early January and aphelion in early July', () => {
    const perihelion = planetPosition(EARTH_MOON_BARYCENTRE, new Date('2024-01-03T01:00Z'));
    const aphelion = planetPosition(EARTH_MOON_BARYCENTRE, new Date('2024-07-05T05:00Z'));
    expect(length(perihelion) / M_PER_AU).toBeCloseTo(0.9833, 2);
    expect(length(aphelion) / M_PER_AU).toBeCloseTo(1.0167, 2);
  });

  it('puts Earth opposite the March equinox at the equinox', () => {
    const world = computeWorld(new Date('2024-03-20T03:06Z'));
    // J2000 frame: the equinox has precessed about 50.3 arcsec a year, 0.34 degrees by 2024.
    const precession = (24.2 * 50.29) / 3600;
    expect(angleGap(longitude(world.positions.get('earth')!), 180 - precession)).toBeLessThan(0.05);
  });

  it('lines up Earth and Mars at the January 2025 opposition', () => {
    const date = new Date('2025-01-16T02:00Z');
    const earth = computeWorld(date).positions.get('earth')!;
    const mars = planetPosition(elements('mars'), date);
    expect(angleGap(longitude(earth), longitude(mars))).toBeLessThan(1.5);
  });

  it('keeps every planet near its published distance from the Sun', () => {
    const date = new Date('2026-10-14T12:00Z');
    for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const r = length(planetPosition(elements(id), date));
      const a = objectById.get(id)!.distanceM;
      expect(Math.abs(r - a) / a).toBeLessThan(0.21);
    }
  });
});

describe('Moon', () => {
  it('stays between perigee and apogee', () => {
    for (let day = 0; day < 60; day += 3) {
      const r = length(moonPosition(new Date(Date.UTC(2026, 0, 1 + day))));
      expect(r).toBeGreaterThan(356_000_000);
      expect(r).toBeLessThan(407_000_000);
    }
  });

  it('is opposite the Sun at a full moon', () => {
    const date = new Date('2024-01-25T17:54Z');
    const earth = computeWorld(date).positions.get('earth')!;
    // Earth's heliocentric longitude is the Sun's geocentric longitude plus 180.
    expect(angleGap(longitude(moonPosition(date)), longitude(earth))).toBeLessThan(2);
  });
});

describe('frames', () => {
  it('tilts the celestial pole by the obliquity', () => {
    const pole = equatorialToEcliptic([0, 0, 1]);
    const e = (OBLIQUITY_DEG * Math.PI) / 180;
    expect(pole[1]).toBeCloseTo(Math.sin(e), 12);
    expect(pole[2]).toBeCloseTo(Math.cos(e), 12);
  });

  it('parses sexagesimal coordinates', () => {
    expect(sexagesimal('12 30 00', true)).toBeCloseTo(187.5, 10);
    expect(sexagesimal('-62 40 46', false)).toBeCloseTo(-62.6794, 4);
    expect(sexagesimal('+04 41 36', false)).toBeCloseTo(4.6933, 4);
  });

  it('builds orthonormal galactic axes with the centre in Sagittarius', () => {
    const g = galacticAxes();
    for (const axis of [g.x, g.y, g.z]) expect(length(axis)).toBeCloseTo(1, 10);
    expect(dot(g.x, g.z)).toBeCloseTo(0, 10);
    expect(dot(g.x, g.y)).toBeCloseTo(0, 10);
    // The Galactic Centre is about 5.6 degrees south of the ecliptic at longitude 266.8.
    expect(angleGap(longitude(g.x), 266.8)).toBeLessThan(1);
    expect((Math.asin(g.x[2]) * 180) / Math.PI).toBeCloseTo(-5.6, 0);
  });

  it('turns Earth with sidereal time', () => {
    expect(gmstDeg(new Date('2000-01-01T12:00Z'))).toBeCloseTo(280.4606, 3);
    const axes = bodyAxes(0, 90, 0);
    expect(axes.x[0]).toBeCloseTo(1, 10);
    expect(dot(axes.y, equatorialToEcliptic(equatorialUnit(0, 90)))).toBeCloseTo(1, 10);
    expect(dot(axes.x, axes.y)).toBeCloseTo(0, 10);
  });
});

describe('world', () => {
  const world = computeWorld(new Date('2026-10-14T12:00Z'));

  it('places every object', () => {
    for (const object of SPACE_OBJECTS) expect(world.positions.has(object.id)).toBe(true);
  });

  it('keeps moons at their real distance from their planet', () => {
    for (const object of SPACE_OBJECTS) {
      if (object.placement.type !== 'satellite') continue;
      const gap = length(
        sub(world.positions.get(object.id)!, world.positions.get(object.placement.parent)!),
      );
      expect(gap / object.distanceM).toBeCloseTo(1, 6);
    }
  });

  it('puts the stars at their quoted distance', () => {
    const sirius = world.positions.get('sirius')!;
    expect(length(sirius) / M_PER_LY).toBeCloseTo(8.6, 6);
  });

  it('gives every body with a surface a spin axis', () => {
    for (const object of SPACE_OBJECTS) {
      if (object.radiusKm) expect(world.axes.has(object.id)).toBe(true);
    }
  });
});
