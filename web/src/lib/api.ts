import { classCodes, type LiveResponse } from '../data/live';
import type { DataClass, Observation } from '../data/events';
export { useLiveFeed } from './useLiveFeed';
export type { LiveResponse } from '../data/live';
export const useSample = import.meta.env.VITE_USE_SAMPLE === '1';
export class LiveError extends Error {
  constructor(
    public requestId: string,
    message: string,
  ) {
    super(message);
  }
}
export async function getLive(signal?: AbortSignal): Promise<LiveResponse> {
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch('/api/live', {
      signal,
      headers: { 'X-Request-ID': requestId },
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LiveError(requestId, 'Live request failed');
  }
  const id = response.headers.get('X-Request-ID') || requestId;
  if (!response.ok) throw new LiveError(id, `Live request failed (${response.status})`);
  try {
    const data = (await response.json()) as LiveResponse;
    if (
      !data ||
      !Array.isArray(data.events) ||
      !Array.isArray(data.sources) ||
      !Number.isFinite(Date.parse(data.generated_at)) ||
      !data.events.every(
        (e) =>
          e &&
          typeof e.event_uid === 'string' &&
          e.event_uid &&
          e.data_class in classCodes &&
          Number.isInteger(e.severity) &&
          e.severity >= 0 &&
          e.severity <= 4,
      )
    )
      throw new Error('Invalid live response');
    return data;
  } catch {
    throw new LiveError(id, 'Invalid live response');
  }
}
export function matchesFilters(
  event: Observation,
  filters: { classes?: DataClass[]; search?: string; severity?: number } = {},
) {
  return (
    (!filters.classes || filters.classes.includes(event.data_class)) &&
    (filters.severity === undefined || event.severity >= filters.severity) &&
    (!filters.search ||
      [
        event.src,
        event.asn,
        event.country,
        event.country_code,
        event.category,
        event.source,
        ...Object.values(event.attrs ?? {}),
      ]
        .join(' ')
        .toLowerCase()
        .includes(filters.search.trim().toLowerCase()))
  );
}
