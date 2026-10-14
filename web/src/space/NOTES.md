# Space view (3D)

Zoom out past the globe in 3D: Earth and Moon, the Solar System, nearby stars, the Milky Way, nearby galaxies, and the edge of the observable universe. You can fly to any planet or major moon.

## Files

- `data.ts`: every object, with its distance, source, and placement (orbital elements, sky coordinates, or moon period).
- `astro.ts`: astronomy maths in float64.
  - Planet positions use Kepler's equation on JPL elements.
  - The Moon uses the Astronomical Almanac formula.
  - Earth's rotation uses sidereal time.
  - Sky coordinates (RA/Dec) are converted to 3D.
- `world.ts`: where everything is on a given date.
- `scale.ts`: zoom maths (`outer` = log10 of camera distance in metres), scale names, formatting.
- `engine.ts`: the three.js scene, labels and picking.
- `particles.ts`: seeded point clouds for the Milky Way model, the belts and galaxy clusters.
- `textures.ts`: procedural planet, ring and galaxy textures drawn with Canvas 2D, so there are no image downloads.
- `textures.worker.ts` and `textureSource.ts`: draw those textures in a Web Worker (OffscreenCanvas) and cache them for the session. Without worker support they are drawn on the main thread in idle time.
- `SpaceView.tsx`: the React shell (controls, cards, time, keyboard).

## How it works

- **One scene from 10 km to 10^27 m.** The GPU uses float32, which only keeps about 7 significant digits. So each frame, positions are computed in float64 relative to what the camera looks at, then divided by the camera distance. The GPU only sees numbers near 1. The camera sits at distance 1, and OrbitControls only rotates it.
- **Zoom is a log.** `outer` is log10 of the camera distance. Wheel, keys and pinch add to it. Easing is time-based, so it takes the same time on a slow device.
- **What the camera looks at drifts with zoom.** Close in, it is the focused body. Further out it is the Sun, then the Galactic Centre (`targetFor`).
- **Real positions.**
  - Planets come from JPL elements for the shown date, checked in tests against the 2024 perihelion, the 2024 equinox and the 2025 Mars opposition.
  - The Moon is placed for the shown date.
  - Earth is turned to the real time of day.
  - Stars and galaxies sit at their J2000 sky coordinates at their quoted distance.
- **Honest about the rest.** The phases of other planets' moons, galaxy shapes and tilts, the belt dots and the Milky Way's spiral are illustrative, and the caption says so.
- **Render on demand.** A frame is drawn only when something changes. The loop stops when the view is still.
- **Clean unmount.** The engine creates its own canvas and frees every geometry, material, texture and the WebGL context on unmount. A fresh canvas per engine matters, because React runs effects twice in development and a lost context cannot be reused.

## Keeping it smooth

- **Nothing heavy before the first frame.** Earth shows in a flat ocean colour at once. Textures arrive from the worker and are swapped in, nearest first; anything that comes on screen jumps the queue. Opening the view went from a 649 ms freeze to 83 ms, and a second visit has none.
- **No shader recompiles.** Every textured material starts with a 1x1 blank map, so swapping in the real texture reuses the compiled shader.
- **The Milky Way point cloud** is built in idle time and only shown once the view is galaxy sized, so the camera never flies through it.
- **Camera hand-over.** The camera slides from the focus to the Sun, or from the Sun to the Galactic Centre, only while the gap between them is 0.6 to 0.15 of the camera distance. Both stay on screen, so the view never passes through empty space (`handoverRange`).

## Tests

- `astro.test.ts`: Kepler solver, real events, Moon distance range, frames, world placement.
- `space.test.ts`: scale thresholds, data checks, formatting.
- `e2e/space.spec.ts`: runs `/space` at four sizes, with and without reduced motion. It covers keyboard, wheel, fly to Jupiter, the card with its source, time controls, cards closing when their object leaves the scale, axe, and no console errors.
