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
  expect(state).toEqual({ videoId: 'a', segments: [[0, 5]], pending: null });
  expect(segmentsAfterVideoLoad(state, 'a')).toBe(state);
});

test('dataloaded for a new video clears the set', () => {
  const state = { videoId: 'a', segments: [[0, 5]], pending: null };
  expect(segmentsAfterVideoLoad(state, 'b')).toEqual(emptySegmentState());
});

test('A late result for an old video is ignored', () => {
  const state = { videoId: 'b', segments: [[1, 2]], pending: null };
  expect(acceptSegments(state, 'a', [[0, 5]], 'b')).toBe(state);
});

test('A missing id at dataloaded keeps the set', () => {
  const state = { videoId: 'a', segments: [[0, 5]], pending: null };
  expect(segmentsAfterVideoLoad(state, undefined)).toBe(state);
  expect(segmentsAfterVideoLoad(state, null)).toBe(state);
});

test('A result that arrives while the id is unknown waits for dataloaded', () => {
  const parked = acceptSegments(emptySegmentState(), 'a', [[0, 5]], undefined);
  expect(parked.segments).toEqual([]);
  expect(parked.pending).toEqual({ videoId: 'a', segments: [[0, 5]] });

  expect(segmentsAfterVideoLoad(parked, 'a')).toEqual({
    videoId: 'a',
    segments: [[0, 5]],
    pending: null,
  });
  expect(segmentsAfterVideoLoad(parked, 'b')).toEqual(emptySegmentState());
});
