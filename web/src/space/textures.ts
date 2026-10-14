// Procedural textures for the space view. Everything is drawn with Canvas 2D ImageData loops,
// seeded so every run produces the same pixels. Planet maps are equirectangular and sample 3D
// noise on the unit sphere, so there is no seam at longitude +-180 and no pinching at the poles.

export type PlanetSkin =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth-clouds'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'titan'
  | 'triton'
  | 'phobos'
  | 'deimos';

export type GalaxyMorph =
  'spiral' | 'barred' | 'elliptical' | 'irregular' | 'edge-on' | 'dust-lane' | 'dwarf';

export const RING_INNER_KM = 74_658;
export const RING_OUTER_KM = 136_775;

const DEG = Math.PI / 180;

type RGB = readonly [number, number, number];
/** [latitude deg, r, g, b] */
type Stop = readonly [number, number, number, number];

// ---------------------------------------------------------------------------------------------
// Seeded randomness and noise

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 3D value noise with a seeded permutation table. Output is in [0, 1]. */
class Noise3 {
  private readonly p = new Uint8Array(512);
  /** Lattice values pre-permuted (h[i] = values[p[i]]) to save one lookup per corner. */
  private readonly h = new Float32Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = t;
    }
    const v = new Float32Array(256);
    for (let i = 0; i < 256; i++) v[i] = rand();
    for (let i = 0; i < 512; i++) {
      this.p[i] = perm[i & 255]!;
      this.h[i] = v[this.p[i]!]!;
    }
  }

  at(x: number, y: number, z: number): number {
    // Inputs stay far above -4096, so `| 0` acts as floor after the shift.
    x += 4096;
    y += 4096;
    z += 4096;
    const fx = x | 0;
    const fy = y | 0;
    const fz = z | 0;
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    const u = x - fx;
    const w = y - fy;
    const t = z - fz;
    // Quintic fade keeps the first and second derivatives continuous across cells.
    const su = u * u * u * (u * (u * 6 - 15) + 10);
    const sw = w * w * w * (w * (w * 6 - 15) + 10);
    const st = t * t * t * (t * (t * 6 - 15) + 10);
    const p = this.p;
    const h = this.h;
    // Indices stay below 512: p values are at most 255 and so are X, Y and Z.
    const A = p[X]! + Y;
    const B = p[X + 1]! + Y;
    const AA = p[A]! + Z;
    const AB = p[A + 1]! + Z;
    const BA = p[B]! + Z;
    const BB = p[B + 1]! + Z;
    const a0 = h[AA]!;
    const a1 = h[AA + 1]!;
    const b0 = h[BA]!;
    const b1 = h[BA + 1]!;
    const c0 = h[AB]!;
    const c1 = h[AB + 1]!;
    const d0 = h[BB]!;
    const d1 = h[BB + 1]!;
    const x00 = a0 + (b0 - a0) * su;
    const x10 = c0 + (d0 - c0) * su;
    const x01 = a1 + (b1 - a1) * su;
    const x11 = c1 + (d1 - c1) * su;
    const y0 = x00 + (x10 - x00) * sw;
    const y1 = x01 + (x11 - x01) * sw;
    return y0 + (y1 - y0) * st;
  }

  /** Fractal sum of octaves, normalised to [0, 1]. Mean 0.5, typical spread about +-0.13. */
  fbm(x: number, y: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      // Offsetting each octave avoids lattice points lining up at the origin.
      sum += amp * this.at(x * f + i * 17.31, y * f + i * 5.17, z * f + i * 11.73);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
}

// ---------------------------------------------------------------------------------------------
// Small math and colour helpers

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

interface Out {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Unit-sphere position plus lat/lon in degrees for the current pixel. */
interface P {
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
}

function setC(o: Out, c: RGB, k = 1): void {
  o.r = c[0] * k;
  o.g = c[1] * k;
  o.b = c[2] * k;
}

function mixC(o: Out, c: RGB, t: number): void {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  o.r += (c[0] - o.r) * k;
  o.g += (c[1] - o.g) * k;
  o.b += (c[2] - o.b) * k;
}

function scaleC(o: Out, k: number): void {
  o.r *= k;
  o.g *= k;
  o.b *= k;
}

/** Piecewise linear colour by latitude. Stops must be sorted by latitude. */
function stops(o: Out, table: readonly Stop[], lat: number): void {
  const first = table[0]!;
  if (lat <= first[0]) {
    o.r = first[1];
    o.g = first[2];
    o.b = first[3];
    return;
  }
  for (let i = 1; i < table.length; i++) {
    const s1 = table[i]!;
    if (lat <= s1[0]) {
      const s0 = table[i - 1]!;
      const t = (lat - s0[0]) / (s1[0] - s0[0]);
      o.r = s0[1] + (s1[1] - s0[1]) * t;
      o.g = s0[2] + (s1[2] - s0[2]) * t;
      o.b = s0[3] + (s1[3] - s0[3]) * t;
      return;
    }
  }
  const last = table[table.length - 1]!;
  o.r = last[1];
  o.g = last[2];
  o.b = last[3];
}

type Vec3 = readonly [number, number, number];

/** Same convention as the pixel grid: y is up, longitude 0 points along +x. */
function unitVec(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
}

interface Blob {
  v: Vec3;
  /** cos of outer and inner radius, so the mask is a smoothstep on the dot product. */
  c0: number;
  c1: number;
}

function blob(latDeg: number, lonDeg: number, radiusDeg: number, softDeg: number): Blob {
  return {
    v: unitVec(latDeg, lonDeg),
    c0: Math.cos((radiusDeg + softDeg) * DEG),
    c1: Math.cos(Math.max(0, radiusDeg - softDeg) * DEG),
  };
}

/** Max of soft circular caps. `jitter` perturbs the edges (dot-product units). */
function blobMask(p: P, blobs: readonly Blob[], jitter: number): number {
  let m = 0;
  for (const b of blobs) {
    const d = p.x * b.v[0] + p.y * b.v[1] + p.z * b.v[2] + jitter;
    if (d <= b.c0) continue;
    const s = smooth(b.c0, b.c1, d);
    if (s > m) m = s;
  }
  return m;
}

/** Normalised elliptical distance in degrees, wrapping longitude. 1 = on the edge. */
function ellipse(p: P, lat0: number, lon0: number, aLon: number, bLat: number): number {
  const dy = (p.lat - lat0) / bLat;
  // Most pixels are far away in latitude; skip the trig for them.
  if (dy > 3 || dy < -3) return Math.abs(dy);
  let dl = p.lon - lon0;
  dl = ((dl + 540) % 360) - 180;
  const dx = (dl * Math.cos(lat0 * DEG)) / aLon;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------------------------
// Canvas and sphere grid

function makeCanvas(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return { canvas, ctx };
}

interface Grid {
  w: number;
  h: number;
  latS: Float64Array;
  latC: Float64Array;
  lonS: Float64Array;
  lonC: Float64Array;
  lonDeg: Float64Array;
}

function makeGrid(w: number, h: number): Grid {
  const latS = new Float64Array(h);
  const latC = new Float64Array(h);
  const lonS = new Float64Array(w);
  const lonC = new Float64Array(w);
  const lonDeg = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
    latS[y] = Math.sin(lat);
    latC[y] = Math.cos(lat);
  }
  for (let x = 0; x < w; x++) {
    const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
    lonS[x] = Math.sin(lon);
    lonC[x] = Math.cos(lon);
    lonDeg[x] = lon / DEG;
  }
  return { w, h, latS, latC, lonS, lonC, lonDeg };
}

interface Ctx {
  data: Uint8ClampedArray;
  g: Grid;
  n: Noise3;
  rand: () => number;
}

type Shade = (o: Out, p: P, i: number) => void;

function paint(c: Ctx, fn: Shade): void {
  const { data, g } = c;
  const { w, h } = g;
  const o: Out = { r: 0, g: 0, b: 0, a: 255 };
  const p: P = { x: 0, y: 0, z: 0, lat: 0, lon: 0 };
  for (let y = 0; y < h; y++) {
    const sl = g.latS[y]!;
    const cl = g.latC[y]!;
    p.y = sl;
    p.lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      p.x = cl * g.lonC[x]!;
      p.z = cl * g.lonS[x]!;
      p.lon = g.lonDeg[x]!;
      o.a = 255;
      const i = y * w + x;
      fn(o, p, i);
      const k = i * 4;
      data[k] = o.r;
      data[k + 1] = o.g;
      data[k + 2] = o.b;
      data[k + 3] = o.a;
    }
  }
}

/**
 * Visit every pixel inside a spherical cap. `s` is angular distance divided by the radius,
 * so 0 at the centre and 1 at the edge. Handles longitude wrap and caps over a pole.
 */
function forCap(
  g: Grid,
  latRad: number,
  lonRad: number,
  radius: number,
  fn: (idx: number, s: number) => void,
): void {
  const { w, h } = g;
  const cl0 = Math.cos(latRad);
  const cx = cl0 * Math.cos(lonRad);
  const cy = Math.sin(latRad);
  const cz = cl0 * Math.sin(lonRad);
  const cosR = Math.cos(radius);
  const top = latRad + radius;
  const bottom = latRad - radius;
  const y0 = Math.max(0, Math.floor(((Math.PI / 2 - top) / Math.PI) * h) - 1);
  const y1 = Math.min(h - 1, Math.ceil(((Math.PI / 2 - bottom) / Math.PI) * h) + 1);
  // Widest longitude half-span of the cap; covers every row of it.
  const overPole = top > Math.PI / 2 || bottom < -Math.PI / 2;
  const sinRatio = Math.sin(radius) / Math.max(1e-6, cl0);
  const full = overPole || sinRatio >= 1;
  const half = full ? w : (Math.asin(sinRatio) / (Math.PI * 2)) * w + 2;
  const xc = ((lonRad + Math.PI) / (Math.PI * 2)) * w;
  const xa = full || half * 2 >= w ? 0 : Math.floor(xc - half);
  const xb = full || half * 2 >= w ? w - 1 : Math.ceil(xc + half);
  for (let y = y0; y <= y1; y++) {
    const cl = g.latC[y]!;
    const sl = g.latS[y]! * cy;
    for (let xx = xa; xx <= xb; xx++) {
      const x = ((xx % w) + w) % w;
      const d = cl * (g.lonC[x]! * cx + g.lonS[x]! * cz) + sl;
      if (d < cosR) continue;
      fn(y * w + x, Math.acos(d > 1 ? 1 : d) / radius);
    }
  }
}

function blendAt(data: Uint8ClampedArray, idx: number, c: RGB, t: number): void {
  if (t <= 0) return;
  const k = idx * 4;
  const a = t > 1 ? 1 : t;
  data[k] = data[k]! + (c[0] - data[k]!) * a;
  data[k + 1] = data[k + 1]! + (c[1] - data[k + 1]!) * a;
  data[k + 2] = data[k + 2]! + (c[2] - data[k + 2]!) * a;
}

/** Random point on the sphere, uniform by area. Returns [latRad, lonRad]. */
function randomPoint(rand: () => number, maxLatDeg = 90): [number, number] {
  const lim = Math.sin(maxLatDeg * DEG);
  return [Math.asin((rand() * 2 - 1) * lim), rand() * Math.PI * 2 - Math.PI];
}

// ---------------------------------------------------------------------------------------------
// Craters: a height field, then a fixed-direction hillshade multiplied into the albedo

interface CraterOpts {
  count: number;
  /** Angular radius range in radians. Sizes follow a steep power law (many small, few big). */
  rMin: number;
  rMax: number;
  relief: number;
  /** Share of craters that get a bright, fresh interior. */
  fresh?: number;
  bright?: number;
  /** Per-pixel multiplier on relief, e.g. smoother maria. */
  strength?: Float32Array;
  /** Named craters: [lat deg, lon deg, radius rad]. */
  extra?: readonly (readonly [number, number, number])[];
}

function craters(c: Ctx, opts: CraterOpts): void {
  const { g, rand } = c;
  const { w, h } = g;
  const H = new Float32Array(w * h);
  const A = new Float32Array(w * h);
  const pxPerRad = h / Math.PI;
  const fresh = opts.fresh ?? 0;
  const bright = opts.bright ?? 0;

  const one = (lat: number, lon: number, r: number, isFresh: boolean): void => {
    const rPx = r * pxPerRad;
    // Big craters are shallower relative to their size.
    const depth = (rPx * 0.26) / (1 + rPx / 16);
    const rim = depth * 0.2;
    forCap(g, lat, lon, r * 1.5, (idx, s15) => {
      const s = s15 * 1.5;
      let v: number;
      if (s < 1) v = depth * (s * s - 1) + rim * s * s * s * s;
      else {
        const t = 1 - (s - 1) / 0.5;
        v = rim * t * t;
      }
      H[idx] = H[idx]! + v;
      if (isFresh && s < 1.15) A[idx] = A[idx]! + bright * (1 - s / 1.15);
    });
  };

  for (const e of opts.extra ?? []) one(e[0] * DEG, e[1] * DEG, e[2], false);
  const ratio = opts.rMax / opts.rMin;
  for (let i = 0; i < opts.count; i++) {
    const r = opts.rMin * Math.pow(ratio, Math.pow(rand(), 4.5));
    const [lat, lon] = randomPoint(rand);
    one(lat, lon, r, rand() < fresh && r < opts.rMin * 6);
  }

  const { data } = c;
  const k = opts.relief;
  const st = opts.strength;
  for (let y = 0; y < h; y++) {
    const cl = Math.max(0.15, g.latC[y]!);
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = x > 0 ? x - 1 : w - 1;
      const xr = x < w - 1 ? x + 1 : 0;
      // Slopes in true surface units: an x step is shorter by cos(lat) on the sphere.
      const dx = (H[y * w + xr]! - H[y * w + xl]!) / (2 * cl);
      const dy = (H[yd * w + x]! - H[yu * w + x]!) / 2;
      // Light from the upper left (north-west).
      let shade = (dx + dy) * 0.7 * k * (st ? st[i]! : 1);
      shade = shade < -0.45 ? -0.45 : shade > 0.45 ? 0.45 : shade;
      const m = (1 + shade) * (1 + A[i]!);
      const q = i * 4;
      data[q] = data[q]! * m;
      data[q + 1] = data[q + 1]! * m;
      data[q + 2] = data[q + 2]! * m;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Planet palettes

const SUN: RGB = [241, 228, 198];

const JUPITER: readonly Stop[] = [
  [-90, 140, 134, 124],
  [-62, 156, 148, 134],
  [-50, 190, 176, 152],
  [-43, 170, 146, 116],
  [-36, 214, 200, 176],
  [-30, 176, 146, 112],
  [-25, 226, 212, 188],
  [-19, 224, 210, 184],
  [-16, 168, 128, 92],
  [-9, 174, 134, 98],
  [-6, 224, 204, 168],
  [0, 232, 214, 180],
  [6, 224, 204, 168],
  [9, 160, 118, 86],
  [17, 166, 124, 90],
  [20, 230, 218, 196],
  [24, 224, 212, 188],
  [27, 174, 140, 106],
  [31, 176, 142, 108],
  [34, 216, 204, 182],
  [42, 184, 164, 136],
  [50, 200, 186, 162],
  [62, 156, 148, 134],
  [90, 140, 134, 124],
];

const SATURN: readonly Stop[] = [
  [-90, 170, 168, 150],
  [-70, 188, 180, 150],
  [-55, 212, 194, 150],
  [-40, 200, 180, 136],
  [-28, 220, 200, 156],
  [-18, 206, 184, 140],
  [-8, 230, 212, 170],
  [0, 234, 216, 176],
  [8, 230, 212, 170],
  [18, 208, 186, 140],
  [28, 222, 202, 158],
  [40, 204, 184, 140],
  [55, 210, 192, 150],
  [70, 180, 176, 150],
  [90, 168, 166, 150],
];

const NEPTUNE: readonly Stop[] = [
  [-90, 70, 98, 160],
  [-60, 62, 92, 160],
  [-46, 80, 110, 172],
  [-38, 58, 86, 154],
  [-20, 60, 90, 160],
  [0, 66, 98, 168],
  [20, 60, 90, 160],
  [45, 72, 102, 168],
  [90, 66, 96, 160],
];

const VENUS: readonly Stop[] = [
  [-90, 214, 200, 166],
  [-50, 228, 212, 172],
  [-30, 222, 202, 160],
  [-12, 232, 216, 178],
  [0, 236, 222, 186],
  [12, 230, 214, 174],
  [30, 222, 204, 162],
  [50, 228, 212, 172],
  [90, 214, 200, 166],
];

const MOON_MARIA: readonly Blob[] = [
  blob(20, -55, 18, 9.0),
  blob(-2, -50, 14, 7.0),
  blob(33, -16, 14, 7.0),
  blob(28, 17, 9, 4.5),
  blob(8, 31, 10, 5.0),
  blob(17, 59, 7, 3.5),
  blob(-8, 51, 8, 4.0),
  blob(-15, 35, 5, 2.5),
  blob(-21, -17, 8, 4.0),
  blob(-24, -39, 6, 3.0),
  blob(56, -20, 6, 3.0),
  blob(57, 0, 6, 3.0),
  blob(56, 20, 6, 3.0),
  blob(13, 4, 4, 2.0),
  blob(-10, -23, 5, 2.5),
  blob(7, -31, 7, 3.5),
  blob(27, 147, 4, 2.0),
  blob(-34, 163, 3, 1.5),
  blob(-20, -95, 3, 1.5),
];

const MARS_DARK: readonly Blob[] = [
  blob(10, 70, 10, 6),
  blob(47, -30, 12, 6),
  blob(-25, -40, 14, 7),
  blob(-3, -2, 6, 4),
  blob(-22, 150, 14, 7),
  blob(-20, 105, 10, 6),
  blob(-30, -150, 12, 6),
  blob(45, 115, 9, 6),
];

const PLUTO_HEART: readonly Blob[] = [blob(25, 175, 15, 4), blob(2, -162, 19, 5)];

// ---------------------------------------------------------------------------------------------
// Skins

const SOFT_SKINS: ReadonlySet<PlanetSkin> = new Set<PlanetSkin>([
  'venus',
  'saturn',
  'uranus',
  'neptune',
  'titan',
]);

const SKINS: Record<PlanetSkin, (c: Ctx) => void> = {
  sun(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const gran = n.fbm(p.x * 40, p.y * 40, p.z * 40, 2);
      const sup = n.at(p.x * 9 + 31, p.y * 9, p.z * 9);
      setC(o, SUN, 1 + (gran - 0.5) * 0.08 + (sup - 0.5) * 0.03);
    });
  },

  mercury(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 2.5, p.y * 2.5, p.z * 2.5, 4);
      const b = n.at(p.x * 9 + 7, p.y * 9, p.z * 9);
      setC(o, [134, 124, 112], 1 + (a - 0.5) * 0.6 + (b - 0.5) * 0.18);
      mixC(o, [98, 96, 96], smooth(0.48, 0.36, a) * 0.5);
    });
    craters(c, {
      count: 1100,
      rMin: 0.008,
      rMax: 0.22,
      relief: 0.34,
      fresh: 0.2,
      bright: 0.25,
    });
  },

  venus(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const warp = n.fbm(p.x * 2, p.y * 7, p.z * 2, 3);
      stops(o, VENUS, p.lat + (warp - 0.5) * 18);
      const soft = n.fbm(p.x * 3 + 9, p.y * 5, p.z * 3, 2);
      scaleC(o, 1 + (soft - 0.5) * 0.08);
    });
  },

  'earth-clouds'(c) {
    const n = c.n;
    paint(c, (o, p) => {
      // Domain warp gives curled, sheared cloud shapes instead of round blobs.
      const q = n.fbm(p.x * 1.5, p.y * 1.5, p.z * 1.5, 2) - 0.5;
      const v = n.fbm(p.x * 3 + q * 2.4, p.y * 4 + q * 2.4, p.z * 3 - q * 2.4, 4);
      const al = Math.abs(p.lat);
      // More cloud at the ITCZ and the mid-latitude storm tracks, less over the subtropics.
      const band = 0.8 + 0.12 * smooth(12, 2, al) + 0.2 * smooth(35, 55, al) * smooth(80, 62, al);
      const t = smooth(0.5, 0.7, v * band + 0.1);
      o.r = 248;
      o.g = 248;
      o.b = 246;
      o.a = t * 215;
    });
  },

  moon(c) {
    const n = c.n;
    const strength = new Float32Array(c.g.w * c.g.h);
    paint(c, (o, p, i) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 4);
      const m = blobMask(p, MOON_MARIA, (a - 0.5) * 0.07);
      strength[i] = 1 - 0.7 * m;
      setC(o, [176, 172, 165], 1 + (a - 0.5) * 0.35);
      mixC(o, [108, 106, 102], m * (0.85 + (a - 0.5) * 0.6));
    });
    craters(c, {
      count: 1400,
      rMin: 0.007,
      rMax: 0.2,
      relief: 0.26,
      fresh: 0.15,
      bright: 0.3,
      strength,
      extra: [[-43, -11, 0.04]],
    });
  },

  mars(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 2.5, p.y * 2.5, p.z * 2.5, 4);
      const b = n.at(p.x * 6 + 4, p.y * 6, p.z * 6);
      const dark = smooth(0.52, 0.72, a + blobMask(p, MARS_DARK, (b - 0.5) * 0.1) * 0.18);
      setC(o, [184, 106, 64], 1 + (b - 0.5) * 0.16);
      mixC(o, [198, 128, 84], smooth(0.5, 0.38, a) * 0.6);
      mixC(o, [118, 74, 52], dark * 0.75);
      // Hellas: bright dusty basin.
      mixC(o, [204, 150, 108], smooth(1.1, 0.6, ellipse(p, -42, 70, 13, 10)) * 0.55);
      // Valles Marineris: a thin dark scar along about 9 S.
      const vm = Math.abs(p.lat + 9 + (b - 0.5) * 3);
      mixC(
        o,
        [92, 58, 42],
        smooth(1.2, 0.2, vm) * smooth(-114, -104, p.lon) * smooth(-36, -46, p.lon) * 0.55,
      );
      const cap = Math.max(
        smooth(80, 84, p.lat + (b - 0.5) * 6),
        smooth(-83, -87, p.lat + (b - 0.5) * 6),
      );
      mixC(o, [236, 230, 222], cap);
    });
    craters(c, { count: 350, rMin: 0.008, rMax: 0.12, relief: 0.18 });
  },

  jupiter(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const turb = n.fbm(p.x * 3, p.y * 12, p.z * 3, 3);
      stops(o, JUPITER, p.lat + (turb - 0.5) * 7);
      const streak = n.fbm(p.x * 8 + 5, p.y * 36, p.z * 8, 2);
      scaleC(o, 0.95 + (streak - 0.5) * 0.3);
      // Great Red Spot with a pale collar.
      const e0 = ellipse(p, -22, -40, 12, 6);
      if (e0 < 1.6) {
        const swirl = n.at(p.x * 20, p.y * 20, p.z * 20);
        const e = e0 + (swirl - 0.5) * 0.12;
        mixC(o, [230, 216, 192], smooth(1.45, 1.1, e) * smooth(0.85, 1.05, e) * 0.7);
        mixC(o, [192, 118, 88], smooth(1.02, 0.7, e) * (0.85 + (swirl - 0.5) * 0.4));
      }
      // A few white ovals in the south temperate belt.
      for (const lon of [60, 95, 150]) {
        mixC(o, [236, 228, 214], smooth(1, 0.6, ellipse(p, -40, lon, 2.6, 1.8)) * 0.8);
      }
    });
  },

  saturn(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const turb = n.fbm(p.x * 3, p.y * 10, p.z * 3, 3);
      stops(o, SATURN, p.lat + (turb - 0.5) * 4);
      const streak = n.fbm(p.x * 6, p.y * 30, p.z * 6, 2);
      scaleC(o, 0.97 + (streak - 0.5) * 0.12);
    });
  },

  uranus(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const v = n.fbm(p.x * 2, p.y * 10, p.z * 2, 3);
      setC(o, [172, 212, 218], 1 + (v - 0.5) * 0.04);
      mixC(o, [188, 222, 224], smooth(-40, -80, p.lat) * 0.5);
    });
  },

  neptune(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const turb = n.fbm(p.x * 3, p.y * 10, p.z * 3, 3);
      stops(o, NEPTUNE, p.lat + (turb - 0.5) * 6);
      const streak = n.fbm(p.x * 5, p.y * 24, p.z * 5, 2);
      scaleC(o, 0.97 + (streak - 0.5) * 0.14);
      mixC(o, [36, 56, 112], smooth(1, 0.6, ellipse(p, -20, 30, 9, 5)) * 0.9);
      mixC(o, [164, 180, 212], smooth(1, 0.3, ellipse(p, -29, 44, 8, 1.4)) * 0.45);
      mixC(o, [150, 168, 204], smooth(1, 0.3, ellipse(p, 26, -100, 14, 1.5)) * 0.3);
      mixC(o, [150, 168, 204], smooth(1, 0.3, ellipse(p, -55, 140, 4, 1.2)) * 0.35);
    });
  },

  pluto(c) {
    const n = c.n;
    const strength = new Float32Array(c.g.w * c.g.h);
    paint(c, (o, p, i) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 3);
      const b = n.fbm(p.x * 5 + 2, p.y * 5, p.z * 5, 2);
      setC(o, [184, 158, 128], 1 + (a - 0.5) * 0.3);
      mixC(o, [152, 142, 134], smooth(0.52, 0.68, a) * 0.6);
      // Cthulhu: dark reddish equatorial band.
      const cth = smooth(1.15, 0.7, ellipse(p, -5, -105, 55, 16) + (b - 0.5) * 1.4);
      mixC(o, [112, 76, 58], cth * 0.75);
      const heart = blobMask(p, PLUTO_HEART, (b - 0.5) * 0.05);
      mixC(o, [234, 226, 214], heart * 0.92);
      mixC(o, [166, 158, 150], smooth(50, 75, p.lat) * 0.5);
      strength[i] = 1 - heart;
    });
    craters(c, { count: 300, rMin: 0.008, rMax: 0.1, relief: 0.2, strength });
  },

  io(c) {
    const { n, rand, data, g } = c;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 3);
      const b = n.fbm(p.x * 7 + 3, p.y * 7, p.z * 7, 2);
      setC(o, [212, 194, 120], 1 + (b - 0.5) * 0.12);
      mixC(o, [198, 148, 84], smooth(0.52, 0.66, a) * 0.7);
      mixC(o, [228, 222, 196], smooth(0.56, 0.68, b) * 0.55);
      mixC(o, [140, 120, 92], smooth(50, 78, Math.abs(p.lat)) * 0.6);
    });
    // Large red plume deposit rings, like Pele.
    for (let i = 0; i < 3; i++) {
      const [lat, lon] = randomPoint(rand, 40);
      const r = (6 + rand() * 3) * DEG;
      forCap(g, lat, lon, r, (idx, s) => {
        blendAt(data, idx, [188, 104, 64], smooth(0.12, 0, Math.abs(s - 0.82)) * 0.4);
      });
    }
    // Volcanic centres: dark cores with orange or brown haloes.
    for (let i = 0; i < 150; i++) {
      const [lat, lon] = randomPoint(rand, 70);
      const r = (0.5 + Math.pow(rand(), 2) * 1.8) * DEG;
      const halo: RGB = rand() < 0.5 ? [176, 98, 60] : [150, 112, 72];
      forCap(g, lat, lon, r * 1.8, (idx, s18) => {
        const s = s18 * 1.8;
        if (s < 0.6) blendAt(data, idx, [54, 40, 32], smooth(0.6, 0.35, s) * 0.9);
        else blendAt(data, idx, halo, (1 - s18) * 0.45);
      });
    }
    // Loki Patera.
    forCap(g, 12 * DEG, -50 * DEG, 3.5 * DEG, (idx, s) => {
      blendAt(data, idx, [48, 38, 30], smooth(1, 0.6, s) * 0.85);
    });
  },

  europa(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 3);
      setC(o, [224, 216, 202], 1 + (a - 0.5) * 0.12);
      mixC(o, [180, 152, 124], smooth(0.52, 0.7, a) * 0.6);
      // Lineae: thin isolines of several noise layers form a web of crossing cracks.
      let line = 0;
      const layers = [
        [4, 0.55, 0.007],
        [7, 0.45, 0.007],
        [13, 0.3, 0.008],
      ] as const;
      for (let k = 0; k < layers.length; k++) {
        const L = layers[k]!;
        const f = L[0];
        const v = n.at(p.x * f + k * 13.7, p.y * f + 3.1, p.z * f - k * 7.9);
        const t = smooth(L[2], 0, Math.abs(v - 0.5)) * L[1];
        if (t > line) line = t;
      }
      mixC(o, [140, 100, 72], line);
    });
  },

  ganymede(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 2.2, p.y * 2.2, p.z * 2.2, 3);
      const light = smooth(0.46, 0.58, a);
      // Grooves: noise squashed along one axis reads as fine parallel lineations.
      const groove = n.at(p.x * 40 + 8, p.y * 40, p.z * 6);
      const b = n.at(p.x * 8, p.y * 8, p.z * 8);
      setC(o, [104, 94, 82], 1 + (b - 0.5) * 0.2);
      mixC(o, [166, 156, 142], light * (0.9 + groove * 0.06));
      scaleC(o, 1 - light * (1 - groove) * 0.04);
      mixC(o, [200, 196, 190], smooth(55, 75, Math.abs(p.lat)) * 0.35);
    });
    craters(c, {
      count: 500,
      rMin: 0.008,
      rMax: 0.14,
      relief: 0.25,
      fresh: 0.25,
      bright: 0.3,
    });
  },

  callisto(c) {
    const { n, data, g } = c;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 3);
      setC(o, [86, 78, 68], 1 + (a - 0.5) * 0.3);
    });
    // Valhalla: bright centre with faint concentric rings.
    forCap(g, 15 * DEG, -57 * DEG, 30 * DEG, (idx, s) => {
      const core = smooth(0.3, 0.1, s) * 0.5;
      const ring = (0.5 + 0.5 * Math.cos(s * 40)) * smooth(1, 0.3, s) * 0.12;
      blendAt(data, idx, [150, 138, 120], Math.max(core, ring));
    });
    craters(c, {
      count: 2600,
      rMin: 0.006,
      rMax: 0.12,
      relief: 0.3,
      fresh: 0.4,
      bright: 0.55,
    });
  },

  titan(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const v = n.fbm(p.x * 2, p.y * 6, p.z * 2, 3);
      setC(o, [194, 144, 86], 1 + (v - 0.5) * 0.06);
      mixC(o, [158, 114, 74], smooth(50, 80, p.lat) * 0.5);
      mixC(o, [204, 156, 98], smooth(-30, -70, p.lat) * 0.3);
    });
  },

  triton(c) {
    const { n, rand, data, g } = c;
    const melon = blob(20, -90, 70, 20);
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 3);
      setC(o, [200, 184, 176], 1 + (a - 0.5) * 0.15);
      // Cantaloupe terrain: ridged noise makes a network of dimples and ridges.
      const c1 = 1 - Math.abs(2 * n.at(p.x * 22, p.y * 22, p.z * 22) - 1);
      const c2 = 1 - Math.abs(2 * n.at(p.x * 45 + 5, p.y * 45, p.z * 45) - 1);
      const m = blobMask(p, [melon], 0);
      scaleC(o, 1 + m * (c1 * 0.6 + c2 * 0.4 - 0.6) * 0.22);
      mixC(o, [226, 208, 198], smooth(-5, -20, p.lat + (a - 0.5) * 16) * 0.8);
    });
    // Dark plume streaks on the southern cap.
    for (let i = 0; i < 40; i++) {
      const lat = -(25 + rand() * 45) * DEG;
      const lon = (rand() * 2 - 1) * Math.PI;
      const r = (0.8 + rand() * 1.4) * DEG;
      forCap(g, lat, lon, r, (idx, s) => blendAt(data, idx, [128, 110, 104], (1 - s) * 0.5));
    }
    craters(c, { count: 120, rMin: 0.008, rMax: 0.06, relief: 0.15 });
  },

  phobos(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 3, p.y * 3, p.z * 3, 4);
      setC(o, [100, 94, 88], 1 + (a - 0.5) * 0.4);
    });
    craters(c, {
      count: 900,
      rMin: 0.01,
      rMax: 0.2,
      relief: 0.38,
      extra: [[-1, -49, 0.38]],
    });
  },

  deimos(c) {
    const n = c.n;
    paint(c, (o, p) => {
      const a = n.fbm(p.x * 2, p.y * 2, p.z * 2, 3);
      setC(o, [120, 112, 102], 1 + (a - 0.5) * 0.25);
    });
    craters(c, { count: 350, rMin: 0.01, rMax: 0.12, relief: 0.22 });
  },
};

/** Equirectangular: x=0 is longitude -180, x=width is +180; y=0 is latitude +90. */
export function planetTexture(skin: PlanetSkin, width = 512): HTMLCanvasElement {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(8, Math.round(w / 2));
  const { canvas, ctx } = makeCanvas(w, h);
  if (!ctx) return canvas;
  // Soft, nearly featureless skins are shaded at half size and upscaled by the canvas.
  // The result looks the same and costs a quarter of the pixel work.
  const half = SOFT_SKINS.has(skin);
  const sw = half ? Math.max(16, w >> 1) : w;
  const sh = half ? Math.max(8, h >> 1) : h;
  const tmp = half ? makeCanvas(sw, sh) : null;
  const target = tmp ? tmp.ctx : ctx;
  if (!target) return canvas;
  const img = target.createImageData(sw, sh);
  const seed = hashString(skin);
  const c: Ctx = {
    data: img.data,
    g: makeGrid(sw, sh),
    n: new Noise3(seed),
    rand: mulberry32(seed ^ 0x9e3779b9),
  };
  SKINS[skin](c);
  target.putImageData(img, 0, 0);
  if (tmp) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp.canvas, 0, 0, w, h);
  }
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Earth

const OCEAN: RGB = [20, 38, 62];
const SHELF: RGB = [30, 58, 84];
const ICE: RGB = [228, 232, 234];
const DESERT: RGB = [184, 160, 114];

const EARTH_LAND: readonly Stop[] = [
  [0, 54, 82, 44],
  [10, 64, 88, 46],
  [16, 104, 106, 68],
  [22, 132, 122, 84],
  [30, 128, 118, 82],
  [36, 98, 98, 62],
  [48, 82, 90, 54],
  [58, 62, 76, 48],
  [65, 100, 98, 80],
  [69, 150, 148, 140],
  [72, 228, 232, 234],
  [90, 228, 232, 234],
];

function earthSize(width: number): [number, number] {
  const w = Math.max(16, Math.round(width));
  return [w, Math.max(8, Math.round(w / 2))];
}

function rgbCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Earth before land data loads: ocean only, same ocean colour as earthTexture. */
export function earthPlaceholder(width = 2048): HTMLCanvasElement {
  const [w, h] = earthSize(width);
  const { canvas, ctx } = makeCanvas(w, h);
  if (!ctx) return canvas;
  ctx.fillStyle = rgbCss(OCEAN);
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

function traceRings(
  ctx: CanvasRenderingContext2D,
  rings: GeoJSON.Position[][],
  w: number,
  h: number,
): void {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i]!;
      const X = (((pt[0] ?? 0) + 180) / 360) * w;
      const Y = ((90 - (pt[1] ?? 0)) / 180) * h;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }
}

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  geom: GeoJSON.Geometry | null,
  w: number,
  h: number,
): void {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    ctx.beginPath();
    traceRings(ctx, geom.coordinates, w, h);
    ctx.fill('evenodd');
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      ctx.beginPath();
      traceRings(ctx, poly, w, h);
      ctx.fill('evenodd');
    }
  } else if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries) drawGeometry(ctx, g, w, h);
  }
}

/** Per output column: left source index, right source index (wrapping) and weight. */
interface UpTable {
  x0: Int32Array;
  x1: Int32Array;
  t: Float32Array;
}

function upTable(src: number, dst: number): UpTable {
  const x0 = new Int32Array(dst);
  const x1 = new Int32Array(dst);
  const t = new Float32Array(dst);
  for (let x = 0; x < dst; x++) {
    const u = ((x + 0.5) * src) / dst - 0.5;
    const f = Math.floor(u);
    x0[x] = ((f % src) + src) % src;
    x1[x] = (x0[x]! + 1) % src;
    t[x] = u - f;
  }
  return { x0, x1, t };
}

/** Interpolate row v (in source pixels, clamped) of a w x h field into out. */
function verticalLerp(f: Float32Array, w: number, h: number, v: number, out: Float32Array): void {
  const f0 = Math.floor(v);
  const t = v - f0;
  const y0 = f0 < 0 ? 0 : f0 >= h ? h - 1 : f0;
  const y1 = f0 + 1 < 0 ? 0 : f0 + 1 >= h ? h - 1 : f0 + 1;
  for (let x = 0; x < w; x++) {
    const a = f[y0 * w + x]!;
    out[x] = a + (f[y1 * w + x]! - a) * t;
  }
}

function horizontalLerp(row: Float32Array, tab: UpTable, x: number): number {
  const a = row[tab.x0[x]!]!;
  return a + (row[tab.x1[x]!]! - a) * tab.t[x]!;
}

/** Earth from Natural Earth land polygons (GeoJSON, lon/lat degrees). */
export function earthTexture(land: GeoJSON.FeatureCollection, width = 2048): HTMLCanvasElement {
  const [w, h] = earthSize(width);
  const { canvas, ctx } = makeCanvas(w, h);
  if (!ctx) return canvas;

  // 1. Rasterise the land mask with the canvas path filler (fast and antialiased).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  for (const f of land.features) drawGeometry(ctx, f.geometry, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  // 2. Coarse land coverage, box-blurred, used to lighten shallow water near coasts.
  const cw = 128;
  const ch = 64;
  const cov = new Float32Array(cw * ch);
  const bx = w / cw;
  const by = h / ch;
  const colCell = new Int32Array(w);
  for (let x = 0; x < w; x++) colCell[x] = Math.min(cw - 1, Math.floor(x / bx));
  for (let y = 0; y < h; y++) {
    const row = Math.min(ch - 1, Math.floor(y / by)) * cw;
    let q = y * w * 4;
    for (let x = 0; x < w; x++, q += 4) {
      const k = row + colCell[x]!;
      cov[k] = cov[k]! + data[q]!;
    }
  }
  const norm = 1 / (255 * bx * by);
  const blur = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(ch - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) s += cov[yy * cw + ((x + dx + cw) % cw)]!;
      }
      blur[y * cw + x] = (s / 9) * norm;
    }
  }

  // 3. Low resolution sphere noise, upsampled. Full-res fBm would cost far too much at 2048.
  const nw = Math.max(16, w >> 2);
  const nh = Math.max(8, h >> 2);
  const grid = makeGrid(nw, nh);
  const noise = new Noise3(hashString('earth'));
  const fa = new Float32Array(nw * nh);
  const fb = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sl = grid.latS[y]!;
    const cl = grid.latC[y]!;
    for (let x = 0; x < nw; x++) {
      const px = cl * grid.lonC[x]!;
      const pz = cl * grid.lonS[x]!;
      fa[y * nw + x] = noise.fbm(px * 3, sl * 3, pz * 3, 3);
      fb[y * nw + x] = noise.fbm(px * 6 + 4, sl * 6, pz * 6, 2);
    }
  }

  // 4. Shade every pixel. Fields are upsampled separably: one vertical lerp per row into a
  // small buffer, then a table-driven horizontal lerp per pixel.
  const o: Out = { r: 0, g: 0, b: 0, a: 255 };
  const land3: Out = { r: 0, g: 0, b: 0, a: 255 };
  const nCol = upTable(nw, w);
  const cCol = upTable(cw, w);
  const rowA = new Float32Array(nw);
  const rowB = new Float32Array(nw);
  const rowC = new Float32Array(cw);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    verticalLerp(fa, nw, nh, ((y + 0.5) * nh) / h - 0.5, rowA);
    verticalLerp(fb, nw, nh, ((y + 0.5) * nh) / h - 0.5, rowB);
    verticalLerp(blur, cw, ch, ((y + 0.5) * ch) / h - 0.5, rowC);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const q = i * 4;
      let m = data[q]! / 255;
      if (lat < -86) m = 1;
      const a = horizontalLerp(rowA, nCol, x);
      // Cheap integer hash for a little per-pixel grain.
      const grain = (((Math.imul(i, 2654435761) >>> 24) & 255) / 255 - 0.5) * 5;

      // Ocean.
      setC(o, OCEAN, 1 + (a - 0.5) * 0.12);
      if (m < 1) {
        const near = horizontalLerp(rowC, cCol, x);
        mixC(o, SHELF, smooth(0.03, 0.4, near) * 0.6);
        mixC(o, ICE, smooth(78, 84, lat + (a - 0.5) * 6) * 0.75);
        mixC(o, ICE, smooth(-70, -76, lat + (a - 0.5) * 6) * 0.6);
      }

      // Land.
      if (m > 0) {
        const b = horizontalLerp(rowB, nCol, x);
        const al = Math.abs(lat) + (a - 0.5) * 12;
        stops(land3, EARTH_LAND, al);
        const dz = smooth(12, 18, al) * smooth(34, 27, al) * smooth(0.42, 0.56, b);
        mixC(land3, DESERT, dz * 0.85);
        scaleC(land3, 1 + (b - 0.5) * 0.18);
        mixC(land3, ICE, smooth(-58, -64, lat));
        o.r += (land3.r - o.r) * m;
        o.g += (land3.g - o.g) * m;
        o.b += (land3.b - o.b) * m;
      }

      data[q] = o.r + grain;
      data[q + 1] = o.g + grain;
      data[q + 2] = o.b + grain;
      data[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Saturn rings

/** Opacity and colour for one radius. Writes into `o` (o.a in 0..1). */
function ringAt(o: Out, r: number, n: Noise3): void {
  const fine = n.at(r / 180, 0.5, 0.5);
  const mid = n.at(r / 700, 3.5, 1.5);
  let a: number;
  let col: RGB;
  if (r < 92_000) {
    // C ring: faint, with a few brighter plateaus in its outer half.
    a = 0.1 + 0.08 * mid + (r > 84_000 ? 0.08 * smooth(0.55, 0.7, fine) : 0);
    col = [150, 138, 122];
  } else if (r < 117_580) {
    // B ring: densest. Inner B ramps up over its first 7,000 km.
    a = 0.55 + 0.35 * smooth(92_000, 99_000, r) + 0.08 * (mid - 0.5);
    col = [212, 192, 158];
  } else if (r < 122_170) {
    // Cassini Division: nearly empty, one faint ringlet band.
    a = 0.04 + 0.05 * smooth(600, 0, Math.abs(r - 120_000));
    col = [140, 130, 118];
  } else {
    a = 0.62 - 0.12 * smooth(122_170, 136_775, r) + 0.06 * (mid - 0.5);
    col = [196, 182, 156];
    if (Math.abs(r - 133_590) < 162) a = 0;
    if (Math.abs(r - 136_505) < 21) a *= 0.15;
  }
  if (a > 0) a *= 0.85 + 0.3 * fine;
  const k = 0.92 + 0.16 * mid;
  o.r = col[0] * k;
  o.g = col[1] * k;
  o.b = col[2] * k;
  o.a = clamp01(a);
}

/** 1024 x 1 RGBA strip, left = inner radius 74,658 km, right = outer radius 136,775 km. */
export function saturnRingTexture(): HTMLCanvasElement {
  const w = 1024;
  const { canvas, ctx } = makeCanvas(w, 1);
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, 1);
  const data = img.data;
  const n = new Noise3(hashString('saturn-rings'));
  const o: Out = { r: 0, g: 0, b: 0, a: 0 };
  const span = RING_OUTER_KM - RING_INNER_KM;
  const SS = 4;
  for (let x = 0; x < w; x++) {
    // Supersample so the Encke Gap and sharp ring edges are antialiased.
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let s = 0; s < SS; s++) {
      const km = RING_INNER_KM + ((x + (s + 0.5) / SS) / w) * span;
      ringAt(o, km, n);
      r += o.r * o.a;
      g += o.g * o.a;
      b += o.b * o.a;
      a += o.a;
    }
    const q = x * 4;
    // Un-premultiply the averaged colour so faint pixels keep their hue.
    const inv = a > 0 ? 1 / a : 0;
    data[q] = r * inv;
    data[q + 1] = g * inv;
    data[q + 2] = b * inv;
    data[q + 3] = (a / SS) * 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Galaxies

const CORE_WARM: RGB = [255, 228, 188];
const ARM_BLUE: RGB = [196, 210, 240];

/** 256 x 256 RGBA on a transparent background. */
export function galaxyTexture(morph: GalaxyMorph, seed: number): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  if (!ctx) return canvas;
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const base = (hashString(morph) ^ Math.imul(Math.floor(seed) | 0, 0x9e3779b1)) >>> 0;
  const rand = mulberry32(base);
  const n = new Noise3(base ^ 0x5bd1e995);

  const rot = rand() * Math.PI * 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const phase = rand() * Math.PI * 2;
  const arms = rand() < 0.65 ? 2 : 3;
  const pitch = 0.22 + rand() * 0.16; // tan of pitch angle
  const tilt = 0.78 + rand() * 0.22; // mild axis ratio, still essentially face-on
  const ellQ = 0.6 + rand() * 0.35;
  const offX = (rand() - 0.5) * 0.16;
  const offY = (rand() - 0.5) * 0.16;
  const nz = rand() * 50;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const u = ((px + 0.5) / S) * 2 - 1;
      const v = ((py + 0.5) / S) * 2 - 1;
      const q = (py * S + px) * 4;
      // Circular window: guarantees zero alpha well inside the square's edge.
      const win = 1 - smooth(0.6, 0.97, Math.sqrt(u * u + v * v));
      if (win <= 0) {
        data[q + 3] = 0;
        continue;
      }
      const ur = u * cr - v * sr;
      const vr = u * sr + v * cr;

      let L = 0;
      let warm = 0;
      switch (morph) {
        case 'spiral':
        case 'barred': {
          const yy = vr / tilt;
          const r = Math.sqrt(ur * ur + yy * yy) + 1e-4;
          const th = Math.atan2(yy, ur);
          const disk = Math.exp(-r / 0.2);
          const bulge = 1.6 * Math.exp(-(r * r) / (2 * 0.045 * 0.045));
          const wob = (n.fbm(ur * 3 + nz, yy * 3, nz, 2) - 0.5) * 1.4;
          const rr = morph === 'barred' ? Math.max(r, 0.2) / 0.2 : r / 0.05;
          const phi = arms * (th - Math.log(rr) / pitch) + phase + wob;
          const arm = Math.pow(0.5 + 0.5 * Math.cos(phi), 3);
          const lane = Math.pow(0.5 + 0.5 * Math.cos(phi - 0.7), 8);
          const clump =
            smooth(0.55, 0.75, n.fbm(ur * 14 + nz, yy * 14, nz * 0.5, 2)) *
            arm *
            smooth(0.06, 0.2, r);
          let armW = smooth(0.03, 0.12, r);
          let bar = 0;
          if (morph === 'barred') {
            bar = 1.1 * Math.exp(-(ur * ur) / (0.2 * 0.2) - (yy * yy) / (0.045 * 0.045));
            armW = smooth(0.16, 0.24, r);
          }
          const dust = 1 - 0.55 * lane * armW;
          L = (bulge + bar + disk * (0.25 + armW * (1.2 * arm + 0.9 * clump))) * dust;
          warm = clamp01((bulge + bar * 0.8 + disk * 0.15) / (L + 1e-4)) * 0.9;
          break;
        }
        case 'elliptical': {
          const re = Math.sqrt(ur * ur + (vr / ellQ) * (vr / ellQ));
          L = 1.3 * Math.exp(-4.2 * (Math.pow(re / 0.2, 0.45) - 1));
          warm = 0.85 - 0.25 * smooth(0, 0.7, re);
          break;
        }
        case 'irregular': {
          const x = ur - offX;
          const y = vr - offY;
          const r = Math.sqrt(x * x + y * y);
          const f = n.fbm(x * 3 + nz, y * 3, nz, 3);
          const cl = smooth(0.5, 0.8, n.fbm(x * 12 + nz, y * 12, nz, 2));
          L = Math.exp(-r / 0.2) * (0.3 + 3 * Math.max(0, f - 0.38) + 0.5 * cl);
          warm = 0.15 * Math.exp(-r / 0.15);
          break;
        }
        case 'dwarf': {
          const yy = vr / ellQ;
          const r = Math.sqrt(ur * ur + yy * yy);
          const f = n.fbm(ur * 4 + nz, yy * 4, nz, 2);
          const cl = smooth(0.58, 0.78, n.fbm(ur * 10 + nz, yy * 10, nz, 2));
          L = 0.6 * Math.exp(-r / 0.15) * (0.75 + 0.8 * (f - 0.5) + 0.5 * cl);
          warm = 0.45 * Math.exp(-r / 0.2);
          break;
        }
        case 'edge-on': {
          const ax = Math.abs(ur);
          const disk = Math.exp(-ax / 0.2) * Math.exp(-Math.abs(vr) / 0.035);
          const bulge = 1.4 * Math.exp(-(ur * ur + (vr / 0.7) * (vr / 0.7)) / (2 * 0.06 * 0.06));
          const tex = 0.8 + 0.4 * n.fbm(ur * 8 + nz, vr * 30, nz, 2);
          const lv = vr + 0.006;
          const dust = 1 - 0.8 * Math.exp(-(lv * lv) / (2 * 0.011 * 0.011)) * smooth(0.9, 0.15, ax);
          L = (bulge + disk * 1.3 * tex) * dust;
          warm = clamp01(bulge / (bulge + disk + 1e-4)) * 0.85 + 0.1;
          break;
        }
        case 'dust-lane': {
          // Large bulge seen through an inclined disk, with the lane on the near side.
          const rb = Math.sqrt(ur * ur + (vr / 0.7) * (vr / 0.7));
          const bulge = 1.5 * Math.exp(-Math.pow(rb / 0.15, 0.8));
          const yy = vr / 0.28;
          const rd = Math.sqrt(ur * ur + yy * yy);
          const ring = 0.25 * Math.exp(-((rd - 0.45) * (rd - 0.45)) / (0.2 * 0.2));
          const near = smooth(-0.04, 0.03, vr);
          const lane = Math.exp(-((rd - 0.47) * (rd - 0.47)) / (0.07 * 0.07)) * near;
          const tex = 0.85 + 0.3 * n.fbm(ur * 10 + nz, vr * 10, nz, 2);
          L = (bulge + ring * tex) * (1 - 0.7 * lane);
          warm = clamp01(bulge / (bulge + ring + 1e-4)) * 0.8 + 0.1;
          break;
        }
      }

      const t = clamp01(warm);
      data[q] = ARM_BLUE[0] + (CORE_WARM[0] - ARM_BLUE[0]) * t;
      data[q + 1] = ARM_BLUE[1] + (CORE_WARM[1] - ARM_BLUE[1]) * t;
      data[q + 2] = ARM_BLUE[2] + (CORE_WARM[2] - ARM_BLUE[2]) * t;
      // Soft tone map so bright cores saturate gently instead of clipping.
      data[q + 3] = (1 - Math.exp(-Math.max(0, L) * 1.6)) * win * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
