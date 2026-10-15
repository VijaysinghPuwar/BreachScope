import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  dataClasses,
  initialClasses,
  eventTime,
  type DataClass,
  type Observation,
} from './data/events';
import { matchesFilters, useLiveFeed, useSample } from './lib/api';
import { useReducedMotion, useViewport } from './lib/useViewport';
import { defaultLayers, type MapActions, type Projection } from './map/types';
import { Button, type SnapPoint } from './components/ui';
import { ChevronUp } from 'lucide-react';
import { Feed } from './components/Feed';
import { EventPanel } from './components/EventPanel';
import { TimelineBar } from './components/TimelineBar';
import { TopBar } from './components/TopBar';
import { ConsoleView } from './components/ConsoleView';
import { ConsoleDialogs } from './components/ConsoleDialogs';
import { Pages } from './components/Pages';
import { Intro } from './components/Intro';
import { ArrivalToast } from './components/ArrivalToast';
import { Onboarding, type GuideState } from './components/Onboarding';
import { guideSeen } from './lib/guide';

const SpaceView = lazy(() => import('./space/SpaceView'));
import { navigation } from './data/navigation';
export default function App() {
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();
  const live = useLiveFeed();
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const isConsole = path === '/' || path === '/space';
  const [classes, setClasses] = useState<DataClass[]>(
    new URLSearchParams(window.location.search).get('sim') === '1'
      ? [...dataClasses]
      : [...initialClasses],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [projection, setProjection] = useState<Projection>(viewport.mobile ? 'Flat' : 'Globe');
  const [layers, setLayers] = useState(defaultLayers);
  const [mapActions, setMapActions] = useState<MapActions | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  // First view is the map alone; the feed and timeline open on request.
  const [collapsed, setCollapsed] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // The space view has its own address so it can be shared and the browser
  // back button returns to Earth.
  const [space, setSpace] = useState(path === '/space');
  const goToSpace = useCallback((on: boolean) => {
    setSpace(on);
    window.history.pushState(null, '', on ? '/space' : '/');
  }, []);
  // Once the globe is up, fetch the space view in idle time so zooming out
  // past Earth opens it without a download pause.
  useEffect(() => {
    if (!mapActions) return;
    const load = () => void import('./space/SpaceView');
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(load, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(load, 3000);
    return () => clearTimeout(timer);
  }, [mapActions]);
  useEffect(() => {
    const onPop = () => setSpace(window.location.pathname === '/space');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [snap, setSnap] = useState<SnapPoint>('peek');
  const [replay, setReplay] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [pausedEvents, setPausedEvents] = useState<Observation[] | null>(null);
  const [hud, setHud] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  // First visit: a short welcome once the map is up, with an optional tour.
  // Until the visitor acts, the guide follows `firstVisit`; after that, their choice.
  // A visitor who followed a link to one record came for that record.
  const [firstVisit] = useState(
    () => !guideSeen() && !new URLSearchParams(window.location.search).has('event'),
  );
  const [guideChoice, setGuide] = useState<GuideState | undefined>(undefined);
  const guide =
    guideChoice !== undefined ? guideChoice : firstVisit && mapActions && !space ? 'welcome' : null;
  const counts = useMemo(() => {
    const result: Partial<Record<DataClass, number>> = {};
    for (const event of live.events) result[event.data_class] = (result[event.data_class] ?? 0) + 1;
    return result;
  }, [live.events]);
  const events = pausedEvents ?? live.events;
  const queued = pausedEvents
    ? live.events.filter((e) => !pausedEvents.some((p) => p.event_uid === e.event_uid)).length
    : 0;
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          matchesFilters(event, { classes, search }) &&
          (playhead === null || !replay || Date.parse(eventTime(event)) <= playhead),
      ),
    [events, classes, search, playhead, replay],
  );
  const selection = visibleEvents.find((event) => event.event_uid === selected) ?? null;
  // Reports link to `/?event=<uid>` so a row opens in the console.
  const linkedEvent = useRef(new URLSearchParams(window.location.search).get('event'));
  useEffect(() => {
    const uid = linkedEvent.current;
    if (!uid || !live.events.some((event) => event.event_uid === uid)) return;
    linkedEvent.current = null;
    setSelected(uid);
    if (viewport.mobile) setSnap('full');
  }, [live.events, viewport.mobile]);
  const toggleClass = (code: DataClass) =>
    setClasses((previous) =>
      previous.includes(code) ? previous.filter((value) => value !== code) : [...previous, code],
    );
  const selectEvent = useCallback(
    (event: Observation) => {
      setSelected(event.event_uid);
      if (viewport.mobile) setSnap('full');
      if (viewport.tablet) setFeedOpen(false);
    },
    [viewport.mobile, viewport.tablet],
  );
  const openFeed = () => {
    setFeedOpen(true);
    setCollapsed(false);
    if (viewport.mobile) setSnap('half');
    if (viewport.mobile || viewport.tablet) setSelected(null);
  };
  const closePanel = () => {
    setSelected(null);
    if (viewport.mobile) setSnap('peek');
  };
  const clearFilters = () => {
    setClasses([...initialClasses]);
    setSearch('');
    setReplay(false);
    setPlayhead(null);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === 'Escape') {
        setSelected(null);
        setFeedOpen(false);
        // On a phone a closed detail must give the map back, not leave a
        // full-height empty sheet over it.
        setSnap('peek');
        setSearchOpen(false);
        setMoreOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (
        target.matches('input, textarea, select') ||
        target.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setHud((value) => !value);
        return;
      }
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (event.key.toLowerCase() === 'g')
        setProjection((value) => (value === 'Flat' ? 'Globe' : 'Flat'));
      if (['j', 'k'].includes(event.key.toLowerCase()) && visibleEvents.length) {
        event.preventDefault();
        const index = visibleEvents.findIndex((item) => item.event_uid === selected);
        const next =
          visibleEvents[
            (index + (event.key.toLowerCase() === 'j' ? 1 : -1) + visibleEvents.length) %
              visibleEvents.length
          ]!;
        selectEvent(next);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>(`[data-uid="${CSS.escape(next.event_uid)}"]`)
            ?.scrollIntoView({ block: 'nearest' }),
        );
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [selected, visibleEvents, selectEvent]);
  useEffect(() => {
    document.title = `BreachScope | ${path === '/' ? 'Live Console' : (navigation.find(([, route]) => route === path)?.[0] ?? 'BreachScope')}`;
  }, [path]);
  const status = useSample
    ? 'Sample data'
    : live.error
      ? 'Reconnecting'
      : live.updatedAt === null
        ? 'Connecting…'
        : `Live · ${live.newIds.size} new in last poll · updated ${Math.max(0, Math.floor((live.now - live.updatedAt) / 1000))}s ago`;
  const feed = (
    <Feed
      events={visibleEvents}
      selected={selected}
      onSelect={selectEvent}
      onCollapse={
        viewport.mobile
          ? undefined
          : () => {
              setFeedOpen(false);
              setCollapsed(true);
            }
      }
      clearFilters={clearFilters}
      sample={useSample}
      paused={pausedEvents !== null}
      onPause={() => setPausedEvents((previous) => (previous ? null : live.events))}
      queued={queued}
      mini={viewport.mobile && snap === 'peek'}
      newIds={live.newIds}
      now={live.now}
    />
  );
  const panel = selection ? (
    <EventPanel
      key={selection.event_uid}
      event={selection}
      onClose={closePanel}
      back={viewport.mobile}
      sample={useSample}
      now={live.now}
    />
  ) : null;
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <div className={`app ${viewport.mobile ? 'is-mobile' : ''} ${replay ? 'is-replay' : ''}`}>
        {/* Only the console waits for the map; text pages show their own skeletons. */}
        {isConsole && (
          <Intro
            feedsLoaded={live.updatedAt !== null || live.error !== null}
            mapReady={mapActions !== null || space || live.error !== null}
            eventCount={live.events.length}
          />
        )}
        {space && (
          <div className="space-screen">
            <Suspense fallback={null}>
              <SpaceView reducedMotion={reducedMotion} onReturnToEarth={() => goToSpace(false)} />
            </Suspense>
          </div>
        )}
        {isConsole && !space && (
          <ArrivalToast
            events={live.events}
            newIds={live.newIds}
            now={live.now}
            // Quiet while someone reads a record or the guide, so it never covers them.
            enabled={mapActions !== null && !replay && !selection && guide === null}
            onSelect={selectEvent}
          />
        )}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <TopBar
          path={path}
          mobile={viewport.mobile}
          tablet={viewport.tablet}
          sample={useSample}
          replay={replay}
          onReplay={setReplay}
          classes={classes}
          onToggleClass={toggleClass}
          onSearch={() => setSearchOpen(true)}
          onFeed={openFeed}
          status={status}
          sources={live.sources}
          now={live.now}
          counts={counts}
          onGuide={() => setGuide('tour')}
        />
        {useSample && (
          <div className="sample-banner" role="status">
            Sample data. Live feeds are not connected yet.
          </div>
        )}
        {isConsole ? (
          <>
            <ConsoleView
              viewport={viewport}
              selection={selection}
              collapsed={collapsed}
              feedOpen={feedOpen}
              feed={feed}
              panel={panel}
              events={visibleEvents}
              projection={projection}
              onProjection={setProjection}
              layers={layers}
              onLayers={setLayers}
              reducedMotion={reducedMotion}
              selected={selected}
              onSelect={selectEvent}
              mapActions={mapActions}
              onReady={setMapActions}
              openFeed={openFeed}
              classes={classes}
              toggleClass={toggleClass}
              onSpace={() => goToSpace(true)}
              search={search}
              clearSearch={() => setSearch('')}
              hud={hud}
              error={live.error}
              updatedAt={live.updatedAt}
              attempt={live.attempt}
              retry={live.retry}
              snap={snap}
              onSnap={setSnap}
              closePanel={closePanel}
              honeypot={live.sources.some((source) => source.data_class === 'telemetry')}
            />
            {!viewport.mobile && !replay && !timelineOpen && (
              <div className="timeline-toggle">
                <Button variant="ghost" onClick={() => setTimelineOpen(true)} data-tour="timeline">
                  <ChevronUp aria-hidden="true" />
                  Show timeline
                </Button>
              </div>
            )}
            {((!viewport.mobile && (timelineOpen || replay)) || (viewport.mobile && replay)) && (
              <TimelineBar
                events={events.filter((event) => matchesFilters(event, { classes, search }))}
                now={live.now}
                sample={useSample}
                replay={replay}
                mobile={viewport.mobile}
                onReplay={setReplay}
                onPlayhead={setPlayhead}
                onHide={replay ? undefined : () => setTimelineOpen(false)}
              />
            )}
          </>
        ) : (
          <Pages
            path={path}
            events={live.events}
            sources={live.sources}
            now={live.now}
            loading={live.updatedAt === null && live.error === null}
          />
        )}
        <ConsoleDialogs
          mobile={viewport.mobile}
          path={path}
          replay={replay}
          onReplay={setReplay}
          moreOpen={moreOpen}
          onMore={setMoreOpen}
          searchOpen={searchOpen}
          onSearchOpen={setSearchOpen}
          search={search}
          onSearch={setSearch}
          classes={classes}
          toggleClass={toggleClass}
          events={visibleEvents}
          onSelect={selectEvent}
          openFeed={openFeed}
        />
        {isConsole && !space && <Onboarding state={guide} onState={setGuide} />}
        <div className="sr-only" role="status" aria-live="polite">
          {live.newIds.size > 0 ? `${live.newIds.size} new events` : ''}
        </div>
      </div>
    </TooltipPrimitive.Provider>
  );
}
