import { createMemo, runWithOwner } from 'solid-js';
import { createStore } from 'solid-js/store';

import { getSongInfo } from '@/providers/song-info-front';

import { reactiveOwner } from './reactive-root';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
} from '../providers';
import {
  isCurrentRetry,
  MusixMatchUnavailable,
  retryDelay,
} from '../providers/musixmatch-token';
import { providers } from '../providers/renderer';

import type { LyricProvider } from '../types';
import type { SongInfo } from '@/providers/song-info';

type LyricsStore = {
  provider: ProviderName;
  current: ProviderState;
  lyrics: Record<ProviderName, ProviderState>;
};

const initialData = () =>
  providerNames.reduce(
    (acc, name) => {
      acc[name] = { state: 'fetching', data: null, error: null };
      return acc;
    },
    {} as LyricsStore['lyrics'],
  );

export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  provider: providerNames[0],
  lyrics: initialData(),
  get current(): ProviderState {
    return this.lyrics[this.provider];
  },
});

export const currentLyrics = runWithOwner(reactiveOwner, () =>
  createMemo(() => {
    const provider = lyricsStore.provider;
    return lyricsStore.lyrics[provider];
  }),
)!;

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  state: 'loading' | 'done';
  data: SearchCacheData;
  unavailable: Set<ProviderName>;
}

// TODO: Maybe use localStorage for the cache.
const searchCache = new Map<VideoId, SearchCache>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let searchGeneration = 0;

const scheduleRetry = (
  info: SongInfo,
  retryAt: number,
  generation: number,
  retry: () => void,
) => {
  const isCurrent = () =>
    isCurrentRetry(
      info.videoId,
      getSongInfo().videoId,
      generation,
      searchGeneration,
    );
  if (!isCurrent()) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(
    () => {
      retryTimer = undefined;
      if (isCurrent()) retry();
    },
    retryDelay(retryAt, Date.now()),
  );
};

export const fetchLyrics = (info: SongInfo) => {
  clearTimeout(retryTimer);
  const generation = ++searchGeneration;
  fetchLyricsOnce(info, generation, true);
};

const fetchLyricsOnce = (
  info: SongInfo,
  generation: number,
  schedule: boolean,
) => {
  if (generation !== searchGeneration) return;
  if (searchCache.has(info.videoId)) {
    const cache = searchCache.get(info.videoId)!;

    if (cache.state === 'loading') {
      if (getSongInfo().videoId === info.videoId) {
        setLyricsStore('lyrics', () => {
          // weird bug with solid-js
          return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
        });
      }
      setTimeout(() => {
        fetchLyricsOnce(info, generation, schedule);
      });
      return;
    }

    if (getSongInfo().videoId === info.videoId) {
      setLyricsStore('lyrics', () => {
        // weird bug with solid-js
        return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
      });
    }

    if (!cache.unavailable.size) return;
  }

  const cache: SearchCache = searchCache.get(info.videoId) ?? {
    state: 'loading',
    data: initialData(),
    unavailable: new Set(),
  };
  const retrying = cache.unavailable.size > 0;
  cache.state = 'loading';

  searchCache.set(info.videoId, cache);
  if (getSongInfo().videoId === info.videoId) {
    setLyricsStore('lyrics', () => {
      // weird bug with solid-js
      return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
    });
  }

  const tasks: Promise<void>[] = [];

  // prettier-ignore
  for (
    const [providerName, provider] of Object.entries(providers) as [
    ProviderName,
    LyricProvider,
  ][]
    ) {
    if (retrying && !cache.unavailable.has(providerName)) continue;
    const pCache = cache.data[providerName];

    tasks.push(
      provider
        .search(info)
        .then((res) => {
          cache.unavailable.delete(providerName);
          pCache.state = 'done';
          pCache.data = res;

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: {
                  state: 'done',
                  data: res ? { ...res } : null,
                  error: null,
                },
              };
            });
          }
        })
        .catch((error: Error) => {
          if (error instanceof MusixMatchUnavailable) {
            cache.unavailable.add(providerName);
            pCache.state = 'done';
            if (schedule) {
              scheduleRetry(info, error.retryAt, generation, () =>
                fetchLyricsOnce(info, generation, false),
              );
            }
            if (getSongInfo().videoId === info.videoId) {
              setLyricsStore('lyrics', providerName, {
                state: 'done', data: null, error: null,
              });
            }
            return;
          }
          cache.unavailable.delete(providerName);
          pCache.state = 'error';
          pCache.error = error;

          console.error(error);

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: { state: 'error', error, data: null },
              };
            });
          }
        }),
    );
  }

  Promise.allSettled(tasks).then(() => {
    cache.state = 'done';
    searchCache.set(info.videoId, cache);
  });
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  clearTimeout(retryTimer);
  const generation = ++searchGeneration;
  retrySearchOnce(provider, info, generation, true);
};

const retrySearchOnce = (
  provider: ProviderName,
  info: SongInfo,
  generation: number,
  schedule: boolean,
) => {
  setLyricsStore('lyrics', (old) => {
    const pCache = {
      state: 'fetching',
      data: null,
      error: null,
    };

    return {
      ...old,
      [provider]: pCache,
    };
  });

  providers[provider]
    .search(info)
    .then((res) => {
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'done', data: res, error: null },
        };
      });
    })
    .catch((error) => {
      if (error instanceof MusixMatchUnavailable) {
        if (schedule) {
          scheduleRetry(info, error.retryAt, generation, () =>
            retrySearchOnce(provider, info, generation, false),
          );
        }
        setLyricsStore('lyrics', provider, {
          state: 'done',
          data: null,
          error: null,
        });
        return;
      }
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'error', data: null, error },
        };
      });
    });
};
