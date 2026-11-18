export type BlockedSong = {
  artist: string;
  title: string;
};

export type SkipAiMusicPluginConfig = {
  allowedArtists: string[];
  blockedArtists: string[];
  blockedKeywords: string[];
  blockedSongs: BlockedSong[];
  dislikeOnSkip: boolean;
  enabled: boolean;
  skipCommonKeywords: boolean;
  useCommunityList: boolean;
};

export const COMMON_AI_KEYWORDS = [
  'ai cover',
  'ai generated',
  'ai remix',
  'ai version',
  'nightcore',
  'sped up',
  'suno',
  'udio',
];

export const defaultConfig: SkipAiMusicPluginConfig = {
  allowedArtists: [],
  blockedArtists: [],
  blockedKeywords: [],
  blockedSongs: [],
  dislikeOnSkip: false,
  enabled: false,
  skipCommonKeywords: false,
  useCommunityList: true,
};

export const COMMUNITY_ARTISTS_URL = 'https://spot-the-ai.com/api/list/';

export const COMMUNITY_CACHE_VERSION = 4;

export const COMMUNITY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
