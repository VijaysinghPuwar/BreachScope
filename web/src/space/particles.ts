// Point clouds for the Space view. All are seeded, so they look the same every time.
// These show structure and spread, not real catalogued objects, and the UI says so.

import * as THREE from 'three';

export function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(next: () => number) {
  const u = Math.max(1e-9, next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

function geometry(positions: number[], colours?: number[]) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours) result.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return result;
}

const SUN_RADIUS_LY = 26_000;
/** Pitch angle of the spiral arms, about 12 degrees (Vallee 2017 gives 12 to 13). */
const ARM_K = Math.tan((12 * Math.PI) / 180);
/** Radius of the Perseus arm at the Sun's azimuth; the other arms are the same spiral turned. */
const PERSEUS_AT_SUN_LY = 33_000;
const DISC_RADIUS_LY = 50_000;

/**
 * A model of the Milky Way in light-years, centred on the Galactic Centre. Axes follow
 * the engine's plane convention: x towards the Sun-to-centre direction, y up out of the
 * disc (north galactic pole), z completing the set. The Sun sits at x = -26,000.
 */
export function buildMilkyWay(seed: number): THREE.BufferGeometry {
  const next = random(seed);
  const positions: number[] = [];
  const colours: number[] = [];
  const push = (x: number, y: number, h: number, colour: THREE.Color, dim: number) => {
    // Galactic (x, y, height) to the plane frame (x, up, -y).
    positions.push(x, h, -y);
    colours.push(colour.r * dim, colour.g * dim, colour.b * dim);
  };
  const warm = new THREE.Color('#d9ccb4');
  const arm = new THREE.Color('#c9d3e8');
  const young = new THREE.Color('#dcc7c0');
  const diffuse = new THREE.Color('#aeb2ba');

  // Arms: four turns of one log spiral. The Sun's azimuth is pi (it sits at -x).
  for (let n = 0; n < 42_000; n++) {
    const which = Math.floor(next() * 4);
    const r = 4_000 + (DISC_RADIUS_LY - 4_000) * Math.sqrt(next());
    const theta = Math.PI + Math.log(r / PERSEUS_AT_SUN_LY) / ARM_K + (which * Math.PI) / 2;
    const spread = 600 + 0.08 * r;
    const x = r * Math.cos(theta) + gaussian(next) * spread;
    const y = r * Math.sin(theta) + gaussian(next) * spread;
    const h = gaussian(next) * 350;
    const fade = 0.55 + 0.45 * (1 - r / DISC_RADIUS_LY);
    push(x, y, h, next() < 0.15 ? young : arm, fade);
  }
  // Smooth disc: exponential with a scale length of about 11,000 ly.
  for (let n = 0; n < 16_000; n++) {
    const r = Math.min(DISC_RADIUS_LY, -11_000 * Math.log(Math.max(1e-6, next())));
    const theta = next() * Math.PI * 2;
    push(r * Math.cos(theta), r * Math.sin(theta), gaussian(next) * 900, diffuse, 0.6);
  }
  // Bulge and bar: about 15,000 ly long, about 27 degrees from the Sun-centre line.
  const barAngle = (27 * Math.PI) / 180;
  for (let n = 0; n < 6_000; n++) {
    const a = gaussian(next) * 4_500;
    const b = gaussian(next) * 1_600;
    const h = gaussian(next) * 1_200;
    push(
      a * Math.cos(barAngle) - b * Math.sin(barAngle),
      a * Math.sin(barAngle) + b * Math.cos(barAngle),
      h,
      warm,
      0.62,
    );
  }
  return geometry(positions, colours);
}

/** The Sun's place in the buildMilkyWay frame, in light-years. */
export const SUN_IN_GALAXY_LY: [number, number, number] = [-SUN_RADIUS_LY, 0, 0];

/** A belt of small bodies around the Sun, in AU, in the ecliptic (y up). */
export function buildBelt(
  innerAu: number,
  outerAu: number,
  tiltDeg: number,
  seed: number,
): THREE.BufferGeometry {
  const next = random(seed);
  const positions: number[] = [];
  for (let n = 0; n < 2_500; n++) {
    const r = innerAu + (outerAu - innerAu) * (0.5 + gaussian(next) * 0.22);
    const theta = next() * Math.PI * 2;
    const tilt = (gaussian(next) * tiltDeg * Math.PI) / 360;
    const node = next() * Math.PI * 2;
    positions.push(
      r * Math.cos(theta),
      r * Math.sin(tilt) * Math.sin(theta - node),
      -r * Math.sin(theta),
    );
  }
  return geometry(positions);
}

/** Galaxies of a cluster in a unit sphere, packed towards the centre. */
export function buildCluster(seed: number): THREE.BufferGeometry {
  const next = random(seed);
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color('#e3d4b8');
  for (let n = 0; n < 140; n++) {
    const r = next() ** 1.8;
    const u = next() * 2 - 1;
    const phi = next() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions.push(r * s * Math.cos(phi), r * u, r * s * Math.sin(phi));
    const dim = 0.6 + 0.4 * next();
    colours.push(colour.r * dim, colour.g * dim, colour.b * dim);
  }
  return geometry(positions, colours);
}
