import { lazy, Suspense, type ReactNode } from 'react';
import { MapErrorBoundary } from '../map/MapErrorBoundary';
import { List } from 'lucide-react';
import type { Observation, DataClass } from '../data/events';
import type { Layers, MapActions, Projection } from '../map/types';
import type { useViewport } from '../lib/useViewport';
import type { LiveError } from '../lib/api';
import { Banner, BottomSheet, Button, Chip, Drawer, Skeleton, type SnapPoint } from './ui';
import { MapControls } from './MapControls';
import { MapLegend } from './MapLegend';
import { PerformanceHud } from './PerformanceHud';
const MapCanvas = lazy(() => import('../map/MapCanvas'));
export function ConsoleView(p: {
  viewport: ReturnType<typeof useViewport>;
  selection: Observation | null;
  collapsed: boolean;
  feedOpen: boolean;
  feed: ReactNode;
  panel: ReactNode;
  events: Observation[];
  projection: Projection;
  onProjection(value: Projection): void;
  layers: Layers;
  onLayers(value: Layers): void;
  reducedMotion: boolean;
  selected: string | null;
  onSelect(event: Observation): void;
  mapActions: MapActions | null;
  onReady(value: MapActions): void;
  openFeed(): void;
  classes: DataClass[];
  toggleClass(code: DataClass): void;
  onSpace(): void;
  search: string;
  clearSearch(): void;
  hud: boolean;
  error: LiveError | null;
  updatedAt: number | null;
  attempt: number;
  retry(): void;
  snap: SnapPoint;
  onSnap(value: SnapPoint): void;
  closePanel(): void;
}) {
  const { viewport, selection } = p;
  const collapsed = p.collapsed || (!!selection && viewport.width >= 1280 && viewport.width < 1300);
  return (
    <main
      id="main"
      className={`console ${selection ? 'has-selection' : ''} ${collapsed ? 'feed-collapsed' : ''} ${p.feedOpen ? 'feed-open' : ''} ${viewport.portrait ? 'is-portrait' : ''}`}
      aria-label="Live Console"
    >
      {!viewport.mobile && !viewport.tablet && (
        <aside className="desktop-feed" aria-label="Feed">
          {collapsed ? (
            <div className="feed-rail">
              <Button iconOnly aria-label="Open feed" onClick={p.openFeed}>
                <List />
              </Button>
              <span className="rail-count mono">{p.events.length}</span>
            </div>
          ) : (
            p.feed
          )}
        </aside>
      )}
      <section
        className={`map-area ${viewport.tablet && selection && !viewport.portrait ? 'map-with-drawer' : ''}`}
        aria-label="Observation map"
      >
        <h1 className="sr-only">Live Console</h1>
        <MapErrorBoundary>
          <Suspense
            fallback={
              <div className="map-loading" role="status">
                <Skeleton className="map-skeleton" />
                <span>Loading map…</span>
              </div>
            }
          >
            <MapCanvas
              projection={p.projection}
              events={p.events}
              selected={p.selected}
              layers={p.layers}
              mobile={viewport.mobile}
              reducedMotion={p.reducedMotion}
              onSelect={p.onSelect}
              onReady={p.onReady}
              onTable={p.openFeed}
              onSpace={p.onSpace}
              summary={`Map: ${p.events.length} events`}
            />
          </Suspense>
        </MapErrorBoundary>
        <MapControls
          projection={p.projection}
          onProjection={p.onProjection}
          layers={p.layers}
          onLayers={p.onLayers}
          actions={p.mapActions}
          mobile={viewport.mobile}
          classes={p.classes}
          onToggleClass={p.toggleClass}
          onSpace={p.onSpace}
        />
        {p.search && (
          <div className="map-filter">
            <Chip onRemove={p.clearSearch}>{p.search}</Chip>
          </div>
        )}
        {p.hud && <PerformanceHud />}
        {!viewport.mobile && <MapLegend />}
        <div className="map-attribution">
          DB-IP Lite (CC BY 4.0) · abuse.ch · SANS ISC DShield · CISA · Natural Earth · OpenFreeMap
          · © OpenStreetMap contributors
        </div>
        {p.error && (
          <div className="connection-banner" role="alert">
            <Banner>
              {p.updatedAt === null
                ? `Something went wrong on our side. Request ID ${p.error.requestId}. Try again.`
                : `Connection lost. Reconnecting (attempt ${p.attempt}). Last update ${new Date(p.updatedAt).toISOString().slice(11, 19)} UTC.`}
            </Banner>
            <Button onClick={p.retry}>Retry</Button>
          </div>
        )}
      </section>
      {!viewport.mobile && !viewport.tablet && selection && (
        <aside className="desktop-panel" aria-label="Event detail">
          {p.panel}
        </aside>
      )}
      {viewport.tablet && p.feedOpen && (
        <Drawer side="left" label="Feed">
          {p.feed}
        </Drawer>
      )}
      {viewport.tablet &&
        selection &&
        (viewport.portrait ? (
          <BottomSheet portrait snap="half" onSnap={p.closePanel} label="Event detail">
            {p.panel}
          </BottomSheet>
        ) : (
          <Drawer side="right" label="Event detail">
            {p.panel}
          </Drawer>
        ))}
      {viewport.mobile && (
        <BottomSheet snap={p.snap} onSnap={p.onSnap} label={selection ? 'Event detail' : 'Feed'}>
          {p.panel ?? p.feed}
        </BottomSheet>
      )}
    </main>
  );
}
