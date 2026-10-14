# Space view

Zoom out past the globe: Earth and Moon, Solar System, Milky Way, nearby galaxies, then the edge of the observable universe.

## How it works

- **Log radial axis.** The view is a disc. Distance from the centre on screen is linear in `log10(distance)`, so every circle outward is ten times farther than the last. The rim shows `outer` (log10 of metres) and the centre shows `outer - 3`. Zooming out just adds to `outer`, and everything slides inward. One number covers distances from 400 km to 46.5 billion light-years.
- **Scales are thresholds on `outer`.** `scaleFor` picks the name, the unit (km, AU, ly, Mly, Gly) and the origin (Earth, Sun, Milky Way). The thresholds live in `SCALES` in `scale.ts`.
- **Canvas 2D, not three.js.** About 50 dots and rings do not need WebGL, and keeping it small means the view can be lazy-loaded.
- **Animation.** Input moves a `target`. A `requestAnimationFrame` loop eases `outer` towards it. With reduced motion it jumps straight there.
- **Honesty.** Each object in `data.ts` has a source and a measure: proper, light-travel or comoving. Far galaxies are quoted in different ways, so the detail card says which one is shown. Directions on screen are made up to spread the labels out, and the caption says so.

## Why these choices

- A linear scale would leave everything but the outermost object as a single dot. A log axis keeps every object visible at once.
- Pure maths sits in `scale.ts`, with no DOM, so the unit tests cover it without a browser.
- Wheel zoom uses a native listener with `passive: false`, because React's `onWheel` cannot call `preventDefault`.

## Tests

- `space.test.ts` checks that the log mapping round-trips, that the scale thresholds are right, that the data is sorted and every entry has a source, and checks the formatting.
- `e2e/space.spec.ts` runs at four sizes, with and without reduced motion. It covers keyboard, wheel, the object list, the detail card, the return to Earth, and axe.
