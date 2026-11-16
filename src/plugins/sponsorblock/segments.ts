// Segments are an array [ [start, end], … ]
import type { Segment } from './types';

/** The segment set and the video it was fetched for. */
export type SegmentState = { videoId: string | null; segments: Segment[] };

export const emptySegmentState = (): SegmentState => ({
  videoId: null,
  segments: [],
});

/**
 * A fetch result replaces the set unless the player already moved to another
 * video: a late result for an old track must not overwrite the current one.
 */
export const acceptSegments = (
  state: SegmentState,
  videoId: string,
  segments: Segment[],
  playingVideoId: string | null | undefined,
): SegmentState =>
  playingVideoId && playingVideoId !== videoId ? state : { videoId, segments };

/**
 * A video load clears the set only when it belongs to another video; segments
 * that already arrived for this one (startup fetch) are kept.
 */
export const segmentsAfterVideoLoad = (
  state: SegmentState,
  loadedVideoId: string | null | undefined,
): SegmentState =>
  loadedVideoId && state.videoId === loadedVideoId
    ? state
    : emptySegmentState();

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
