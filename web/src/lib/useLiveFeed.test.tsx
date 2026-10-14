import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../test/fixtures/live.json';
import { useLiveFeed } from './useLiveFeed';
import { getLive, LiveError } from './api';
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  useSample: false,
}));
const response = () =>
  new Response(JSON.stringify(fixture), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(fixture.generated_at));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('live polling', () => {
  it('fetches immediately, then every 60s; pauses hidden tabs and resumes when visible', async () => {
    const fetcher = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useLiveFeed);
    await flush();
    expect(result.current.events).toHaveLength(18);
    expect(result.current.newIds.size).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });
  it('keeps cached records and retries after 5s, 15s, 60s, resetting on recovery', async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(response)
      .mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useLiveFeed);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(result.current.events).toHaveLength(18);
    expect(result.current.attempt).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockImplementation(response);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(result.current.error).toBeNull();
    expect(result.current.attempt).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('exposes a first-load request ID and retries without a sample fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 503, headers: { 'X-Request-ID': 'request-live-503' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useLiveFeed);
    await flush();
    expect(result.current.events).toEqual([]);
    expect(result.current.updatedAt).toBeNull();
    expect(result.current.error?.requestId).toBe('request-live-503');
    fetcher.mockImplementation(response);
    act(() => result.current.retry());
    await flush();
    expect(result.current.events).toHaveLength(18);
  });
  it('rejects malformed payloads with the real request identifier', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{}', { headers: { 'X-Request-ID': 'invalid-payload' } })),
    );
    await expect(getLive()).rejects.toEqual(
      new LiveError('invalid-payload', 'Invalid live response'),
    );
  });
});
