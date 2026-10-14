// Astronomy maths for the Space view. Pure functions in float64, no three.js.
//
// World frame: heliocentric, J2000 ecliptic, metres. x points to the March equinox,
// y to ecliptic longitude 90, z to the north ecliptic pole. scene.ts converts this to
// three.js axes (y up) with toThree().

import { M_PER_AU } from './data';

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;
/** Obliquity of the ecliptic at J2000 (IAU 1976, 84381.448 arcsec), degrees. */
export const OBLIQUITY_DEG = 23.4392911;
const J2000 = 2_451_545.0;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

export function julianDate(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Julian centuries since J2000.0. */
export function centuries(date: Date): number {
  return (julianDate(date) - J2000) / 36_525;
}

/** Unit vector in the equatorial frame for right ascension and declination in degrees. */
export function equatorialUnit(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Rotates an equatorial vector into the ecliptic frame. */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  const e = OBLIQUITY_DEG * DEG;
  return [v[0], Math.cos(e) * v[1] + Math.sin(e) * v[2], -Math.sin(e) * v[1] + Math.cos(e) * v[2]];
}

/** Sky position (J2000 RA/Dec) at a distance, as an ecliptic world vector in metres. */
export function skyPosition(raDeg: number, decDeg: number, distanceM: number): Vec3 {
  return scale(equatorialToEcliptic(equatorialUnit(raDeg, decDeg)), distanceM);
}

/** Parses "14 29 42.9" style sexagesimal into degrees. Hours when `hours` is true. */
export function sexagesimal(text: string, hours: boolean): number {
  const sign = text.trim().startsWith('-') ? -1 : 1;
  const [a = 0, b = 0, c = 0] = text.replace(/^[+-]/, '').trim().split(/\s+/).map(Number);
  const value = a + b / 60 + c / 3600;
  return sign * value * (hours ? 15 : 1);
}

/** JPL Keplerian elements: value at J2000 and rate per century. Angles in degrees, a in AU. */
export interface KeplerElements {
  a: [number, number];
  e: [number, number];
  i: [number, number];
  /** Mean longitude. */
  L: [number, number];
  /** Longitude of perihelion. */
  peri: [number, number];
  /** Longitude of the ascending node. */
  node: [number, number];
}

interface Orbit {
  a: number;
  e: number;
  i: number;
  omega: number;
  node: number;
  meanAnomaly: number;
}

function orbitAt(el: KeplerElements, T: number): Orbit {
  const at = ([value, rate]: [number, number]) => value + rate * T;
  const peri = at(el.peri);
  const node = at(el.node);
  let M = (at(el.L) - peri) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  return {
    a: at(el.a),
    e: at(el.e),
    i: at(el.i) * DEG,
    omega: (peri - node) * DEG,
    node: node * DEG,
    meanAnomaly: M * DEG,
  };
}

/** Solves Kepler's equation M = E - e sin E by Newton's method. Radians. */
export function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : M < 0 ? -Math.PI : Math.PI;
  for (let step = 0; step < 30; step++) {
    const delta = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return E;
}

/** Position in the orbital plane to ecliptic coordinates, in AU. */
function orbitPoint(orbit: Orbit, E: number): Vec3 {
  const { a, e, i, omega, node } = orbit;
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cn, sn, ci, si] = [
    Math.cos(omega),
    Math.sin(omega),
    Math.cos(node),
    Math.sin(node),
    Math.cos(i),
    Math.sin(i),
  ];
  return [
    (cw * cn - sw * sn * ci) * x + (-sw * cn - cw * sn * ci) * y,
    (cw * sn + sw * cn * ci) * x + (-sw * sn + cw * cn * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

/** Heliocentric ecliptic position in metres. */
export function planetPosition(el: KeplerElements, date: Date): Vec3 {
  const orbit = orbitAt(el, centuries(date));
  return scale(orbitPoint(orbit, eccentricAnomaly(orbit.meanAnomaly, orbit.e)), M_PER_AU);
}

/** The full orbit as a closed loop of points, in AU, for drawing. */
export function orbitPath(el: KeplerElements, date: Date, segments = 1024): Vec3[] {
  const orbit = orbitAt(el, centuries(date));
  const points: Vec3[] = [];
  for (let k = 0; k <= segments; k++) points.push(orbitPoint(orbit, (k / segments) * Math.PI * 2));
  return points;
}

const EARTH_RADIUS_M = 6_378_137;
const sinDeg = (x: number) => Math.sin(x * DEG);
const cosDeg = (x: number) => Math.cos(x * DEG);

/** Geocentric ecliptic Moon position in metres (Astronomical Almanac low-precision formula, about 0.3 degrees). */
export function moonPosition(date: Date): Vec3 {
  const T = centuries(date);
  const lambda =
    218.32 +
    481_267.881 * T +
    6.29 * sinDeg(135.0 + 477_198.87 * T) -
    1.27 * sinDeg(259.3 - 413_335.36 * T) +
    0.66 * sinDeg(235.7 + 890_534.22 * T) +
    0.21 * sinDeg(269.9 + 954_397.74 * T) -
    0.19 * sinDeg(357.5 + 35_999.05 * T) -
    0.11 * sinDeg(186.5 + 966_404.03 * T);
  const beta =
    5.13 * sinDeg(93.3 + 483_202.02 * T) +
    0.28 * sinDeg(228.2 + 960_400.89 * T) -
    0.28 * sinDeg(318.3 + 6_003.15 * T) -
    0.17 * sinDeg(217.6 - 407_332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cosDeg(135.0 + 477_198.87 * T) +
    0.0095 * cosDeg(259.3 - 413_335.36 * T) +
    0.0078 * cosDeg(235.7 + 890_534.22 * T) +
    0.0028 * cosDeg(269.9 + 954_397.74 * T);
  const r = EARTH_RADIUS_M / sinDeg(parallax);
  return [r * cosDeg(beta) * cosDeg(lambda), r * cosDeg(beta) * sinDeg(lambda), r * sinDeg(beta)];
}

/** Earth-Moon mass ratio (IAU 2009). The JPL elements track the Earth-Moon barycentre. */
const EARTH_MOON_RATIO = 81.300_568;

export function earthFromBarycentre(barycentre: Vec3, moonGeocentric: Vec3): Vec3 {
  return sub(barycentre, scale(moonGeocentric, 1 / (1 + EARTH_MOON_RATIO)));
}

/** Greenwich mean sidereal time in degrees. */
export function gmstDeg(date: Date): number {
  const d = julianDate(date) - J2000;
  return (((280.460_618_37 + 360.985_647_366_29 * d) % 360) + 360) % 360;
}

/**
 * Body-fixed axes in the ecliptic frame: x towards longitude 0 on the equator,
 * y towards the north pole, z completing a right-handed set (towards longitude 90 W).
 * `primeDeg` is the right ascension of the prime meridian; use gmstDeg for Earth.
 */
export function bodyAxes(poleRaDeg: number, poleDecDeg: number, primeDeg: number) {
  const pole = equatorialToEcliptic(equatorialUnit(poleRaDeg, poleDecDeg));
  // The ascending node of the body's equator on the J2000 equator is at RA = poleRa + 90.
  const nodeDir = equatorialToEcliptic(equatorialUnit(poleRaDeg + 90, 0));
  const eastOfNode = cross(pole, nodeDir);
  const w = (primeDeg - (poleRaDeg + 90)) * DEG;
  const x = add(scale(nodeDir, Math.cos(w)), scale(eastOfNode, Math.sin(w)));
  return { x: normalize(x), y: pole, z: normalize(cross(x, pole)) };
}

/** Galactic frame: x from the Sun towards the Galactic Centre, z to the north galactic pole. */
export function galacticAxes() {
  const z = equatorialToEcliptic(equatorialUnit(192.859_48, 27.128_25));
  const towardsCentre = equatorialToEcliptic(equatorialUnit(266.416_83, -29.007_81));
  // Remove the small tilt so the axes are exactly orthogonal.
  const x = normalize(sub(towardsCentre, scale(z, dot(towardsCentre, z))));
  return { x, y: cross(z, x), z };
}

/** Converts an ecliptic world vector to three.js axes (y up). */
export function toThree(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}
