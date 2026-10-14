// Where everything is on a given date, in the heliocentric ecliptic frame (metres).

import {
  add,
  bodyAxes,
  cross,
  earthFromBarycentre,
  galacticAxes,
  gmstDeg,
  julianDate,
  moonPosition,
  normalize,
  planetPosition,
  scale,
  sexagesimal,
  skyPosition,
  type KeplerElements,
  type Vec3,
} from './astro';
import { SPACE_OBJECTS, objectById, type SpaceObject } from './data';

/** JPL Table 1, Earth-Moon barycentre. */
export const EARTH_MOON_BARYCENTRE: KeplerElements = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  i: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0, 0],
};

/** IAU WGCCRE 2015 prime meridian: W = W0 + rate * days since J2000. Degrees. */
const ROTATION: Record<string, [number, number]> = {
  sun: [84.176, 14.1844],
  mercury: [329.5469, 6.1385025],
  venus: [160.2, -1.4813688],
  moon: [38.3213, 13.17635815],
  mars: [176.63, 350.89198226],
  jupiter: [284.95, 870.536],
  saturn: [38.9, 810.7939024],
  uranus: [203.81, -501.1600928],
  neptune: [249.978, 541.1397757],
  pluto: [302.695, 56.3625225],
};

export type Axes = ReturnType<typeof bodyAxes>;

export interface World {
  date: Date;
  positions: Map<string, Vec3>;
  /** Spin axes for bodies with a surface. */
  axes: Map<string, Axes>;
  /** Orbit plane for moons and Earth orbits: x and y span the plane. */
  planes: Map<string, { x: Vec3; y: Vec3 }>;
  galactic: ReturnType<typeof galacticAxes>;
}

const galactic = galacticAxes();
const SKY = new Map<string, Vec3>();

function skyCached(object: SpaceObject & { placement: { type: 'sky' } }): Vec3 {
  let value = SKY.get(object.id);
  if (!value) {
    value = skyPosition(
      sexagesimal(object.placement.ra, true),
      sexagesimal(object.placement.dec, false),
      object.distanceM,
    );
    SKY.set(object.id, value);
  }
  return value;
}

/** A non-rotating frame in the body's equator, for orbits around it. */
function equatorPlane(pole: [number, number]) {
  const axes = bodyAxes(pole[0], pole[1], pole[0] + 90);
  return { x: axes.x, y: cross(axes.y, axes.x) };
}

export function computeWorld(date: Date): World {
  const days = julianDate(date) - 2_451_545;
  const positions = new Map<string, Vec3>();
  const axes = new Map<string, Axes>();
  const planes = new Map<string, { x: Vec3; y: Vec3 }>();

  const moonGeo = moonPosition(date);
  const earth = earthFromBarycentre(planetPosition(EARTH_MOON_BARYCENTRE, date), moonGeo);
  const earthPlane = equatorPlane([0, 90]);

  for (const object of SPACE_OBJECTS) {
    const placement = object.placement;
    switch (placement.type) {
      case 'sun':
        positions.set(object.id, [0, 0, 0]);
        break;
      case 'earth':
        positions.set(object.id, earth);
        break;
      case 'moon': {
        positions.set(object.id, add(earth, moonGeo));
        // The orbit plane from two positions an hour apart.
        const later = moonPosition(new Date(date.getTime() + 3_600_000));
        const normal = normalize(cross(moonGeo, later));
        const x = normalize(moonGeo);
        planes.set(object.id, { x, y: cross(normal, x) });
        break;
      }
      case 'l2':
        positions.set(object.id, add(earth, scale(normalize(earth), object.distanceM)));
        break;
      case 'kepler':
        positions.set(object.id, planetPosition(placement.elements, date));
        break;
      case 'earth-orbit': {
        positions.set(object.id, earth);
        const tilt = (placement.inclinationDeg * Math.PI) / 180;
        const y = add(
          scale(earthPlane.y, Math.cos(tilt)),
          scale(cross(earthPlane.x, earthPlane.y), Math.sin(tilt)),
        );
        planes.set(object.id, { x: earthPlane.x, y });
        break;
      }
      case 'shell':
      case 'belt':
        positions.set(object.id, [0, 0, 0]);
        break;
      case 'sky':
        positions.set(object.id, skyCached(object as SpaceObject & { placement: { type: 'sky' } }));
        break;
      case 'satellite':
        break;
    }
  }

  // Moons of other planets after their parents are placed.
  for (const object of SPACE_OBJECTS) {
    const placement = object.placement;
    if (placement.type !== 'satellite') continue;
    const parent = objectById.get(placement.parent);
    const parentPosition = positions.get(placement.parent);
    if (!parent?.pole || !parentPosition) continue;
    const plane = equatorPlane(parent.pole);
    const angle = ((placement.phaseDeg + (360 * days) / placement.periodDays) * Math.PI) / 180;
    const offset = add(
      scale(plane.x, Math.cos(angle) * object.distanceM),
      scale(plane.y, Math.sin(angle) * object.distanceM),
    );
    positions.set(object.id, add(parentPosition, offset));
    planes.set(object.id, plane);
  }

  for (const object of SPACE_OBJECTS) {
    if (!object.radiusKm) continue;
    const pole =
      object.pole ??
      (object.placement.type === 'satellite'
        ? objectById.get(object.placement.parent)?.pole
        : undefined) ??
      ([0, 90] as [number, number]);
    let prime = 0;
    if (object.id === 'earth') prime = gmstDeg(date);
    else {
      const rotation = ROTATION[object.id];
      if (rotation) prime = pole[0] + 90 + rotation[0] + rotation[1] * days;
    }
    axes.set(object.id, bodyAxes(pole[0], pole[1], prime));
  }

  return { date, positions, axes, planes, galactic };
}
