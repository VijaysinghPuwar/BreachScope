import { useCallback, useEffect, useState } from 'react';
import type { Observation } from '../data/events';
import { toObservation, type LiveSource } from '../data/live';
import { getLive, LiveError, useSample } from './api';
import { mergeEvents } from './live';
interface FeedState {
  events: Observation[];
  sources: LiveSource[];
  newIds: Set<string>;
  updatedAt: number | null;
  error: LiveError | null;
  attempt: number;
}
const hidden = () => document.visibilityState === 'hidden';
export function useLiveFeed() {
  const [state, setState] = useState<FeedState>({
    events: [],
    sources: [],
    newIds: new Set(),
    updatedAt: null,
    error: null,
    attempt: 0,
  });
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let disposed = false;
    let failures = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (disposed || hidden()) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 20000);
      try {
        const data = useSample ? null : await getLive(controller.signal);
        const events = data
          ? data.events.map(toObservation)
          : (await import('../data/sample')).sampleEvents;
        if (disposed || controller.signal.aborted) return;
        failures = 0;
        setState((previous) => ({
          ...mergeEvents(previous.events, events, previous.updatedAt === null),
          sources: data?.sources ?? [],
          updatedAt: Date.now(),
          error: null,
          attempt: 0,
        }));
        if (!useSample) timer = setTimeout(poll, 60000);
      } catch (error) {
        if (disposed || hidden()) return;
        failures++;
        setState((previous) => ({
          ...previous,
          error:
            error instanceof LiveError
              ? error
              : new LiveError(crypto.randomUUID(), 'Live request timed out'),
          attempt: failures,
        }));
        timer = setTimeout(poll, [5000, 15000, 60000][Math.min(failures - 1, 2)]);
      } finally {
        clearTimeout(timeout);
        controller = undefined;
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (hidden()) controller?.abort();
      else if (!controller) void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [retryKey]);
  return { ...state, now, retry };
}
