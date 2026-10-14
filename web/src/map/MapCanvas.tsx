import { useEffect, useRef, useState } from 'react';
import {
  Map,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type ExpressionSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { eventTime, severityLabels, utc, type Observation } from '../data/events';
import { mapFeatures } from '../lib/geometry';
import { countryCodes, countryOnly, locationLabel } from '../lib/location';
import { Banner, Button } from '../components/ui';
import { mapStyle } from './style';
import type { Layers, MapActions, Projection } from './types';
import { ArrivalRings } from './arrivals';
setWorkerUrl(workerUrl);
interface Props {
  projection: Projection;
  events: Observation[];
  selected: string | null;
  layers: Layers;
  mobile: boolean;
  reducedMotion: boolean;
  onSelect(event: Observation): void;
  onReady(actions: MapActions): void;
  onTable(): void;
  onSpace(): void;
  summary: string;
}
// The sphere's diameter scales with 512 * 2^zoom / pi at the equator.
const defaultZoom = (height: number) => Math.max(0, Math.log2((height * 0.8 * Math.PI) / 512));
export default function MapCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const current = useRef(props);
  const [ready, setReady] = useState(false);
  const arrivals = useRef<ArrivalRings | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Observation | null>(null);
  useEffect(() => {
    current.current = props;
  });
  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    let disposed = false;
    try {
      instance = new Map({
        container: container.current,
        center: [-28, 25],
        zoom: defaultZoom(container.current.clientHeight),
        // Smaller than this the globe is a speck; scrolling further out hands
        // over to the space view instead.
        minZoom: 0.6,
        maxZoom: 12,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        canvasContextAttributes: { antialias: true },
        style: mapStyle(current.current.projection),
      });
      map.current = instance;
      instance.touchZoomRotate.disableRotation();
      // Keep scrolling out at the widest view and the camera leaves Earth for
      // the space view. A little resistance first, so it never happens by accident.
      // Trackpads send many small deltas and mouse wheels a few large ones, so
      // count both. Zoom eases after each step, so the count survives the
      // easing and only resets after a pause or a zoom back in.
      let pushOut = 0;
      let steps = 0;
      let last = 0;
      instance.getCanvasContainer().addEventListener(
        'wheel',
        (event) => {
          const now = performance.now();
          if (event.deltaY <= 0 || now - last > 1200) {
            pushOut = 0;
            steps = 0;
          }
          last = now;
          if (event.deltaY <= 0) return;
          // Zoom settles a little above the minimum, so allow some slack.
          if (instance.getZoom() > instance.getMinZoom() + 0.3) return;
          pushOut += event.deltaY;
          steps += 1;
          if (pushOut > 300 || steps > 8) {
            pushOut = 0;
            steps = 0;
            current.current.onSpace();
          }
        },
        { passive: true },
      );
      instance.getCanvas().setAttribute('aria-label', current.current.summary);
      instance.getCanvas().setAttribute('role', 'img');
      // MapLibre reports every failed tile or glyph download as an 'error'.
      // Those are transient and the map keeps working, so only log them; a
      // lost WebGL context (below) or a failed start (catch) is fatal.
      instance.on('error', (event) => {
        console.warn('Map resource error', event.error?.message ?? event);
      });
      instance.on('webglcontextlost', () => {
        if (!disposed) setFailed(true);
      });
      instance.on('load', () => {
        if (disposed) return;
        const findEvent = (event: MapMouseEvent) => {
          const radius = current.current.mobile ? 24 : 8;
          const points = instance.queryRenderedFeatures(
            [
              [event.point.x - radius, event.point.y - radius],
              [event.point.x + radius, event.point.y + radius],
            ],
            { layers: ['points'] },
          );
          const point = current.current.events.find(
            (item) => item.event_uid === points[0]?.properties.uid,
          );
          if (point) return point;
          const countries = instance.queryRenderedFeatures(event.point, {
            layers: ['country-shading'],
          });
          return current.current.events.find(
            (item) => countryOnly(item) && item.country_code === countries[0]?.properties.iso_a2,
          );
        };
        instance.on('click', (event) => {
          const item = findEvent(event);
          if (item) current.current.onSelect(item);
        });
        instance.on('mousemove', (event) => {
          const item = findEvent(event);
          setHover(item ?? null);
          instance.getCanvas().style.cursor = item ? 'pointer' : '';
        });
        instance.getCanvas().addEventListener('mouseleave', () => setHover(null));
        instance.addControl(new ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-left');
        current.current.onReady({
          zoom(delta) {
            instance.zoomTo(instance.getZoom() + delta, {
              duration: current.current.reducedMotion ? 0 : 200,
            });
          },
          reset() {
            instance.easeTo({
              center: [-28, 25],
              zoom: defaultZoom(container.current!.clientHeight),
              bearing: 0,
              pitch: 0,
              duration: current.current.reducedMotion ? 0 : 600,
            });
          },
        });
        // The first frame can be drawn before the container has its final
        // size, which stretches the globe into an oval. Size it now; the
        // canvas stays invisible until ready (see .map-canvas in app.css).
        instance.resize();
        setReady(true);
      });
    } catch {
      queueMicrotask(() => {
        if (!disposed) setFailed(true);
      });
      return () => {
        disposed = true;
      };
    }
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      disposed = true;
      observer.disconnect();
      arrivals.current?.destroy();
      arrivals.current = null;
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const type = props.projection === 'Flat' ? 'mercator' : 'globe';
    const cancel = whenStyleReady(instance, () => instance.setProjection({ type }));
    if (!props.reducedMotion)
      instance.getCanvas().animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 600 });
    return cancel;
  }, [props.projection, props.reducedMotion, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    return whenStyleReady(instance, () => {
      (instance.getSource('observations') as GeoJSONSource | undefined)?.setData(
        mapFeatures(props.events),
      );
      arrivals.current ??= new ArrivalRings(instance, () => current.current.reducedMotion);
      arrivals.current.update(props.events);
      const countries = countryCodes(props.events);
      for (const layer of ['country-shading', 'country-approximation'])
        instance.setFilter(layer, ['in', ['get', 'iso_a2'], ['literal', countries]]);
      const visibility = {
        arcs: props.layers.arcs,
        points: props.layers.points,
        'location-labels': props.layers.points,
        'country-shading': props.layers.points,
        'country-approximation': props.layers.points,
        accuracy: props.layers.accuracy,
        sensor: props.layers.sensors,
        borders: props.layers.borders,
        graticule: props.layers.graticule && props.projection === 'Globe',
      };
      Object.entries(visibility).forEach(([id, visible]) =>
        instance.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'),
      );
    });
  }, [props.events, props.layers, props.projection, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    return whenStyleReady(instance, () => {
      const selected = props.events.find((event) => event.event_uid === props.selected);
      (instance.getSource('selection') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features:
          selected?.coordinates && !countryOnly(selected)
            ? [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'Point', coordinates: selected.coordinates },
                },
              ]
            : [],
      });
      // Rings and location labels only for the selected and hovered marks;
      // drawn for every point they bury the map.
      const focused: ExpressionSpecification = [
        'literal',
        [props.selected, hover?.event_uid].filter((uid): uid is string => !!uid),
      ];
      instance.setFilter('accuracy', [
        'all',
        ['==', ['get', 'kind'], 'accuracy'],
        ['in', ['get', 'uid'], focused],
      ]);
      instance.setFilter('location-labels', [
        'all',
        ['==', ['get', 'kind'], 'point'],
        ['in', ['get', 'uid'], focused],
      ]);
    });
  }, [props.selected, props.events, hover, ready]);
  useEffect(() => {
    if (ready) map.current?.getCanvas().setAttribute('aria-label', props.summary);
  }, [props.summary, ready]);
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        data-testid="map-canvas"
        data-ready={ready}
        data-projection={props.projection}
      />
      {failed && (
        <div className="map-failure" role="status">
          <Banner>This device can't draw the map. Feed, tables and timeline still work.</Banner>
          <Button onClick={props.onTable}>Open table view</Button>
        </div>
      )}
      {hover && !failed && (
        <div className="map-hover">
          <strong>{hover.category}</strong>
          <span className="mono">
            {[hover.src, hover.asn, hover.country].filter(Boolean).join(' · ')}
          </span>
          <span className="mono">{utc(eventTime(hover))} UTC</span>
          <span>{locationLabel(hover)}</span>
          <span>
            {hover.data_class} · {severityLabels[hover.severity]}
          </span>
          <span>Click for provenance</span>
        </div>
      )}
    </>
  );
}

/**
 * Runs a style change now, or once the style has finished (re)loading if it is
 * mid-load. MapLibre throws "Style is not done loading" otherwise. Returns a
 * cleanup that drops a still-pending run, for use as an effect cleanup.
 */
function whenStyleReady(instance: Map, apply: () => void): () => void {
  try {
    apply();
    return () => {};
  } catch {
    const run = () => {
      try {
        apply();
      } catch (error) {
        console.warn('Map update skipped', error);
      }
    };
    instance.once('style.load', run);
    return () => instance.off('style.load', run);
  }
}
