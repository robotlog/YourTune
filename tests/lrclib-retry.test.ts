import { register } from 'node:module';

import { expect, test } from '@playwright/test';

import type { LRCLib as LRCLibClass } from '../src/plugins/synced-lyrics/providers/LRCLib';
import type { SearchSongInfo } from '../src/plugins/synced-lyrics/types';

// LRCLib only needs `config` from the Solid renderer, which cannot load under node:
// a resolve hook swaps that one module for a stub before LRCLib is imported.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.includes('/renderer/renderer')) {
    return {
      url: 'data:text/javascript,export const config = () => ({ showLyricsEvenIfInexact: globalThis.__lrclibInexact === true });',
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}`),
);
const { LRCLib } =
  (await import('../src/plugins/synced-lyrics/providers/LRCLib')) as {
    LRCLib: typeof LRCLibClass;
  };

type Call = {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal | null;
};
type Reply = Response | Error;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const status = (code: number, headers: HeadersInit = {}) =>
  new Response('<html>gateway</html>', { status: code, headers });

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Song',
  trackName: 'Song',
  artistName: 'Artist',
  albumName: 'Album',
  duration: 200,
  instrumental: false,
  plainLyrics: 'plain',
  syncedLyrics: '[00:01.00]line',
  ...over,
});

const song: SearchSongInfo = {
  title: 'Song',
  artist: 'Artist',
  songDuration: 200,
} as SearchSongInfo;

const realFetch = globalThis.fetch;
const realTimeout = globalThis.setTimeout;
const realRandom = Math.random;
const realAbortTimeout = AbortSignal.timeout.bind(AbortSignal);

let calls: Call[];
let delays: number[];

// Replays `replies` in order, records requests and every requested sleep (without sleeping).
const install = (replies: Reply[]) => {
  calls = [];
  delays = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: { ...(init?.headers as object) },
      signal: init?.signal,
    });
    const next = replies.shift();
    if (!next) return Promise.reject(new Error('unexpected extra request'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  Math.random = () => 0;
};

// setTimeout is stubbed only while LRCLib runs: the Playwright runner needs the real one.
const search = async (info: SearchSongInfo = song) => {
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
  try {
    return await new LRCLib().search(info);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
};

test.afterEach(() => {
  AbortSignal.timeout = realAbortTimeout;
  (globalThis as { __lrclibInexact?: boolean }).__lrclibInexact = false;
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realTimeout;
  Math.random = realRandom;
});

test('successful lookup is a single request and keeps the song selection', async () => {
  install([json([item()])]);
  const result = await search();

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('artist_name=Artist');
  expect(calls[0].url).toContain('track_name=Song');
  expect(calls[0].headers['Lrclib-Client']).toContain('YourTune');
  expect(delays).toEqual([]);
  expect(result?.title).toBe('Song');
  expect(result?.lyrics).toBe('plain');
  expect(result?.lines?.map((l) => l.text)).toContain('line');
});

for (const code of [429, 500, 502, 503, 504]) {
  test(`${code} is retried and then succeeds`, async () => {
    install([status(code), status(code), json([item()])]);
    const result = await search();

    expect(result?.title).toBe('Song');
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });
}

test('network errors are retried', async () => {
  install([new TypeError('fetch failed'), json([item()])]);
  expect((await search())?.title).toBe('Song');
  expect(calls).toHaveLength(2);
});

test('attempts are capped at four and the status is reported', async () => {
  install([status(503), status(503), status(503), status(503), status(503)]);

  await expect(search()).rejects.toThrow('bad HTTPStatus(503)');
  expect(calls).toHaveLength(4);
  expect(delays).toEqual([1000, 2000, 4000]);
});

test('a persistent network error is rethrown after four attempts', async () => {
  const err = new TypeError('fetch failed');
  install([err, err, err, err, err]);

  await expect(search()).rejects.toBe(err);
  expect(calls).toHaveLength(4);
});

for (const code of [400, 401, 403, 404]) {
  test(`${code} is permanent: one request, no wait`, async () => {
    install([status(code), json([item()])]);

    await expect(search()).rejects.toThrow(`bad HTTPStatus(${code})`);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });
}

test('Retry-After seconds are honoured, jitter adds at most 30%', async () => {
  install([status(429, { 'Retry-After': '3' }), json([item()])]);
  Math.random = () => 0.5;
  await search();

  expect(delays).toEqual([3450]);
});

test('Retry-After as an HTTP date is honoured', async () => {
  const at = new Date(Date.now() + 4000).toUTCString();
  install([status(503, { 'Retry-After': at }), json([item()])]);
  await search();

  expect(delays).toHaveLength(1);
  expect(delays[0]).toBeGreaterThan(2000);
  expect(delays[0]).toBeLessThanOrEqual(4000);
});

test('a Retry-After above ten seconds gives up without waiting', async () => {
  install([status(429, { 'Retry-After': '60' }), json([item()])]);

  await expect(search()).rejects.toThrow('bad HTTPStatus(429)');
  expect(calls).toHaveLength(1);
  expect(delays).toEqual([]);
});

test('total wait stays within the budget', async () => {
  install([
    status(429, { 'Retry-After': '9' }),
    status(429, { 'Retry-After': '9' }),
    json([item()]),
  ]);

  await expect(search()).rejects.toThrow('bad HTTPStatus(429)');
  expect(calls).toHaveLength(2);
  expect(delays).toEqual([9000]);
});

test('a malformed Retry-After falls back to backoff', async () => {
  install([status(503, { 'Retry-After': 'soon' }), json([item()])]);
  await search();

  expect(delays).toEqual([1000]);
});

test('an HTML 200 body is a clear error, not a retry', async () => {
  install([new Response('<html>', { status: 200 }), json([item()])]);

  await expect(search()).rejects.toThrow('Invalid JSON');
  expect(calls).toHaveLength(1);
});

test('empty result without inexact mode returns null with one request', async () => {
  install([json([])]);
  expect(await search()).toBeNull();
  expect(calls).toHaveLength(1);
});

test('song selection: wrong artist is rejected', async () => {
  install([json([item({ artistName: 'Someone Else' })])]);
  expect(await search()).toBeNull();
});

test('song selection: the closest duration wins', async () => {
  install([
    json([
      item({ id: 1, trackName: 'Far', duration: 210 }),
      item({ id: 2, trackName: 'Near', duration: 201 }),
    ]),
  ]);
  expect((await search())?.title).toBe('Near');
});

test('song selection: a version more than 15s away is rejected', async () => {
  install([json([item({ duration: 230 })])]);
  expect(await search()).toBeNull();
});

test('song selection: an instrumental closest match is not swapped for another version', async () => {
  install([
    json([
      item({
        id: 1,
        instrumental: true,
        plainLyrics: null,
        syncedLyrics: null,
      }),
      item({ id: 2, trackName: 'Other', duration: 210 }),
    ]),
  ]);
  expect(await search()).toBeNull();
});

test('null plainLyrics gives undefined lyrics, synced lines kept', async () => {
  install([json([item({ plainLyrics: null })])]);
  const result = await search();

  expect(result?.lyrics).toBeUndefined();
  expect(result?.lines?.map((l) => l.text)).toContain('line');
});

// A response whose body records whether it was cancelled instead of being left open
const streamed = (code: number, headers: HeadersInit = {}) => {
  const state = { cancelled: false };
  const body = new ReadableStream({
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, response: new Response(body, { status: code, headers }) };
};

test('every attempt gets a bounded abort signal', async () => {
  const timeouts: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return realAbortTimeout(ms);
  };
  install([status(503), json([item()])]);
  await search();

  expect(timeouts).toEqual([10_000, 10_000]);
  expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  expect(calls[0].signal).not.toBe(calls[1].signal);
});

test('an attempt that times out is retried', async () => {
  let first = true;
  AbortSignal.timeout = (ms: number) => {
    if (!first) return realAbortTimeout(ms);
    first = false;
    return AbortSignal.abort(new DOMException('timeout', 'TimeoutError'));
  };
  const replies: Reply[] = [json([item()])];
  install(replies);
  const inner = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException('timeout', 'TimeoutError'))
      : inner(url, init)) as typeof fetch;

  expect((await search())?.title).toBe('Song');
  expect(delays).toEqual([1000]);
});

test('a body read that fails is retried', async () => {
  const broken = Object.assign(json([]), {
    text: () => Promise.reject(new TypeError('terminated')),
  });
  install([broken, json([item()])]);

  expect((await search())?.title).toBe('Song');
  expect(calls).toHaveLength(2);
});

test('the body of a permanent error is cancelled before throwing', async () => {
  const { state, response } = streamed(404);
  install([response]);

  await expect(search()).rejects.toThrow('bad HTTPStatus(404)');
  expect(state.cancelled).toBe(true);
});

test('the body of a retried and of the final failing response is cancelled', async () => {
  const parts = [503, 503, 503, 503].map((c) => streamed(c));
  install(parts.map((p) => p.response));

  await expect(search()).rejects.toThrow('bad HTTPStatus(503)');
  expect(parts.every((p) => p.state.cancelled)).toBe(true);
});

const hints: [string, () => string][] = [
  ['zero', () => '0'],
  ['negative', () => '-5'],
  ['past date', () => new Date(Date.now() - 60_000).toUTCString()],
];
for (const [name, hint] of hints) {
  test(`${name} Retry-After is not an earlier retry than the backoff`, async () => {
    install([status(429, { 'Retry-After': hint() }), json([item()])]);
    await search();

    expect(delays).toEqual([1000]);
  });
}

test('a hint below the backoff does not shorten it', async () => {
  install([
    status(503),
    status(503),
    status(503, { 'Retry-After': '1' }),
    json([item()]),
  ]);
  await search();

  expect(delays).toEqual([1000, 2000, 4000]);
});

test('Retry-After just above ten seconds is declined, not retried early', async () => {
  install([status(429, { 'Retry-After': '10.5' }), json([item()])]);

  await expect(search()).rejects.toThrow('bad HTTPStatus(429)');
  expect(calls).toHaveLength(1);
  expect(delays).toEqual([]);
});

test('max jitter never pushes a delay past ten seconds or below the hint', async () => {
  for (const hint of ['9', '10']) {
    install([status(503, { 'Retry-After': hint }), json([item()])]);
    Math.random = () => 0.999999;
    await search();

    expect(delays).toEqual([10_000]);
  }

  install([status(503), status(503), status(503), json([item()])]);
  Math.random = () => 0.999999;
  await search();
  expect(delays).toEqual([1300, 2600, 5200]);
  expect(Math.max(...delays)).toBeLessThanOrEqual(10_000);
});

test('the sleeping budget is shared by the fallback queries of one lookup', async () => {
  (globalThis as { __lrclibInexact?: boolean }).__lrclibInexact = true;
  install([
    status(503, { 'Retry-After': '6' }),
    json([]), // exact query: empty, so the alternative title is tried
    status(503, { 'Retry-After': '6' }),
    json([]), // alternative title: empty, so the original title is tried
    status(503, { 'Retry-After': '6' }), // 6s + 6s + 6s would exceed 15s
    json([item()]),
  ]);

  await expect(
    search({ ...song, alternativeTitle: 'Alt' } as SearchSongInfo),
  ).rejects.toThrow('bad HTTPStatus(503)');
  expect(calls).toHaveLength(5);
  expect(delays).toEqual([6000, 6000]);
  expect(calls[1].url).toContain('artist_name=Artist');
  expect(calls[2].url).toContain('q=Alt');
  expect(calls[4].url).toContain('q=Song');
});

test('a new lookup starts with a fresh budget', async () => {
  install([status(503, { 'Retry-After': '9' }), json([item()])]);
  await search();
  install([status(503, { 'Retry-After': '9' }), json([item()])]);
  await search();

  expect(delays).toEqual([9000]);
});
