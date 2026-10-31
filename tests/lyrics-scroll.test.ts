import { expect, test } from '@playwright/test';

import { scrollToCurrentLine } from '../src/plugins/synced-lyrics/renderer/scroll';

import type { VirtualizerHandle } from 'virtua/solid';

test('waits for measurements and skips a no-op smooth scroll (#52)', () => {
  const calls: number[] = [];
  const handle = {
    viewportSize: 0,
    scrollSize: 400,
    scrollOffset: 0,
    getItemOffset: (index: number) => index * 80,
    getItemSize: () => 80,
    scrollToIndex: (index: number) => calls.push(index),
  } as unknown as VirtualizerHandle;

  scrollToCurrentLine(handle, 1);
  expect(calls).toEqual([]);

  Object.assign(handle, { viewportSize: 200 });
  scrollToCurrentLine(handle, 1);
  expect(calls).toEqual([1]);

  Object.assign(handle, { scrollOffset: 20 });
  scrollToCurrentLine(handle, 1);
  expect(calls).toEqual([1]);

  scrollToCurrentLine(handle, 3);
  expect(calls).toEqual([1, 3]);
});
