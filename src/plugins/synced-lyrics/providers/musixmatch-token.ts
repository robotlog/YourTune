export const isUnavailableToken = (token: string) => /^0+$/.test(token);

export const cooldownUntil = (now: number, unavailable: boolean) =>
  now + (unavailable ? 3_600_000 : 600_000);

export class MusixMatchUnavailable extends Error {
  constructor(public readonly retryAt: number) {
    super();
  }
}
export class MusixMatchTokenRejected extends Error {
  constructor(public readonly token: string) {
    super();
  }
}

export const shouldRefreshToken = (rejected: string, current: string | null) =>
  rejected === current;

export const retryDelay = (retryAt: number, now: number) =>
  Math.max(0, retryAt - now);

export const isCurrentRetry = (
  videoId: string,
  currentVideoId: string,
  generation: number,
  currentGeneration: number,
) => videoId === currentVideoId && generation === currentGeneration;

export async function retryRejectedToken<T>(
  query: () => Promise<T>,
  refresh: (token: string) => Promise<void>,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (!(error instanceof MusixMatchTokenRejected)) throw error;
    await refresh(error.token);
    return query();
  }
}
