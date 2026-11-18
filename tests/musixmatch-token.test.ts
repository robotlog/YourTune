import { expect, test } from '@playwright/test';

import { isUnavailableToken } from '../src/plugins/synced-lyrics/providers/musixmatch-token';

test('all-zero MusixMatch tokens are unavailable', () => {
  expect(isUnavailableToken('0000000000000000')).toBe(true);
  expect(isUnavailableToken('abc123def456')).toBe(false);
  expect(isUnavailableToken('')).toBe(false);
});
