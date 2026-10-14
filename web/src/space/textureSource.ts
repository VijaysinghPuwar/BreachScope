// Hands out Space view textures. They are drawn in a worker when the browser supports
// OffscreenCanvas, otherwise on the main thread in small idle-time steps. Results are kept
// for the whole session, so coming back to the Space view is instant.

import * as THREE from 'three';
import {
  earthTexture,
  galaxyTexture,
  planetTexture,
  saturnRingTexture,
  type GalaxyMorph,
  type PlanetSkin,
} from './textures';

export type TextureRequest =
  | { kind: 'planet'; skin: PlanetSkin }
  | { kind: 'ring' }
  | { kind: 'galaxy'; morph: GalaxyMorph; seed: number }
  | { kind: 'earth'; landUrl: string };

type Image = ImageBitmap | HTMLCanvasElement;

const cache = new Map<string, Promise<Image>>();
const pending = new Map<number, { resolve(image: Image): void; reject(error: Error): void }>();
let worker: Worker | null | undefined;
let nextId = 1;

const keyOf = (request: TextureRequest) => JSON.stringify(request);

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    worker = new Worker(new URL('./textures.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>,
    ) => {
      const job = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (!job) return;
      if (event.data.bitmap) job.resolve(event.data.bitmap);
      else job.reject(new Error(event.data.error ?? 'texture failed'));
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Fallback: draw on the main thread, but only when the browser is idle. */
function drawHere(request: TextureRequest): Promise<Image> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        switch (request.kind) {
          case 'planet':
            return resolve(planetTexture(request.skin) as HTMLCanvasElement);
          case 'ring':
            return resolve(saturnRingTexture() as HTMLCanvasElement);
          case 'galaxy':
            return resolve(galaxyTexture(request.morph, request.seed) as HTMLCanvasElement);
          case 'earth': {
            const land = (await (await fetch(request.landUrl)).json()) as GeoJSON.FeatureCollection;
            return resolve(earthTexture(land) as HTMLCanvasElement);
          }
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void run());
    else setTimeout(() => void run(), 30);
  });
}

export function loadTextureImage(request: TextureRequest): Promise<Image> {
  const key = keyOf(request);
  let promise = cache.get(key);
  if (!promise) {
    const target = getWorker();
    promise = target
      ? new Promise<Image>((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          target.postMessage({ id, request });
        })
      : drawHere(request);
    // A failed texture can be tried again next time.
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return promise;
}

/** Wraps a loaded image as a three.js texture with the right orientation. */
export function toTexture(image: Image): THREE.Texture {
  const texture = new THREE.Texture(image);
  // The worker already flipped its bitmaps; canvases still need WebGL to flip them.
  texture.flipY = !(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
