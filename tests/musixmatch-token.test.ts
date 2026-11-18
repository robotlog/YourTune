import { expect, test } from '@playwright/test';

import {
  cooldownUntil,
  isCurrentRetry,
  isUnavailableToken,
  MusixMatchTokenRejected,
  retryDelay,
  retryRejectedToken,
  shouldRefreshToken,
} from '../src/plugins/synced-lyrics/providers/musixmatch-token';

test('all-zero MusixMatch tokens are unavailable', () => {
  expect(isUnavailableToken('0000000000000000')).toBe(true);
  expect(isUnavailableToken('abc123def456')).toBe(false);
  expect(isUnavailableToken('')).toBe(false);
});

test('cooldowns expire after ten minutes or one hour for unavailable tokens', () => {
  expect(cooldownUntil(1000, false)).toBe(601_000);
  expect(cooldownUntil(1000, isUnavailableToken('0000'))).toBe(3_601_000);
});

test('rejected token is refreshed once and retried', async () => {
  let attempts = 0;
  let refreshes = 0;
  const result = await retryRejectedToken(
    async () => {
      if (++attempts === 1) throw new MusixMatchTokenRejected('old');
      return 'lyrics';
    },
    async () => {
      refreshes++;
    },
  );
  expect(result).toBe('lyrics');
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
});

test('a second rejection stops retrying', async () => {
  let attempts = 0;
  let refreshes = 0;
  await expect(
    retryRejectedToken(
      async () => {
        attempts++;
        throw new MusixMatchTokenRejected('old');
      },
      async () => {
        refreshes++;
      },
    ),
  ).rejects.toBeInstanceOf(MusixMatchTokenRejected);
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
});

test('retry delay is bounded at zero', () => {
  expect(retryDelay(2000, 1000)).toBe(1000);
  expect(retryDelay(1000, 2000)).toBe(0);
});

test('retry only applies to the current song and search', () => {
  expect(isCurrentRetry('a', 'a', 1, 1)).toBe(true);
  expect(isCurrentRetry('a', 'b', 1, 1)).toBe(false);
  expect(isCurrentRetry('a', 'a', 1, 2)).toBe(false);
});

test('a late rejection does not refresh a replaced token', () => {
  expect(shouldRefreshToken('old', 'old')).toBe(true);
  expect(shouldRefreshToken('old', 'new')).toBe(false);
});
