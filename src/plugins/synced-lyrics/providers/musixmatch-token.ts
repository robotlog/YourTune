export const isUnavailableToken = (token: string) => /^0+$/.test(token);

export const cooldownUntil = (now: number, unavailable: boolean) =>
  now + (unavailable ? 3_600_000 : 600_000);

export class MusixMatchTokenRejected extends Error {
  constructor(public readonly token: string) {
    super();
  }
}

export const shouldRefreshToken = (rejected: string, current: string | null) =>
  rejected === current;

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
