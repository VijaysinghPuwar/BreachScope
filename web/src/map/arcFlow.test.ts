import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { Map } from 'maplibre-gl';
import { ArcFlow, splitAtAntimeridian } from './arcFlow';
import { greatCircle } from '../lib/geometry';

function fakeMap() {
  const setData = vi.fn();
  const map = { getSource: () => ({ setData }) } as unknown as Map;
  return { map, setData };
}

const arcs: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { uid: 'a', kind: 'arc' },
      geometry: greatCircle([-100, 40], [10, 50]),
    },
  ],
};

describe('ArcFlow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws a fading trail and a tip on each arc', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ((frame = cb), 1));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { map, setData } = fakeMap();
    new ArcFlow(map, () => false).update(arcs);
    frame?.(1000);
    const data = setData.mock.calls.at(-1)?.[0] as FeatureCollection;
    const lines = data.features.filter((f) => f.geometry.type === 'LineString');
    const tips = data.features.filter((f) => f.geometry.type === 'Point');
    expect(lines.length).toBeGreaterThan(0);
    expect(tips).toHaveLength(1);
    // The newest piece of the trail is the brightest.
    expect(lines.at(-1)?.properties?.fade).toBe(1);
  });

  it('draws nothing under reduced motion', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { map, setData } = fakeMap();
    new ArcFlow(map, () => true).update(arcs);
    expect(raf).not.toHaveBeenCalled();
    expect(setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
  });

  it('never joins a trail across the 180 degree line', () => {
    const parts = splitAtAntimeridian([
      [178, 70],
      [179.5, 71],
      [-179.5, 71.5],
      [-178, 72],
    ]);
    expect(parts).toEqual([
      [
        [178, 70],
        [179.5, 71],
      ],
      [
        [-179.5, 71.5],
        [-178, 72],
      ],
    ]);
  });
});
