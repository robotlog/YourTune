import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  SongInfoEvent,
  unregisterCallback,
  type SongInfo,
} from '@/providers/song-info';
import { createBackend, LoggerPrefix } from '@/utils';

import {
  buildCommunityArtistSet,
  parseCommunityArtists,
  parseCommunityCache,
  shouldSkipTrack,
} from './match';
import {
  COMMUNITY_ARTISTS_URL,
  COMMUNITY_CACHE_VERSION,
  COMMUNITY_REFRESH_INTERVAL_MS,
  type SkipAiMusicPluginConfig,
} from './types';

type CommunityCache = {
  artists: { name: string }[];
  fetchedAt: number;
  version: number;
};

let pluginConfig: SkipAiMusicPluginConfig | null = null;
let communityArtists: string[] = [];
let communityArtistSet = new Set<string>();
let communityFetchedAt = 0;
let communityRefreshWarned = false;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<string[]> | null = null;
let lastSongInfo: SongInfo | null = null;
let lastSkippedVideoId = '';
let lastSkipAt = 0;
let consecutiveSkips = 0;
let skipTimer: NodeJS.Timeout | null = null;
let pluginWindow: Electron.BrowserWindow | null = null;

const MAX_CONSECUTIVE_SKIPS = 12;
const SKIP_WINDOW_MS = 30_000;
const SKIP_RETRY_MS = 5_000;
const DISLIKE_THEN_SKIP_MS = 350;

const cachePath = () =>
  path.join(app.getPath('userData'), 'skip-ai-music', 'artists.json');

export const getCommunityStatus = () => ({
  count: communityArtists.length,
  fetchedAt: communityFetchedAt,
});

const loadCachedArtists = async () => {
  try {
    const raw = await readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as CommunityCache;
    communityArtists = parseCommunityCache(parsed);
    communityArtistSet = buildCommunityArtistSet(communityArtists);
    communityFetchedAt =
      communityArtists.length > 0 ? Number(parsed.fetchedAt) || 0 : 0;
  } catch {
    // First run or a corrupt cache is fine; a network refresh follows.
  }
};

const saveCachedArtists = async () => {
  const file = cachePath();
  await mkdir(path.dirname(file), { recursive: true });
  const payload: CommunityCache = {
    artists: communityArtists.map((name) => ({ name })),
    fetchedAt: communityFetchedAt,
    version: COMMUNITY_CACHE_VERSION,
  };
  await writeFile(file, JSON.stringify(payload), 'utf8');
};

export const refreshCommunityArtists = async (force = false) => {
  if (
    !force &&
    communityArtists.length > 0 &&
    Date.now() - communityFetchedAt < COMMUNITY_REFRESH_INTERVAL_MS
  ) {
    return communityArtists;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await fetch(COMMUNITY_ARTISTS_URL, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Community list HTTP ${response.status}`);
      }

      const data: unknown = await response.json();
      const artists = parseCommunityArtists(data);
      if (artists.length == 0) {
        throw new Error('Community list was empty');
      }

      communityArtists = artists;
      communityArtistSet = buildCommunityArtistSet(communityArtists);
      communityFetchedAt = Date.now();
      communityRefreshWarned = false;
      await saveCachedArtists();
      console.log(
        LoggerPrefix,
        `skip-ai-music: loaded ${communityArtists.length} community artists`,
      );
      return communityArtists;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
};

const clearSkipTimer = () => {
  if (skipTimer) {
    clearTimeout(skipTimer);
    skipTimer = null;
  }
};

const skipCurrent = (
  window: Electron.BrowserWindow,
  songInfo: SongInfo,
  dislike: boolean,
) => {
  const controls = getSongControls(window);
  lastSkippedVideoId = songInfo.videoId;
  lastSkipAt = Date.now();

  if (dislike) {
    controls.dislike();
    clearSkipTimer();
    skipTimer = setTimeout(() => {
      if (lastSongInfo?.videoId == songInfo.videoId) {
        controls.next();
      }
      skipTimer = null;
    }, DISLIKE_THEN_SKIP_MS);
    return;
  }

  controls.next();
};

const maybeSkip = (window: Electron.BrowserWindow, songInfo: SongInfo) => {
  if (!pluginConfig?.enabled) {
    return;
  }

  if (!songInfo.title && !songInfo.artist) {
    return;
  }

  const result = shouldSkipTrack(
    { artist: songInfo.artist, title: songInfo.title },
    pluginConfig,
    communityArtistSet,
  );

  if (!result.skip) {
    consecutiveSkips = 0;
    return;
  }

  const now = Date.now();
  if (
    lastSkippedVideoId == songInfo.videoId &&
    now - lastSkipAt < SKIP_RETRY_MS
  ) {
    return;
  }

  if (now - lastSkipAt < SKIP_WINDOW_MS) {
    consecutiveSkips += 1;
  } else {
    consecutiveSkips = 1;
  }

  if (consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
    console.warn(
      LoggerPrefix,
      'skip-ai-music: too many consecutive skips, pausing playback',
    );
    getSongControls(window).pause();
    consecutiveSkips = 0;
    return;
  }

  console.log(
    LoggerPrefix,
    `skip-ai-music: skipping "${songInfo.artist} - ${songInfo.title}" (${result.reason}: ${result.matched})`,
  );
  skipCurrent(window, songInfo, pluginConfig.dislikeOnSkip);
};

const onSongInfo: (
  window: Electron.BrowserWindow,
) => (songInfo: SongInfo, event: SongInfoEvent) => void =
  (window) => (songInfo, event) => {
    lastSongInfo = songInfo;
    if (event != SongInfoEvent.VideoSrcChanged) {
      return;
    }
    maybeSkip(window, songInfo);
  };

const warnCommunityRefresh = (error: unknown) => {
  if (communityRefreshWarned) return;
  communityRefreshWarned = true;
  console.warn(
    LoggerPrefix,
    'skip-ai-music: failed to refresh community list',
    error,
  );
};

const startCommunityRefresh = async () => {
  try {
    await refreshCommunityArtists();
  } catch (error) {
    warnCommunityRefresh(error);
  }

  if (refreshTimer) {
    return;
  }

  refreshTimer = setInterval(() => {
    refreshCommunityArtists().catch(warnCommunityRefresh);
  }, COMMUNITY_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
};

const stopCommunityRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

export const backend = createBackend<
  {
    onSongInfo?: ReturnType<typeof onSongInfo>;
  },
  SkipAiMusicPluginConfig
>({
  async start({ getConfig, window }) {
    pluginConfig = await getConfig();
    pluginWindow = window;
    await loadCachedArtists();

    if (pluginConfig.useCommunityList) {
      await startCommunityRefresh();
    }

    this.onSongInfo = onSongInfo(window);
    registerCallback(this.onSongInfo);
  },
  stop() {
    if (this.onSongInfo) {
      unregisterCallback(this.onSongInfo);
      this.onSongInfo = undefined;
    }
    stopCommunityRefresh();
    clearSkipTimer();
    pluginConfig = null;
    pluginWindow = null;
    lastSongInfo = null;
  },
  onConfigChange(newConfig) {
    const shouldStartCommunity =
      newConfig.useCommunityList && !pluginConfig?.useCommunityList;
    pluginConfig = newConfig;

    if (shouldStartCommunity) {
      startCommunityRefresh();
    } else if (!newConfig.useCommunityList) {
      stopCommunityRefresh();
    }

    if (pluginWindow && lastSongInfo) {
      maybeSkip(pluginWindow, lastSongInfo);
    }
  },
});
