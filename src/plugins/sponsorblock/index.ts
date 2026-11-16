import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { sortSegments } from './segments';

import type { Segment, SkipSegment } from './types';
import type { GetPlayerResponse } from '@/types/get-player-response';
import type { MusicPlayer } from '@/types/music-player';

export type SponsorBlockPluginConfig = {
  enabled: boolean;
  apiURL: string;
  categories: (
    | 'sponsor'
    | 'intro'
    | 'outro'
    | 'interaction'
    | 'selfpromo'
    | 'music_offtopic'
  )[];
};

let currentSegments: Segment[] = [];

const applySegments = (target: HTMLVideoElement) => {
  for (const segment of currentSegments) {
    if (target.currentTime >= segment[0] && target.currentTime < segment[1]) {
      target.currentTime = segment[1];
      if (window.electronIs.dev()) {
        console.log('SponsorBlock: skipping segment', segment);
      }
      break;
    }
  }
};

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    apiURL: 'https://sponsor.ajay.app',
    categories: [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic',
    ],
  } as SponsorBlockPluginConfig,
  async backend({ getConfig, ipc }) {
    const fetchSegments = async (
      apiURL: string,
      categories: string[],
      videoId: string,
    ) => {
      const sponsorBlockURL = `${apiURL}/api/skipSegments?videoID=${videoId}&categories=${JSON.stringify(
        categories,
      )}`;
      try {
        const resp = await fetch(sponsorBlockURL, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          redirect: 'follow',
        });
        if (resp.status !== 200) {
          return [];
        }

        const segments = (await resp.json()) as SkipSegment[];
        return sortSegments(segments.map((submission) => submission.segment));
      } catch (error) {
        if (is.dev()) {
          console.log('error on sponsorblock request:', error);
        }

        return [];
      }
    };

    const config = await getConfig();

    const { apiURL, categories } = config;

    ipc.on('peard:video-src-changed', async (data: GetPlayerResponse) => {
      const videoId = data?.videoDetails?.videoId;
      if (!videoId) {
        return;
      }

      const segments = await fetchSegments(apiURL, categories, videoId);
      ipc.send('sponsorblock-skip', segments);
    });
  },
  renderer: {
    api: null as MusicPlayer | null,
    videoDataListener: (name: 'newdata' | 'dataloaded' | 'dataupdated') => {
      if (name !== 'dataloaded') return;
      // The next track's segments are only fetched after this event, so
      // clearing here cannot race them. The media element's `emptied` event can
      // fire after that fetch has resolved and used to wipe the fresh set.
      currentSegments = [];
    },
    timeUpdateListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        applySegments(e.target);
      }
    },
    start({ ipc }) {
      ipc.on('sponsorblock-skip', (segments: Segment[]) => {
        currentSegments = segments;

        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          applySegments(video);
        }
      });
    },
    onPlayerApiReady(playerApi, { ipc }) {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      this.api?.removeEventListener('videodatachange', this.videoDataListener);
      this.api = playerApi;
      video.addEventListener('timeupdate', this.timeUpdateListener);
      // A new track resets the segment set before its fetch can deliver.
      playerApi.addEventListener('videodatachange', this.videoDataListener);

      ipc.send('peard:video-src-changed', playerApi.getPlayerResponse());
      applySegments(video);
    },
    stop({ ipc }) {
      this.api?.removeEventListener('videodatachange', this.videoDataListener);
      this.api = null;

      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      ipc.removeAllListeners('sponsorblock-skip');
    },
  },
});
