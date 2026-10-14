// Draws Space view textures off the main thread, so opening the view never freezes the page.
// Each request comes back as an ImageBitmap, flipped for WebGL, ready to upload.

import { earthTexture, galaxyTexture, planetTexture, saturnRingTexture } from './textures';
import type { TextureRequest } from './textureSource';

async function draw(request: TextureRequest): Promise<OffscreenCanvas> {
  switch (request.kind) {
    case 'planet':
      return planetTexture(request.skin) as OffscreenCanvas;
    case 'ring':
      return saturnRingTexture() as OffscreenCanvas;
    case 'galaxy':
      return galaxyTexture(request.morph, request.seed) as OffscreenCanvas;
    case 'earth': {
      const response = await fetch(request.landUrl);
      if (!response.ok) throw new Error(`land data ${response.status}`);
      return earthTexture((await response.json()) as GeoJSON.FeatureCollection) as OffscreenCanvas;
    }
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; request: TextureRequest }>) => {
  const { id, request } = event.data;
  try {
    const canvas = await draw(request);
    const bitmap = await createImageBitmap(canvas, { imageOrientation: 'flipY' });
    self.postMessage({ id, bitmap }, { transfer: [bitmap] });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
