// Segments are an array [ [start, end], … ]
import type { Segment } from './types';

/** Segments fetched for a video id. */
export type VideoSegments = { videoId: string; segments: Segment[] };

/**
 * The active segment set and the video it was fetched for, plus a result that
 * arrived while the playing video was unknown and waits for the next load.
 */
export type SegmentState = {
  videoId: string | null;
  segments: Segment[];
  pending: VideoSegments | null;
};

export const emptySegmentState = (): SegmentState => ({
  videoId: null,
  segments: [],
  pending: null,
});

/**
 * A fetch result replaces the set unless the player already moved to another
 * video: a late result for an old track must not overwrite the current one.
 * While the playing id is unknown the result is parked, not applied.
 */
export const acceptSegments = (
  state: SegmentState,
  videoId: string,
  segments: Segment[],
  playingVideoId: string | null | undefined,
): SegmentState => {
  if (!playingVideoId) return { ...state, pending: { videoId, segments } };
  if (playingVideoId !== videoId) return state;
  return { videoId, segments, pending: null };
};

/**
 * A video load keeps segments that already belong to the loaded video, applies
 * a parked result that matches it, and clears everything else. Without a
 * loaded id nothing can be decided, so the state stays as it is.
 */
export const segmentsAfterVideoLoad = (
  state: SegmentState,
  loadedVideoId: string | null | undefined,
): SegmentState => {
  if (!loadedVideoId) return state;
  if (state.pending?.videoId === loadedVideoId) {
    return { ...state.pending, pending: null };
  }
  if (state.videoId === loadedVideoId) {
    return state.pending ? { ...state, pending: null } : state;
  }
  return emptySegmentState();
};

export const sortSegments = (segments: Segment[]) => {
  segments.sort((segment1, segment2) =>
    segment1[0] === segment2[0]
      ? segment1[1] - segment2[1]
      : segment1[0] - segment2[0],
  );

  const compiledSegments: Segment[] = [];
  let currentSegment: Segment | undefined;

  for (const segment of segments) {
    if (!currentSegment) {
      currentSegment = segment;
      continue;
    }

    if (currentSegment[1] < segment[0]) {
      compiledSegments.push(currentSegment);
      currentSegment = segment;
      continue;
    }

    currentSegment[1] = Math.max(currentSegment[1], segment[1]);
  }

  if (currentSegment) {
    compiledSegments.push(currentSegment);
  }

  return compiledSegments;
};
