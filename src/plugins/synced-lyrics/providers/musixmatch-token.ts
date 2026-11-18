export const isUnavailableToken = (token: string) => /^0+$/.test(token);

export const cooldownUntil = (now: number, unavailable: boolean) =>
  now + (unavailable ? 3_600_000 : 600_000);

export class MusixMatchUnavailable extends Error {}
export class MusixMatchTokenRejected extends Error {}

export async function retryRejectedToken<T>(
  query: () => Promise<T>,
  refresh: () => Promise<void>,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (!(error instanceof MusixMatchTokenRejected)) throw error;
    await refresh();
    return query();
  }
}
