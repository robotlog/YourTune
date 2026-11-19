import { expect, test } from '@playwright/test';

import {
  createSleepTimer,
  createSleepTimerBackend,
  pauseIfPlaying,
  type TimerClock,
} from '../src/plugins/sleep-timer/timer';

// Fake clock: advance() moves wall time and fires due timeouts in order.
const fakeClock = () => {
  let now = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock: TimerClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      pending.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clearTimeout: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending.entries()]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].fn();
    }
    now = target;
  };
  const jump = (ms: number) => (now += ms); // clock moves, no timer fires
  return { clock, advance, jump, pending, time: () => now };
};

test('sleep-timer: fires once at the wall-clock deadline', () => {
  const f = fakeClock();
  let fired = 0;
  const timer = createSleepTimer(() => (fired += 1), f.clock);
  timer.set(f.time() + 15 * 60_000);
  f.advance(15 * 60_000 - 1);
  expect(fired).toBe(0);
  f.advance(1);
  expect(fired).toBe(1);
  f.advance(60 * 60_000);
  expect(fired).toBe(1);
  expect(f.pending.size).toBe(0);
});

test('sleep-timer: cancel and replacement never fire the old callback', () => {
  const f = fakeClock();
  let fired = 0;
  const timer = createSleepTimer(() => (fired += 1), f.clock);
  timer.set(f.time() + 60_000);
  timer.cancel();
  f.advance(120_000);
  expect(fired).toBe(0);

  timer.set(f.time() + 60_000);
  timer.set(f.time() + 120_000);
  f.advance(60_000);
  expect(fired).toBe(0);
  f.advance(60_000);
  expect(fired).toBe(1);
});

test('sleep-timer: restart with persisted deadline keeps the original end', () => {
  const f = fakeClock();
  const deadline = f.time() + 30 * 60_000;
  f.jump(10 * 60_000); // app was closed for 10 minutes
  let fired = 0;
  const timer = createSleepTimer(() => (fired += 1), f.clock);
  timer.set(deadline);
  f.advance(20 * 60_000 - 1);
  expect(fired).toBe(0);
  f.advance(1);
  expect(fired).toBe(1);
});

test('sleep-timer: system suspend past the deadline fires on wake', () => {
  const f = fakeClock();
  let fired = 0;
  const timer = createSleepTimer(() => (fired += 1), f.clock);
  timer.set(f.time() + 15 * 60_000);
  f.jump(2 * 60 * 60_000); // timers frozen while suspended
  f.advance(30_000);
  expect(fired).toBe(1);
});

test('sleep-timer: null or past deadline schedules nothing', () => {
  const f = fakeClock();
  let fired = 0;
  const timer = createSleepTimer(() => (fired += 1), f.clock);
  timer.set(null);
  timer.set(f.time() - 1);
  expect(f.pending.size).toBe(0);
  expect(fired).toBe(0);
});

test('sleep-timer: expiry pauses a playing player and leaves a paused one', () => {
  let pauses = 0;
  const video = {
    paused: false,
    pause() {
      video.paused = true;
      pauses += 1;
    },
  };
  pauseIfPlaying(video);
  expect(video.paused).toBe(true);
  pauseIfPlaying(video);
  expect(pauses).toBe(1);

  const alreadyPaused = { paused: true, pause: () => (pauses += 10) };
  pauseIfPlaying(alreadyPaused);
  pauseIfPlaying(null);
  expect(pauses).toBe(1);
});

// Config store whose reads resolve only when release() is called.
const delayedStore = (deadline: number | null) => {
  const state = { deadline };
  const reads: (() => void)[] = [];
  return {
    state,
    getConfig: () =>
      new Promise<{ deadline: number | null }>((resolve) => {
        const snapshot = { ...state };
        reads.push(() => resolve(snapshot));
      }),
    setConfig: (c: { deadline: number | null }) => {
      state.deadline = c.deadline;
    },
    release: async () => {
      reads.splice(0).forEach((r) => r());
      await new Promise((r) => setImmediate(r));
    },
  };
};

test('sleep-timer backend: stop during start never arms the read deadline', async () => {
  const f = fakeClock();
  const store = delayedStore(f.time() + 60_000);
  let pauses = 0;
  const backend = createSleepTimerBackend(f.clock);
  const started = backend.start({ ...store, pause: () => (pauses += 1) });
  await backend.stop(store);
  await store.release();
  await started;
  expect(store.state.deadline).toBeNull();
  f.advance(120_000);
  expect(pauses).toBe(0);
  expect(f.pending.size).toBe(0);
});

test('sleep-timer backend: config change during start wins over the stale read', async () => {
  const f = fakeClock();
  const store = delayedStore(f.time() + 60_000);
  let pauses = 0;
  const backend = createSleepTimerBackend(f.clock);
  const started = backend.start({ ...store, pause: () => (pauses += 1) });
  backend.onConfigChange(f.time() + 5 * 60_000);
  await store.release();
  await started;
  f.advance(60_000);
  expect(pauses).toBe(0);
  f.advance(4 * 60_000);
  expect(pauses).toBe(1);

  const store2 = delayedStore(f.time() + 60_000);
  const again = backend.start({ ...store2, pause: () => (pauses += 10) });
  backend.onConfigChange(null);
  await store2.release();
  await again;
  f.advance(120_000);
  expect(pauses).toBe(1);
  expect(f.pending.size).toBe(0);
});

test('sleep-timer backend: newer start replaces a slower one', async () => {
  const f = fakeClock();
  const old = delayedStore(f.time() + 60_000);
  const fresh = delayedStore(f.time() + 3 * 60_000);
  let pauses = 0;
  const backend = createSleepTimerBackend(f.clock);
  const first = backend.start({ ...old, pause: () => (pauses += 100) });
  const second = backend.start({ ...fresh, pause: () => (pauses += 1) });
  await fresh.release();
  await old.release();
  await Promise.all([first, second]);
  f.advance(3 * 60_000);
  expect(pauses).toBe(1);
  expect(f.pending.size).toBe(0);
});

test('sleep-timer backend: disable clears, re-enable does not resurrect', async () => {
  const f = fakeClock();
  const store = delayedStore(f.time() + 30 * 60_000);
  let pauses = 0;
  const backend = createSleepTimerBackend(f.clock);
  const ctx = { ...store, pause: () => (pauses += 1) };
  const started = backend.start(ctx);
  await store.release();
  await started;
  f.advance(5 * 60_000);
  await backend.stop(store);
  expect(store.state.deadline).toBeNull();

  const restarted = backend.start(ctx);
  await store.release();
  await restarted;
  f.advance(60 * 60_000);
  expect(pauses).toBe(0);
  expect(f.pending.size).toBe(0);
});

test('sleep-timer backend: expiry pauses and clears only the matching deadline', async () => {
  const f = fakeClock();
  const deadline = f.time() + 60_000;
  const store = delayedStore(deadline);
  let pauses = 0;
  const backend = createSleepTimerBackend(f.clock);
  const started = backend.start({ ...store, pause: () => (pauses += 1) });
  await store.release();
  await started;
  f.advance(60_000);
  expect(pauses).toBe(1);
  await store.release();
  expect(store.state.deadline).toBeNull();

  // A deadline chosen while the expiry read is in flight must survive.
  const next = f.time() + 60_000;
  store.setConfig({ deadline: next });
  backend.onConfigChange(next);
  f.advance(60_000);
  expect(pauses).toBe(2);
  const newer = f.time() + 10 * 60_000;
  store.setConfig({ deadline: newer });
  backend.onConfigChange(newer);
  await store.release(); // stale snapshot still says `next`
  expect(store.state.deadline).toBe(newer);
  f.advance(10 * 60_000);
  expect(pauses).toBe(3);
});

test('sleep-timer backend: persisted deadline survives an enabled restart', async () => {
  const f = fakeClock();
  const store = delayedStore(f.time() + 20 * 60_000);
  let pauses = 0;
  f.jump(5 * 60_000); // app closed, still enabled
  const started = createSleepTimerBackend(f.clock).start({
    ...store,
    pause: () => (pauses += 1),
  });
  await store.release();
  await started;
  f.advance(15 * 60_000 - 1);
  expect(pauses).toBe(0);
  f.advance(1);
  expect(pauses).toBe(1);
});

test('sleep-timer backend: a throwing pause still clears the deadline', async () => {
  const f = fakeClock();
  const store = delayedStore(f.time() + 60_000);
  const backend = createSleepTimerBackend(f.clock);
  const started = backend.start({
    ...store,
    pause: () => {
      throw new Error('Object has been destroyed');
    },
  });
  await store.release();
  await started;
  expect(() => f.advance(60_000)).not.toThrow();
  await store.release();
  expect(store.state.deadline).toBeNull();
});
