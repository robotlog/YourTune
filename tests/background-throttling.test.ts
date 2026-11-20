import { expect, test } from '@playwright/test';

import {
  restoreThrottlingOnFirstPlay,
  type ThrottlingTrigger,
} from '../src/utils/background-throttling';

const setup = (opts: { timeoutMs?: number } = {}) => {
  const calls: boolean[] = [];
  const triggers: ThrottlingTrigger[] = [];
  const state = { winDestroyed: false, contentsDestroyed: false };
  let closed: (() => void) | undefined;
  let play: (() => void) | undefined;
  let unsubscribed = 0;
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const win = {
    isDestroyed: () => state.winDestroyed,
    once: (_event: 'closed', fn: () => void) => void (closed = fn),
    webContents: {
      isDestroyed: () => state.contentsDestroyed,
      setBackgroundThrottling: (allowed: boolean) => void calls.push(allowed),
    },
  };

  restoreThrottlingOnFirstPlay({
    win,
    timeoutMs: opts.timeoutMs,
    onPlay: (listener) => {
      play = listener;
      return () => void unsubscribed++;
    },
    onRestore: (t) => void triggers.push(t),
    setTimeout: (fn) => {
      timers.set(nextId, fn);
      return nextId++;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  });

  return {
    calls,
    triggers,
    state,
    play: () => play?.(),
    close: () => closed?.(),
    fireTimer: () => [...timers.values()].forEach((fn) => fn()),
    pendingTimers: () => timers.size,
    unsubscribed: () => unsubscribed,
  };
};

test('playback turns throttling back on and cleans up', () => {
  const t = setup();
  expect(t.calls).toEqual([]);
  t.play();
  expect(t.calls).toEqual([true]);
  expect(t.triggers).toEqual(['play']);
  expect(t.pendingTimers()).toBe(0);
  expect(t.unsubscribed()).toBe(1);
});

test('the safety timer restores when nothing plays', () => {
  const t = setup();
  t.fireTimer();
  expect(t.calls).toEqual([true]);
  expect(t.triggers).toEqual(['timer']);
  expect(t.unsubscribed()).toBe(1);
});

test('closing the window restores and skips a destroyed window', () => {
  const t = setup();
  t.state.winDestroyed = true;
  t.close();
  expect(t.triggers).toEqual(['closed']);
  expect(t.calls).toEqual([]);
  expect(t.pendingTimers()).toBe(0);
});

test('a destroyed webContents is never touched', () => {
  const t = setup();
  t.state.contentsDestroyed = true;
  t.play();
  expect(t.calls).toEqual([]);
  expect(t.triggers).toEqual(['play']);
});

test('restores only once whatever fires next', () => {
  const t = setup();
  t.play();
  t.play();
  t.fireTimer();
  t.close();
  expect(t.calls).toEqual([true]);
  expect(t.triggers).toEqual(['play']);
  expect(t.unsubscribed()).toBe(1);
});
