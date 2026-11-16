// Segments are an array [ [start, end], … ]
import type { Segment } from './types';

/** Segment sets kept per video id, oldest first. */
export type SegmentsByVideo = Map<string, Segment[]>;

/** Stores a fetch result under its own video id and drops the oldest ones. */
export const rememberSegments = (
  map: SegmentsByVideo,
  videoId: string,
  segments: Segment[],
  cap = 5,
) => {
  map.delete(videoId);
  map.set(videoId, segments);
  while (map.size > cap) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
};

/** Segments for a video id; unknown or missing ids have none. */
export const segmentsFor = (
  map: SegmentsByVideo,
  videoId: string | null | undefined,
): Segment[] => (videoId ? (map.get(videoId) ?? []) : []);

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
