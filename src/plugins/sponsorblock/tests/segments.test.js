import { test, expect } from '@playwright/test';

import {
  acceptSegments,
  emptySegmentState,
  segmentsAfterVideoLoad,
  sortSegments,
} from '../segments';

test('Segment sorting', () => {
  expect(
    sortSegments([
      [0, 3],
      [7, 8],
      [5, 6],
    ]),
  ).toEqual([
    [0, 3],
    [5, 6],
    [7, 8],
  ]);

  expect(
    sortSegments([
      [0, 5],
      [6, 8],
      [4, 6],
    ]),
  ).toEqual([[0, 8]]);

  expect(
    sortSegments([
      [0, 6],
      [7, 8],
      [4, 6],
    ]),
  ).toEqual([
    [0, 6],
    [7, 8],
  ]);
});

test('Segments that arrive before dataloaded for the same video are kept', () => {
  const state = acceptSegments(emptySegmentState(), 'a', [[0, 5]], 'a');
  expect(state).toEqual({ videoId: 'a', segments: [[0, 5]] });
  expect(segmentsAfterVideoLoad(state, 'a')).toBe(state);
});

test('dataloaded for a new video clears the set', () => {
  const state = { videoId: 'a', segments: [[0, 5]] };
  expect(segmentsAfterVideoLoad(state, 'b')).toEqual(emptySegmentState());
  expect(segmentsAfterVideoLoad(state, undefined)).toEqual(emptySegmentState());
});

test('A late result for an old video is ignored', () => {
  const state = { videoId: 'b', segments: [[1, 2]] };
  expect(acceptSegments(state, 'a', [[0, 5]], 'b')).toBe(state);
  // Playing id unknown yet: accept.
  expect(acceptSegments(emptySegmentState(), 'a', [[0, 5]], undefined)).toEqual(
    { videoId: 'a', segments: [[0, 5]] },
  );
});
