// three.js scene for the Space view.
//
// The trick that lets one scene span 10 km to 10^27 m: every frame, positions are worked
// out in float64 relative to what the camera looks at, then divided by the camera
// distance. The GPU only ever sees numbers near 1, so float32 never runs out of precision.
// The camera sits at distance 1 from the origin and OrbitControls only rotates it.
//
// Rendering is on demand: a frame is drawn only when something changed (zoom, rotation,
// time, size, selection), and the loop stops when the view is still.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cross, length, normalize, orbitPath, scale, sub, toThree, type Vec3 } from './astro';
import { M_PER_AU, M_PER_LY, SPACE_OBJECTS, objectById, type SpaceObject } from './data';
import { buildMilkyWay, buildBelt, buildCluster } from './particles';
import {
  FOV_DEG,
  decadeTicks,
  formatDistance,
  naturalUnit,
  rangeFade,
  scaleFor,
  separationFade,
  targetFor,
} from './scale';
import {
  RING_INNER_KM,
  RING_OUTER_KM,
  earthPlaceholder,
  earthTexture,
  galaxyTexture,
  planetTexture,
  saturnRingTexture,
} from './textures';
import { computeWorld, EARTH_MOON_BARYCENTRE, type World } from './world';

export interface Palette {
  bg: string;
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  borderDefault: string;
  borderStrong: string;
  font: string;
}

export interface LabelSpot {
  id: string;
  x: number;
  y: number;
  /** Radius on screen when the body is drawn as a disc, for picking. */
  r: number;
  labelled: boolean;
}

export interface FrameInfo {
  outer: number;
  spots: LabelSpot[];
}

export interface EngineHooks {
  /** Advance animations. Return true while anything is still moving. */
  tick(now: number): boolean;
  onFrame(info: FrameInfo): void;
}

/** Average colour of each body, used for the dot when it is too small to draw as a sphere. */
const DOT_COLOUR: Record<string, string> = {
  sun: '#f1e4c6',
  mercury: '#8f8a84',
  venus: '#d8c79c',
  earth: '#7f9cbc',
  moon: '#a3a3a0',
  mars: '#b86a45',
  phobos: '#77716b',
  deimos: '#8a837b',
  jupiter: '#cdb592',
  io: '#d9c36a',
  europa: '#d9d2c3',
  ganymede: '#9c9284',
  callisto: '#7a7066',
  saturn: '#d9c79a',
  titan: '#c99a5b',
  uranus: '#a8d2d8',
  neptune: '#5675b8',
  triton: '#c9b3ad',
  pluto: '#c7b39c',
};

const PARENT: Record<string, string> = {
  moon: 'earth',
  l2: 'earth',
  iss: 'earth',
  gps: 'earth',
  geo: 'earth',
  phobos: 'mars',
  deimos: 'mars',
  io: 'jupiter',
  europa: 'jupiter',
  ganymede: 'jupiter',
  callisto: 'jupiter',
  titan: 'saturn',
  triton: 'neptune',
};

function parentOf(object: SpaceObject): string | null {
  if (PARENT[object.id]) return PARENT[object.id]!;
  if (object.id === 'galactic-centre' || object.id === 'edge') return null;
  if (object.id === 'sun') return 'galactic-centre';
  if (object.kind === 'galaxy' || object.kind === 'galaxy-cluster' || object.kind === 'quasar') {
    return 'galactic-centre';
  }
  return 'sun';
}

function hashSeed(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16_777_619);
  return hash >>> 0;
}

const LABEL_SEP_PX = 18;
const MIN_DISC_PX = 2.5;
const MIN_GALAXY_PX = 22;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface Body {
  object: SpaceObject;
  mesh: THREE.Mesh;
  radiusM: number;
  clouds?: THREE.Mesh;
  ring?: THREE.Mesh;
}

interface Loop {
  object: SpaceObject;
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  /** 'orbit' paths are in AU around the Sun; 'circle' is a unit circle in a plane. */
  shape: 'path' | 'circle' | 'billboard';
  centre: string;
  radiusM: number;
}

interface Disc {
  object: SpaceObject;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  sizeM: number;
}

interface Cloud {
  object: SpaceObject;
  points: THREE.Points;
  material: THREE.PointsMaterial;
  /** Metres per geometry unit. */
  unitM: number;
  outerM: number;
  innerM: number;
}

function circleGeometry(segments = 256): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let k = 0; k <= segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function dotTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Basis matrix from an orbit plane given as two in-plane axes in the ecliptic frame. */
function planeQuaternion(x: Vec3, y: Vec3): THREE.Quaternion {
  const normal = normalize(cross(x, y));
  const xs = new THREE.Vector3(...toThree(normalize(x)));
  const ys = new THREE.Vector3(...toThree(normal));
  const zs = new THREE.Vector3().crossVectors(xs, ys);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xs, ys, zs));
}

export class SpaceEngine {
  /** log10 of the camera distance in metres. */
  outer: number;
  focusId = 'earth';
  selectedId: string | null = null;
  /** During a flight, where the camera started looking, blended out by `flightT`. */
  flightFrom: Vec3 | null = null;
  flightT = 1;
  date: Date;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly overlay: HTMLCanvasElement;
  private readonly palette: Palette;
  private readonly hooks: EngineHooks;
  private readonly sunLight = new THREE.PointLight(0xffffff, 2.4, 0, 0);
  private readonly bodies: Body[] = [];
  private readonly loops: Loop[] = [];
  private readonly discs: Disc[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly decades: THREE.Line[] = [];
  private readonly markers: THREE.Points;
  private readonly markerObjects: SpaceObject[];
  private milkyWay: Cloud | null = null;
  private world: World;
  private worldTime = 0;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private raf = 0;
  private disposed = false;
  private spots: LabelSpot[] = [];
  private target: Vec3 = [0, 0, 0];

  private readonly canvas: HTMLCanvasElement;

  /**
   * Creates its own canvas inside `host`. A fresh canvas per engine matters: React runs
   * effects twice in development, and a canvas whose context was lost cannot be reused.
   */
  constructor(
    host: HTMLElement,
    overlay: HTMLCanvasElement,
    options: { palette: Palette; outer: number; date: Date; reducedMotion: boolean },
    hooks: EngineHooks,
  ) {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.canvas = canvas;
    // Throws when WebGL is unavailable; the component shows a fallback.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    host.appendChild(canvas);
    this.renderer.setClearColor(new THREE.Color(options.palette.bg), 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.overlay = overlay;
    this.palette = options.palette;
    this.hooks = hooks;
    this.outer = options.outer;
    this.date = options.date;
    this.world = computeWorld(this.date);
    this.worldTime = this.date.getTime();

    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1e-6, 1e6);
    this.camera.position.setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), 0.6);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.minDistance = this.controls.maxDistance = 1;
    this.controls.rotateSpeed = 0.55;
    this.controls.enableDamping = !options.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener('change', this.requestRender);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.07));
    this.scene.add(this.sunLight);

    const markerObjects = SPACE_OBJECTS.filter(
      (object) =>
        object.radiusKm !== undefined ||
        object.kind === 'star' ||
        object.kind === 'nebula' ||
        object.kind === 'cluster' ||
        object.kind === 'spacecraft' ||
        object.kind === 'quasar',
    );
    this.markerObjects = markerObjects;
    const markerGeometry = new THREE.BufferGeometry();
    markerGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(markerObjects.length * 3), 3),
    );
    markerGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(markerObjects.length * 4), 4),
    );
    this.markers = new THREE.Points(
      markerGeometry,
      new THREE.PointsMaterial({
        size: 7,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        map: dotTexture(),
        alphaTest: 0.02,
        depthWrite: false,
      }),
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 3;
    this.scene.add(this.markers);

    this.build();
    void this.loadEarth();
  }

  private build() {
    const sphere = new THREE.SphereGeometry(1, 96, 48);
    const unitCircle = circleGeometry();

    for (const object of SPACE_OBJECTS) {
      if (object.radiusKm !== undefined) this.addBody(object, sphere);
      if (object.placement.type === 'kepler' || object.id === 'earth') {
        const elements = object.placement.type === 'kepler' ? object.placement.elements : undefined;
        const path = elements ? orbitPath(elements, this.date) : null;
        const geometry = path
          ? new THREE.BufferGeometry().setFromPoints(
              path.map((p) => new THREE.Vector3(...toThree(p))),
            )
          : null;
        if (geometry) this.addLoop(object, geometry, 'path', 'sun', object.distanceM);
      }
      if (
        object.placement.type === 'satellite' ||
        object.placement.type === 'earth-orbit' ||
        object.id === 'moon'
      ) {
        this.addLoop(object, unitCircle, 'circle', PARENT[object.id] ?? 'earth', object.distanceM);
      }
      if (object.placement.type === 'shell') {
        this.addLoop(object, unitCircle, 'billboard', 'sun', object.distanceM);
      }
      if (object.placement.type === 'belt') {
        const { innerAu, outerAu, tiltDeg } = object.placement;
        const geometry = buildBelt(innerAu, outerAu, tiltDeg, hashSeed(object.id));
        this.addCloud(object, geometry, M_PER_AU, outerAu * M_PER_AU, innerAu * M_PER_AU, 1.2);
      }
      if (object.kind === 'galaxy' && object.morph) this.addDisc(object);
      if (object.kind === 'galaxy-cluster' && object.sizeLy) {
        const geometry = buildCluster(hashSeed(object.id));
        const half = (object.sizeLy * M_PER_LY) / 2;
        this.addCloud(object, geometry, half, half, 0, 2.2);
      }
    }

    // Earth's orbit comes from the barycentre elements in world.ts.
    const earth = objectById.get('earth')!;
    const earthOrbit = new THREE.BufferGeometry().setFromPoints(
      orbitPath(EARTH_MOON_BARYCENTRE, this.date).map((p) => new THREE.Vector3(...toThree(p))),
    );
    this.addLoop(earth, earthOrbit, 'path', 'sun', earth.distanceM);

    const milkyWay = buildMilkyWay(hashSeed('milky-way'));
    const material = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const points = new THREE.Points(milkyWay, material);
    points.frustumCulled = false;
    const g = this.world.galactic;
    points.quaternion.copy(planeQuaternion(g.x, g.y));
    this.scene.add(points);
    this.milkyWay = {
      object: objectById.get('galactic-centre')!,
      points,
      material,
      unitM: M_PER_LY,
      outerM: 50_000 * M_PER_LY,
      innerM: 0,
    };

    const dashed = new THREE.LineDashedMaterial({
      color: new THREE.Color(this.palette.borderStrong),
      dashSize: 0.02,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const dashedCircle = circleGeometry(256);
    for (let k = 0; k < 8; k++) {
      const line = new THREE.Line(dashedCircle, dashed);
      if (k === 0) line.computeLineDistances();
      line.visible = false;
      line.frustumCulled = false;
      this.decades.push(line);
      this.scene.add(line);
    }
  }

  private addBody(object: SpaceObject, sphere: THREE.SphereGeometry) {
    const radiusM = object.radiusKm! * 1_000;
    let material: THREE.Material;
    if (object.id === 'sun') {
      const map = new THREE.CanvasTexture(planetTexture('sun'));
      map.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map });
    } else {
      const canvas =
        object.id === 'earth' ? earthPlaceholder() : planetTexture(object.skin ?? 'moon');
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      material = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    }
    const mesh = new THREE.Mesh(sphere, material);
    mesh.frustumCulled = false;
    const body: Body = { object, mesh, radiusM };
    if (object.id === 'earth') {
      const clouds = new THREE.CanvasTexture(planetTexture('earth-clouds'));
      clouds.colorSpace = THREE.SRGBColorSpace;
      body.clouds = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          map: clouds,
          transparent: true,
          depthWrite: false,
          roughness: 1,
        }),
      );
      body.clouds.scale.setScalar(1.008);
      mesh.add(body.clouds);
    }
    if (object.rings) {
      const inner = RING_INNER_KM / object.radiusKm!;
      const outer = RING_OUTER_KM / object.radiusKm!;
      const geometry = new THREE.RingGeometry(inner, outer, 256, 1);
      // Map u along the radius so the 1D ring texture lines up with the real ring edges.
      const position = geometry.attributes.position!;
      const uv = geometry.attributes.uv!;
      for (let k = 0; k < position.count; k++) {
        const r = Math.hypot(position.getX(k), position.getY(k));
        uv.setXY(k, (r - inner) / (outer - inner), 0.5);
      }
      geometry.rotateX(-Math.PI / 2);
      const map = new THREE.CanvasTexture(saturnRingTexture());
      map.colorSpace = THREE.SRGBColorSpace;
      body.ring = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map,
          color: new THREE.Color(0.85, 0.85, 0.85),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.add(body.ring);
    }
    this.bodies.push(body);
    this.scene.add(mesh);
  }

  private addLoop(
    object: SpaceObject,
    geometry: THREE.BufferGeometry,
    shape: Loop['shape'],
    centre: string,
    radiusM: number,
  ) {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.palette.borderStrong),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.loops.push({ object, line, material, shape, centre, radiusM });
    this.scene.add(line);
  }

  private addCloud(
    object: SpaceObject,
    geometry: THREE.BufferGeometry,
    unitM: number,
    outerM: number,
    innerM: number,
    size: number,
  ) {
    const material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: false,
      color: new THREE.Color(object.color ?? '#c9ced6'),
      vertexColors: geometry.hasAttribute('color'),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.clouds.push({ object, points, material, unitM, outerM, innerM });
    this.scene.add(points);
  }

  private addDisc(object: SpaceObject) {
    const map = new THREE.CanvasTexture(galaxyTexture(object.morph!, hashSeed(object.id)));
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.frustumCulled = false;
    // Illustrative tilt, fixed per galaxy.
    const seed = hashSeed(object.id);
    // Kept within 55 degrees of face-on, so no galaxy shrinks to a sliver.
    const tilt = (((seed % 110) - 55) * Math.PI) / 180;
    const turn = (((seed >> 9) % 360) * Math.PI) / 180;
    mesh.quaternion.copy(this.camera.quaternion);
    mesh.rotateZ(turn);
    mesh.rotateX(tilt);
    // Store the base orientation; draw() re-faces the camera each frame.
    mesh.userData.tilt = tilt;
    mesh.userData.turn = turn;
    this.discs.push({ object, mesh, material, sizeM: (object.sizeLy ?? 50_000) * M_PER_LY });
    this.scene.add(mesh);
  }

  private async loadEarth() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}geo/land.geojson`);
      if (!response.ok) return;
      const land = (await response.json()) as GeoJSON.FeatureCollection;
      if (this.disposed) return;
      const earth = this.bodies.find((body) => body.object.id === 'earth');
      const material = earth?.mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!material) return;
      const map = new THREE.CanvasTexture(earthTexture(land));
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      material.map?.dispose();
      material.map = map;
      material.needsUpdate = true;
      this.requestRender();
    } catch {
      // The ocean-only texture stays; nothing else depends on the land data.
    }
  }

  resize(width: number, height: number, ratio: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.overlay.width = Math.round(this.width * ratio);
    this.overlay.height = Math.round(this.height * ratio);
    this.requestRender();
  }

  setReducedMotion(reduced: boolean) {
    this.controls.enableDamping = !reduced;
  }

  /** Rotates the view by keyboard. Degrees. */
  orbitBy(dTheta: number, dPhi: number) {
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
    spherical.theta += THREE.MathUtils.degToRad(dTheta);
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + THREE.MathUtils.degToRad(dPhi),
      0.05,
      Math.PI - 0.05,
    );
    this.camera.position.setFromSpherical(spherical);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  positionOf(id: string): Vec3 | undefined {
    return this.world.positions.get(id);
  }

  currentTarget(): Vec3 {
    return this.target;
  }

  requestRender = () => {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
  };

  private frame = (now: number) => {
    this.raf = 0;
    const busy = this.hooks.tick(now);
    const moved = this.controls.update();
    this.draw();
    if (busy || moved) this.requestRender();
  };

  /** Screen spot of each object from the last frame, for picking. */
  pick(x: number, y: number): string | null {
    let best: { id: string; gap: number } | null = null;
    for (const spot of this.spots) {
      const gap = Math.max(0, Math.hypot(spot.x - x, spot.y - y) - spot.r);
      if (gap <= 16 && (!best || gap < best.gap)) best = { id: spot.id, gap };
    }
    return best?.id ?? null;
  }

  private draw() {
    if (this.date.getTime() !== this.worldTime) {
      this.world = computeWorld(this.date);
      this.worldTime = this.date.getTime();
    }
    const world = this.world;
    const D = 10 ** this.outer;
    const sun = world.positions.get('sun')!;
    const centre = world.positions.get('galactic-centre')!;
    let focus = world.positions.get(this.focusId) ?? sun;
    if (this.flightFrom && this.flightT < 1) {
      const t = this.flightT;
      const eased = t * t * (3 - 2 * t);
      focus = [
        this.flightFrom[0] + (focus[0] - this.flightFrom[0]) * eased,
        this.flightFrom[1] + (focus[1] - this.flightFrom[1]) * eased,
        this.flightFrom[2] + (focus[2] - this.flightFrom[2]) * eased,
      ];
    }
    const target = targetFor(this.outer, focus, sun, centre);
    this.target = target;
    const rel = (v: Vec3) => toThree(scale(sub(v, target), 1 / D));
    const camera = this.camera;
    camera.updateMatrixWorld();
    const camPos = camera.position;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2));
    const pxPerUnitAt = (p: THREE.Vector3) =>
      this.height / (2 * tanHalf * Math.max(1e-9, p.distanceTo(camPos)));
    const v = new THREE.Vector3();
    const project = (p: THREE.Vector3) => {
      v.copy(p).project(camera);
      return {
        x: ((v.x + 1) / 2) * this.width,
        y: ((1 - v.y) / 2) * this.height,
        front: v.z < 1 && v.z > -1,
      };
    };

    const screen = new Map<
      string,
      { x: number; y: number; front: boolean; world: THREE.Vector3 }
    >();
    for (const object of SPACE_OBJECTS) {
      const position = world.positions.get(object.id);
      if (!position) continue;
      const p = new THREE.Vector3(...rel(position));
      screen.set(object.id, { ...project(p), world: p });
    }
    const separation = (object: SpaceObject) => {
      const parent = parentOf(object);
      const own = screen.get(object.id);
      const other = parent ? screen.get(parent) : undefined;
      if (!own) return 0;
      if (!other) return Infinity;
      return Math.hypot(own.x - other.x, own.y - other.y);
    };
    const fadeFor = (object: SpaceObject) => {
      // The focus and the selection stay labelled, but only while they can still be told
      // apart from the Sun; at galaxy scale they have merged into it.
      const pinned = object.id === this.focusId || object.id === this.selectedId;
      if (pinned && (this.outer < 15 || !object.radiusKm)) return 1;
      // Each scale shows only what belongs to it: nothing collapsed into its parent and
      // nothing far beyond the camera's range.
      const position = world.positions.get(object.id);
      const range = position ? rangeFade(length(sub(position, target)), this.outer) : 1;
      const sep = separationFade(separation(object)) * range;
      // Other galaxies wait until the Milky Way itself is in view.
      const extragalactic =
        object.kind === 'galaxy' || object.kind === 'galaxy-cluster' || object.kind === 'quasar';
      return extragalactic && object.id !== 'sgr-dsph'
        ? sep * clamp01((this.outer - 19.6) / 0.8)
        : sep;
    };

    const spots: LabelSpot[] = [];
    const spot = (id: string, x: number, y: number, r: number, sepOk: boolean) => {
      if (x < -50 || y < -50 || x > this.width + 50 || y > this.height + 50) return;
      spots.push({ id, x, y, r, labelled: sepOk });
    };

    // Sun light.
    const sunRel = screen.get('sun')!.world;
    this.sunLight.position.copy(sunRel);

    // Bodies and dot markers.
    const markerPosition = this.markers.geometry.attributes.position as THREE.BufferAttribute;
    const markerColour = this.markers.geometry.attributes.color as THREE.BufferAttribute;
    const colour = new THREE.Color();
    const bodyById = new Map(this.bodies.map((body) => [body.object.id, body]));
    this.markerObjects.forEach((object, index) => {
      const s = screen.get(object.id);
      const fade = fadeFor(object);
      let dot = 0;
      if (s) {
        markerPosition.setXYZ(index, s.world.x, s.world.y, s.world.z);
        const body = bodyById.get(object.id);
        const pxPerUnit = pxPerUnitAt(s.world);
        const radiusPx = body ? (body.radiusM / D) * pxPerUnit : 0;
        if (body) {
          const axes = world.axes.get(object.id);
          body.mesh.position.copy(s.world);
          body.mesh.scale.setScalar(body.radiusM / D);
          if (axes) {
            const xs = new THREE.Vector3(...toThree(axes.x));
            const ys = new THREE.Vector3(...toThree(axes.y));
            const zs = new THREE.Vector3(...toThree(axes.z));
            body.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xs, ys, zs));
          }
          body.mesh.visible = radiusPx >= MIN_DISC_PX && fade > 0 && s.front;
          dot = body.mesh.visible ? 0 : fade;
        } else {
          dot = fade;
        }
        if (s.front && fade > 0) {
          spot(
            object.id,
            s.x,
            s.y,
            Math.max(radiusPx, 4),
            separation(object) >= LABEL_SEP_PX || fade === 1,
          );
        }
      }
      colour.set(object.color ?? DOT_COLOUR[object.id] ?? this.palette.primary);
      markerColour.setXYZW(index, colour.r, colour.g, colour.b, s?.front ? dot : 0);
    });
    markerPosition.needsUpdate = true;
    markerColour.needsUpdate = true;

    // Orbits, Earth orbits, moon orbits and boundary shells.
    for (const loop of this.loops) {
      const centrePosition = world.positions.get(loop.centre);
      if (!centrePosition) continue;
      const c = new THREE.Vector3(...rel(centrePosition));
      // Each ring shows over a window of zoom around its own size, so rings far bigger
      // or far smaller than the view stay out of the way.
      const size = Math.log10(loop.radiusM);
      const below = loop.shape === 'path' ? 1.5 : 1.1;
      const sizeFade =
        clamp01((this.outer - (size - below)) / 0.4) * clamp01((size + 1.6 - this.outer) / 0.4);
      const highlighted = loop.object.id === this.focusId || loop.object.id === this.selectedId;
      loop.line.position.copy(c);
      if (loop.shape === 'path') {
        loop.line.scale.setScalar(M_PER_AU / D);
        loop.line.quaternion.identity();
      } else if (loop.shape === 'circle') {
        const plane = world.planes.get(loop.object.id);
        if (plane) loop.line.quaternion.copy(planeQuaternion(plane.x, plane.y));
        loop.line.scale.setScalar(loop.radiusM / D);
      } else {
        // Shell outline: a circle facing the camera.
        loop.line.quaternion.copy(camera.quaternion);
        loop.line.rotateX(Math.PI / 2);
        loop.line.scale.setScalar(loop.radiusM / D);
      }
      loop.material.color.set(highlighted ? this.palette.accent : this.palette.borderStrong);
      loop.material.opacity = (highlighted ? 0.9 : 0.45) * sizeFade;
      loop.line.visible = sizeFade > 0.01;
      if (loop.shape !== 'path' && loop.line.visible && sizeFade > 0.3) {
        // Label where the ring crosses the upper right of the view.
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const edge = c
          .clone()
          .addScaledVector(right, (loop.radiusM / D) * 0.707)
          .addScaledVector(up, (loop.radiusM / D) * 0.707);
        const s = project(edge);
        if (s.front && loop.object.kind !== 'moon') spot(loop.object.id, s.x, s.y, 3, true);
      }
    }

    // Belts and galaxy clusters.
    for (const cloud of this.clouds) {
      const centrePosition = world.positions.get(cloud.object.id) ??
        world.positions.get('sun') ?? [0, 0, 0];
      const c = new THREE.Vector3(...rel(centrePosition));
      const fade =
        cloud.object.kind === 'belt'
          ? clamp01((this.outer - (Math.log10(cloud.innerM) - 0.6)) / 0.4) *
            clamp01((Math.log10(cloud.outerM) + 1.6 - this.outer) / 0.4)
          : fadeFor(cloud.object);
      cloud.points.position.copy(c);
      cloud.points.scale.setScalar(cloud.unitM / D);
      cloud.material.opacity = (cloud.object.kind === 'belt' ? 0.32 : 0.6) * fade;
      cloud.points.visible = fade > 0.01;
      const s = project(c);
      if (cloud.points.visible && s.front) {
        if (cloud.object.kind === 'belt') {
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const edge = project(c.clone().addScaledVector(right, cloud.object.distanceM / D));
          if (edge.front) spot(cloud.object.id, edge.x, edge.y, 3, fade > 0.3);
        } else {
          spot(cloud.object.id, s.x, s.y, 6, separation(cloud.object) >= LABEL_SEP_PX);
        }
      }
    }

    // Galaxies drawn as textured discs, never smaller than a few pixels.
    for (const disc of this.discs) {
      const s = screen.get(disc.object.id);
      if (!s) continue;
      const fade = fadeFor(disc.object);
      const pxPerUnit = pxPerUnitAt(s.world);
      const size = Math.max(disc.sizeM / D, MIN_GALAXY_PX / pxPerUnit);
      disc.mesh.position.copy(s.world);
      disc.mesh.scale.setScalar(size);
      disc.mesh.quaternion.copy(camera.quaternion);
      disc.mesh.rotateZ(disc.mesh.userData.turn as number);
      disc.mesh.rotateX(disc.mesh.userData.tilt as number);
      disc.material.opacity = fade;
      disc.mesh.visible = fade > 0.01 && s.front;
      if (disc.mesh.visible) {
        spot(
          disc.object.id,
          s.x,
          s.y,
          Math.max(6, (size * pxPerUnit) / 2),
          separation(disc.object) >= LABEL_SEP_PX,
        );
      }
    }

    // The Milky Way: fades in as the stars give way to the galaxy.
    if (this.milkyWay) {
      const c = screen.get('galactic-centre')!.world;
      const fade = clamp01((this.outer - 17.6) / 1.4);
      this.milkyWay.points.position.copy(c);
      this.milkyWay.points.scale.setScalar(M_PER_LY / D);
      this.milkyWay.material.opacity = 0.55 * fade;
      this.milkyWay.points.visible = fade > 0.01;
    }

    // Dashed reference circles at powers of ten, in the ecliptic or the galactic plane.
    const scaleNow = scaleFor(this.outer);
    const ticks = decadeTicks(this.outer, scaleNow.unit);
    const plane =
      this.outer < 18.8
        ? planeQuaternion([1, 0, 0], [0, 1, 0])
        : planeQuaternion(world.galactic.x, world.galactic.y);
    const planeNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(plane);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const along = right.clone().addScaledVector(planeNormal, -right.dot(planeNormal)).normalize();
    const decadeLabels: { x: number; y: number; text: string }[] = [];
    this.decades.forEach((line, index) => {
      const tick = ticks[index];
      line.visible = tick !== undefined;
      if (tick === undefined) return;
      line.position.set(0, 0, 0);
      line.quaternion.copy(plane);
      line.scale.setScalar(tick / D);
      const s = project(along.clone().multiplyScalar(tick / D));
      if (s.front) decadeLabels.push({ x: s.x, y: s.y, text: formatDistance(tick, scaleNow.unit) });
    });

    this.renderer.render(this.scene, camera);
    this.spots = spots;
    this.drawOverlay(spots, decadeLabels);
    this.hooks.onFrame({ outer: this.outer, spots });
  }

  private drawOverlay(spots: LabelSpot[], decadeLabels: { x: number; y: number; text: string }[]) {
    const context = this.overlay.getContext('2d');
    if (!context) return;
    const { palette } = this;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    type Box = { left: number; top: number; right: number; bottom: number };
    const taken: Box[] = [];
    const overlaps = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    const rank = (id: string) => {
      if (id === this.selectedId) return 0;
      if (id === this.focusId) return 1;
      const kind = objectById.get(id)?.kind;
      if (kind === 'planet' || kind === 'galaxy' || id === 'sun') return 2;
      if (kind === 'moon' || kind === 'star' || kind === 'dwarf-planet') return 3;
      return 4;
    };
    const ordered = spots.filter((s) => s.labelled).sort((a, b) => rank(a.id) - rank(b.id));
    for (const s of ordered) {
      const object = objectById.get(s.id);
      if (!object) continue;
      const selected = s.id === this.selectedId;
      const name = object.name;
      const distance =
        object.id === 'sun'
          ? 'Our star'
          : formatDistance(object.distanceM, naturalUnit(object.distanceM));
      context.font = `${selected ? 600 : 500} 12px ${palette.font}`;
      const nameWidth = context.measureText(name).width;
      context.font = `400 11px ${palette.font}`;
      const labelWidth = Math.max(nameWidth, context.measureText(distance).width);
      const offset = Math.max(8, s.r + 6);
      let lx = s.x + offset;
      if (lx + labelWidth > this.width - 4) lx = s.x - offset - labelWidth;
      const box = { left: lx - 2, top: s.y - 15, right: lx + labelWidth + 2, bottom: s.y + 14 };
      if (!selected && taken.some((other) => overlaps(box, other))) continue;
      taken.push(box);
      context.textBaseline = 'alphabetic';
      // A thin outline in the background colour keeps text readable over star clouds.
      context.lineJoin = 'round';
      context.lineWidth = 3;
      context.strokeStyle = palette.bg;
      context.fillStyle = palette.primary;
      context.font = `${selected ? 600 : 500} 12px ${palette.font}`;
      context.strokeText(name, lx, s.y - 2);
      context.fillText(name, lx, s.y - 2);
      context.fillStyle = palette.secondary;
      context.font = `400 11px ${palette.font}`;
      context.strokeText(distance, lx, s.y + 11);
      context.fillText(distance, lx, s.y + 11);
      if (selected && s.r < 30) {
        context.strokeStyle = palette.accent;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(s.x, s.y, Math.max(8, s.r + 4), 0, Math.PI * 2);
        context.stroke();
      }
    }

    // Scale labels last, so they give way to object labels.
    context.font = `400 11px ${palette.font}`;
    context.textBaseline = 'bottom';
    context.textAlign = 'left';
    context.fillStyle = palette.tertiary;
    for (const label of decadeLabels) {
      const width = context.measureText(label.text).width;
      const box = {
        left: label.x + 3,
        top: label.y - 16,
        right: label.x + 7 + width,
        bottom: label.y,
      };
      if (taken.some((other) => overlaps(box, other))) continue;
      taken.push(box);
      context.fillText(label.text, label.x + 4, label.y - 2);
    }
  }

  /** Distance between two objects now, in metres. */
  distanceBetween(a: string, b: string): number {
    const pa = this.world.positions.get(a);
    const pb = this.world.positions.get(b);
    return pa && pb ? length(sub(pa, pb)) : 0;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) textures.add(map);
        material.dispose();
      }
    });
    for (const texture of textures) texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
