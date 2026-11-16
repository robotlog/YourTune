import { test, expect } from '@playwright/test';

import { rememberSegments, segmentsFor, sortSegments } from '../segments';

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

test('A result stored before dataloaded is used once the id is known', () => {
  const map = new Map();
  rememberSegments(map, 'a', [[0, 5]]);
  expect(segmentsFor(map, 'a')).toEqual([[0, 5]]);
});

test('A late result for A does not affect B', () => {
  const map = new Map();
  rememberSegments(map, 'b', [[1, 2]]);
  rememberSegments(map, 'a', [[0, 5]]);
  expect(segmentsFor(map, 'b')).toEqual([[1, 2]]);
  expect(segmentsFor(map, 'a')).toEqual([[0, 5]]);
});

test('Unknown or missing ids have no segments', () => {
  const map = new Map();
  rememberSegments(map, 'a', [[0, 5]]);
  expect(segmentsFor(map, 'x')).toEqual([]);
  expect(segmentsFor(map, undefined)).toEqual([]);
  expect(segmentsFor(map, null)).toEqual([]);
});

test('The cap evicts the oldest entry', () => {
  const map = new Map();
  for (const id of ['a', 'b', 'c']) rememberSegments(map, id, [[0, 1]], 2);
  expect([...map.keys()]).toEqual(['b', 'c']);
});

test('The playing video is never evicted', () => {
  const map = new Map();
  rememberSegments(map, 'b', [[0, 1]], 5, 'b');
  for (const id of ['1', '2', '3', '4', '5']) {
    rememberSegments(map, id, [[0, 1]], 5, 'b');
  }
  expect(map.has('b')).toBe(true);
  expect([...map.keys()]).toEqual(['b', '2', '3', '4', '5']);
});
