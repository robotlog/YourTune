export interface PlayerInfo {
  hasSong: boolean;
  isPaused: boolean;
  volumePercent: number;
  seekbarCurrentPosition: number;
  seekbarCurrentPositionHuman: string;
  /** Unix ms at which seekbarCurrentPosition was measured */
  positionUpdatedAt: number;
  statePercent: number;
  likeStatus: string;
  repeatType: string;
}

export interface TrackInfo {
  author: string;
  title: string;
  album: string;
  cover: string;
  duration: number;
  durationHuman: string;
  url: string;
  id: string;
  isVideo: boolean;
  isAdvertisement: boolean;
  inLibrary: boolean;
  /** AUDIO, ORIGINAL_MUSIC_VIDEO, USER_GENERATED_CONTENT, PODCAST_EPISODE or OTHER_VIDEO */
  mediaType: string;
  /** Empty when the URL has no playlist */
  playlistId: string;
}

export interface AmuseSongInfo {
  /**
   * 2: isAdvertisement is detected, the position is live and the fields
   * above exist. Missing in older versions, where isAdvertisement was
   * always false and the position only changed on play, pause or seek.
   */
  apiVersion: 2;
  player: PlayerInfo;
  track: TrackInfo;
}
