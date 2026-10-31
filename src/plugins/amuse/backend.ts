import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { t } from 'i18next';

import {
  MediaType,
  registerCallback,
  type SongInfo,
} from '@/providers/song-info';
import { createBackend } from '@/utils';

import type { AmuseSongInfo } from './types';

const amusePort = 9863;

const toHumanTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
};

// 6K Labs clients (e.g. the Amuse app) read every field of the query response
// and treat missing keys as a malformed provider, so each one must always be
// present with a non-null default.
const emptyQuery = (): AmuseSongInfo => ({
  apiVersion: 2,
  player: {
    hasSong: false,
    isPaused: true,
    volumePercent: 0,
    seekbarCurrentPosition: 0,
    seekbarCurrentPositionHuman: '0:00',
    positionUpdatedAt: 0,
    statePercent: 0,
    likeStatus: 'INDIFFERENT',
    repeatType: 'NONE',
  },
  track: {
    author: '',
    title: '',
    album: '',
    cover: '',
    duration: 0,
    durationHuman: '0:00',
    url: '',
    id: '',
    isVideo: false,
    isAdvertisement: false,
    inLibrary: false,
    mediaType: MediaType.Audio,
    playlistId: '',
  },
});

const formatSongInfo = (
  info: SongInfo,
  isAdvertisement: boolean,
  positionUpdatedAt: number,
): AmuseSongInfo => {
  if (!info.artist || !info.title) {
    return emptyQuery();
  }

  const elapsedSeconds = Math.floor(info.elapsedSeconds ?? 0);
  const duration = Math.floor(info.songDuration ?? 0);

  return {
    apiVersion: 2,
    player: {
      hasSong: true,
      isPaused: info.isPaused ?? false,
      volumePercent: 0,
      seekbarCurrentPosition: elapsedSeconds,
      seekbarCurrentPositionHuman: toHumanTime(elapsedSeconds),
      positionUpdatedAt,
      statePercent:
        duration > 0 ? Math.round((elapsedSeconds / duration) * 100) : 0,
      likeStatus: 'INDIFFERENT',
      repeatType: 'NONE',
    },
    track: {
      author: info.artist,
      title: info.title,
      album: info.album ?? '',
      cover: info.imageSrc ?? '',
      duration,
      durationHuman: toHumanTime(duration),
      url: info.url ?? '',
      id: info.videoId,
      isVideo:
        info.mediaType !== MediaType.Audio &&
        info.mediaType !== MediaType.OriginalMusicVideo,
      isAdvertisement,
      inLibrary: false,
      mediaType: info.mediaType,
      playlistId: info.playlistId ?? '',
    },
  };
};

export default createBackend({
  currentSongInfo: {} as SongInfo,
  // Reported by the renderer, the song info itself doesn't know about ads
  isAdvertisement: false,
  // When elapsedSeconds last changed, so clients can extrapolate the position
  positionUpdatedAt: 0,
  app: null as Hono | null,
  server: null as ReturnType<typeof serve> | null,
  start({ ipc }) {
    ipc.on('peard:amuse-ad-state', (isAd: boolean) => {
      this.isAdvertisement = isAd;
    });
    // Without this the song info only gets a new elapsed time on play, pause
    // or seek, so seekbarCurrentPosition stood still while a song played
    ipc.on('peard:player-api-loaded', () =>
      ipc.send('peard:setup-time-changed-listener'),
    );

    registerCallback((songInfo) => {
      if (
        songInfo.elapsedSeconds !== this.currentSongInfo.elapsedSeconds ||
        songInfo.videoId !== this.currentSongInfo.videoId ||
        songInfo.isPaused !== this.currentSongInfo.isPaused
      ) {
        this.positionUpdatedAt = Date.now();
      }
      // The provider reuses one object, keep a copy to compare against
      this.currentSongInfo = { ...songInfo };
    });

    this.app = new Hono();
    this.app.use('*', cors());
    this.app.get('/', (ctx) =>
      ctx.body(t('plugins.amuse.response.query'), 200),
    );

    const queryAndApiHandler = (ctx: Context) => {
      return ctx.json(
        formatSongInfo(
          this.currentSongInfo,
          this.isAdvertisement,
          this.positionUpdatedAt,
        ),
        200,
      );
    };

    this.app.get('/query', queryAndApiHandler);
    this.app.get('/api', queryAndApiHandler);

    try {
      this.server = serve({
        fetch: this.app.fetch.bind(this.app),
        port: amusePort,
      });
    } catch (err) {
      console.error(err);
    }
  },

  stop() {
    if (this.server) {
      this.server?.close();
    }
  },
});
