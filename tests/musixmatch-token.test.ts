import { expect, test } from '@playwright/test';

import {
  cooldownUntil,
  isUnavailableToken,
  MusixMatchTokenRejected,
  retryRejectedToken,
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
      if (++attempts === 1) throw new MusixMatchTokenRejected();
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
        throw new MusixMatchTokenRejected();
      },
      async () => {
        refreshes++;
      },
    ),
  ).rejects.toBeInstanceOf(MusixMatchTokenRejected);
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
});
